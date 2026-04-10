// Recipe import service (Iterasjon 3b fase D)
//
// Ansvar:
//   1. Ta imot en fritt formatert oppskrift som tekst (paste) eller bilde
//      (OCR) og parse den til strukturert { name, category, prepTimeMin,
//      servings, ingredients, steps } via LLM.
//   2. Normaliser hver ingrediens via fase C sin ingredient-normalizer
//      (qty/unit-utvinning + EN→NO-oversettelse).
//   3. Skriv til recipes + recipe_ingredients via repos.recipes.insert.
//
// Designvalg:
//   - Én ren funksjon per inngang: importFromText og importFromImage.
//     importFromImage er en tynn wrapper som kjører OCR og delegerer
//     til importFromText.
//   - LLM-prompten returnerer JSON. Hvis parsing feiler, svarer vi med
//     { error, raw } slik at bruker kan se hva som gikk galt. Vi skriver
//     IKKE partielle rader.
//   - category fra LLM valideres mot CHECK-constraint (rask|comfort|helg).
//     Ukjent → 'rask' som trygg default.
//   - Språk-deteksjon skjer via ingredient-normalizer.detectLanguage på
//     første ~300 tegn av teksten. EN-kilder kjøres uendret gjennom LLM;
//     LLM-en bes oversette ingredienser til norsk. Fase C-normalizer
//     kjøres i tillegg på hvert ingrediens-navn for qty-utvinning og
//     som fallback hvis LLM glemte oversettelsen.
//   - OCR-adapter er pluggbar (samme mønster som receipt.service) slik
//     at tester kan sende inn en fake adapter og slippe Tesseract-CLI.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { logger } = require('../logger');
// VIKTIG: ikke destrukturer — vi vil at tester skal kunne swappe llm.llmChat
// dynamisk via require.cache. Behold modul-referansen og slå opp ved bruk.
const llm = require('../llm');
const normalizer = require('./ingredient-normalizer.service');
const receiptService = require('./receipt.service');

const ALLOWED_CATEGORIES = new Set(['rask', 'comfort', 'helg']);
const MAX_TEXT_CHARS = 8000;

// ============================================================
// LLM-prompt
// ============================================================

const IMPORT_SYSTEM_PROMPT = `Du er en oppskrift-parser for en norsk familie. Du mottar rå tekst fra en oppskrift (norsk eller engelsk) og returnerer strukturerte data i JSON.

Svar KUN med et JSON-objekt med denne formen:
{
  "name": "Rettens navn på norsk",
  "category": "rask" | "comfort" | "helg",
  "prepTimeMin": 30,
  "servings": 4,
  "ingredients": [
    { "name": "kjøttdeig", "qty": 400, "unit": "g" },
    { "name": "løk", "qty": 1, "unit": "stk" }
  ],
  "steps": ["Stek løken ...", "Tilsett kjøttdeig ..."]
}

Regler:
- Oversett engelske ingredienser og rettsnavn til norsk.
- category: 'rask' = under 30 min, 'comfort' = hverdagsmiddag, 'helg' = tar lang tid eller fest/helg.
- qty må være et tall; bruk 1 hvis uklart.
- unit skal være 'g', 'kg', 'ml', 'dl', 'l', 'stk', 'ts' (teskje), 'ss' (spiseskje).
- Hopp over "salt og pepper etter smak" uten mengde.
- Ingen kommentarer, ingen markdown-fence, kun JSON.`;

function buildUserPrompt({ title, text, sourceUrl }) {
  const parts = [];
  if (title) parts.push(`Tittel (forslag): ${title}`);
  if (sourceUrl) parts.push(`Kilde: ${sourceUrl}`);
  parts.push('Oppskriftstekst:');
  parts.push(text.slice(0, MAX_TEXT_CHARS));
  return parts.join('\n\n');
}

// ============================================================
// LLM-kall + JSON-ekstraksjon
// ============================================================

async function parseRecipeWithLlm({ title, text, sourceUrl }) {
  try {
    const result = await llm.llmChat([
      { role: 'system', content: IMPORT_SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt({ title, text, sourceUrl }) },
    ], { temperature: 0.2, maxTokens: 2048 });

    const content = typeof result === 'string'
      ? result
      : (result && result.content) || '';
    if (!content) return { error: 'Tomt LLM-svar' };

    // Først: prøv å matche et JSON-objekt i svaret (kan være innpakket i markdown)
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { error: 'Ingen JSON i LLM-svar', raw: content };

    try {
      const parsed = JSON.parse(match[0]);
      return { parsed };
    } catch (err) {
      return { error: `JSON-parse feilet: ${err.message}`, raw: match[0] };
    }
  } catch (err) {
    return { error: `LLM-kall feilet: ${err.message}` };
  }
}

// ============================================================
// Validering + normalisering av parset oppskrift
// ============================================================

function sanitizeCategory(cat) {
  if (typeof cat === 'string' && ALLOWED_CATEGORIES.has(cat.toLowerCase())) {
    return cat.toLowerCase();
  }
  return 'rask';
}

function sanitizeIngredients(rawIngredients) {
  if (!Array.isArray(rawIngredients)) return [];
  const out = [];
  for (const ing of rawIngredients) {
    if (!ing || typeof ing !== 'object') continue;
    const name = (ing.name || '').toString().trim();
    if (!name) continue;

    // Kjør gjennom fase C normalizer for qty/unit-utvinning + EN→NO
    // Hvis LLM-en allerede har gitt qty/unit respekterer vi det og
    // bruker normalizer kun til å oversette navnet.
    const llmQty = Number.isFinite(ing.qty) ? ing.qty : null;
    const llmUnit = typeof ing.unit === 'string' && ing.unit ? ing.unit : null;

    const norm = normalizer.normalizeSync({
      name,
      qty: llmQty,
      unit: llmUnit,
    });

    out.push({
      name: norm.nameNo || name.toLowerCase(),
      qty: norm.qty ?? llmQty ?? 1,
      unit: norm.unit ?? llmUnit ?? 'stk',
      optional: false,
    });
  }
  return out;
}

function sanitizeSteps(rawSteps) {
  if (!Array.isArray(rawSteps)) return [];
  return rawSteps
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .slice(0, 30);
}

// ============================================================
// Public: importFromText
// ============================================================

/**
 * Parse en fritt formatert oppskrifts-tekst via LLM og skriv til DB.
 *
 * @param {Object} repos
 * @param {Object} input
 * @param {string} input.text                — rå oppskriftstekst (påkrevd)
 * @param {string} [input.title]             — valgfritt navn-forslag
 * @param {string} [input.sourceUrl]         — kilde-URL hvis kjent
 * @param {string} [input.language]          — 'no'|'en'|'auto' (default auto)
 * @returns {Promise<{recipeId?, recipe?, error?, raw?}>}
 */
async function importFromText(repos, { text, title = null, sourceUrl = null, language = 'auto' } = {}) {
  if (!text || typeof text !== 'string' || text.trim().length < 20) {
    return { error: 'Oppskriftstekst er for kort (minimum 20 tegn)' };
  }

  const detectedLang = language === 'auto'
    ? normalizer.detectLanguage(text.slice(0, 400))
    : language;

  logger.info({ titleHint: title, len: text.length, language: detectedLang }, 'recipe-import: start');

  const llmRes = await parseRecipeWithLlm({ title, text, sourceUrl });
  if (llmRes.error) {
    logger.warn({ err: llmRes.error }, 'recipe-import: LLM feilet');
    return { error: llmRes.error, raw: llmRes.raw };
  }

  const parsed = llmRes.parsed;
  const name = (parsed.name || title || '').toString().trim();
  if (!name) return { error: 'Mangler oppskriftsnavn i LLM-svar', raw: parsed };

  const ingredients = sanitizeIngredients(parsed.ingredients);
  if (ingredients.length === 0) {
    return { error: 'Ingen gyldige ingredienser parset', raw: parsed };
  }

  const steps = sanitizeSteps(parsed.steps);
  const category = sanitizeCategory(parsed.category);
  const prepTime = Number.isFinite(parsed.prepTimeMin)
    ? `${parsed.prepTimeMin} min`
    : null;
  const servings = Number.isFinite(parsed.servings) && parsed.servings > 0
    ? Math.round(parsed.servings)
    : 2;

  const recipeId = repos.recipes.insert({
    name,
    category,
    prepTime,
    source: sourceUrl ? 'import_url' : 'import_text',
    url: sourceUrl,
    servings,
    notes: steps.length > 0 ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : null,
    ingredients,
  });

  logger.info({ recipeId, name, ingredientCount: ingredients.length }, 'recipe-import: lagret');

  return {
    recipeId,
    recipe: repos.recipes.getById(recipeId),
    language: detectedLang,
    llmModel: llm.OLLAMA_MODEL,
  };
}

// ============================================================
// Public: importFromImage
// ============================================================

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
]);

function extForMime(mime) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

/**
 * Lagre en opplastet bildebuffer til en midlertidig fil, kjør OCR,
 * og send den resulterende teksten gjennom importFromText.
 *
 * @param {Object} repos
 * @param {Object} input
 * @param {Buffer} input.buffer              — råbytes (påkrevd)
 * @param {string} input.mime                — 'image/jpeg' etc.
 * @param {string} [input.title]             — valgfritt navn-forslag
 * @param {Function} [input.ocrAdapter]      — override for tester
 * @returns {Promise<{recipeId?, error?, raw?}>}
 */
async function importFromImage(repos, { buffer, mime, title = null, ocrAdapter = null } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { error: 'Tom eller ugyldig bildebuffer' };
  }
  if (buffer.length > 10 * 1024 * 1024) {
    return { error: 'Bildet er for stort (max 10MB)' };
  }
  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    return { error: `Ugyldig bildetype: ${mime}` };
  }

  // Lagre til temp-fil slik at Tesseract-CLI kan lese den
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const tmpPath = path.join(os.tmpdir(), `recipe-import-${hash}.${extForMime(mime)}`);
  fs.writeFileSync(tmpPath, buffer);

  try {
    const adapter = ocrAdapter
      || ((await receiptService.isOcrAvailable())
        ? receiptService.tesseractOcr
        : receiptService.nullOcr);
    const ocr = await adapter(tmpPath);
    const text = (ocr && ocr.text) || '';
    if (!text || text.trim().length < 20) {
      return { error: 'OCR ga for lite tekst — ikke en oppskrift eller uleselig bilde' };
    }

    return await importFromText(repos, { text, title });
  } catch (err) {
    logger.warn({ err: err.message }, 'recipe-import: OCR feilet');
    return { error: `OCR feilet: ${err.message}` };
  } finally {
    // Rydd temp-fil best-effort
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

module.exports = {
  importFromText,
  importFromImage,
  // eksportert for tester
  sanitizeCategory,
  sanitizeIngredients,
  sanitizeSteps,
  parseRecipeWithLlm,
  IMPORT_SYSTEM_PROMPT,
};
