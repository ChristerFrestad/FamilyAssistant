// Recipe import service (Iteration 3b phase D)
//
// Responsibilities:
//   1. Take a free-form recipe as text (paste) or image (OCR) and parse
//      it into structured { name, category, prepTimeMin, servings,
//      ingredients, steps } via LLM.
//   2. Normalise each ingredient via the phase C ingredient-normalizer
//      (qty/unit extraction + EN→NO translation).
//   3. Write to recipes + recipe_ingredients via repos.recipes.insert.
//
// Design choices:
//   - One pure function per entry: importFromText and importFromImage.
//     importFromImage is a thin wrapper that runs OCR and delegates to
//     importFromText.
//   - The LLM prompt returns JSON. If parsing fails we respond with
//     { error, raw } so the user can see what went wrong. We do NOT
//     write partial rows.
//   - category from the LLM is validated against the CHECK constraint
//     (rask|comfort|helg). Unknown → 'rask' as a safe default.
//   - Language detection happens via ingredient-normalizer.detectLanguage
//     on the first ~300 characters of the text. EN sources are passed
//     through the LLM unchanged; the LLM is asked to translate
//     ingredients to Norwegian. The phase C normalizer is also run on
//     each ingredient name for qty extraction and as a fallback if the
//     LLM forgets the translation.
//   - The OCR adapter is pluggable (same pattern as receipt.service)
//     so tests can pass a fake adapter and avoid the Tesseract CLI.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { logger } = require('../logger');
// IMPORTANT: don't destructure — tests need to be able to swap llm.llmChat
// dynamically via require.cache. Keep the module reference and look up
// at usage time.
const llm = require('../llm');
const normalizer = require('./ingredient-normalizer.service');
const receiptService = require('./receipt.service');

const ALLOWED_CATEGORIES = new Set(['rask', 'comfort', 'helg']);
const MAX_TEXT_CHARS = 8000;
const MAX_NAME_CHARS = 200;
const MAX_INGREDIENT_NAME_CHARS = 100;
const MAX_STEP_CHARS = 500;

/**
 * Strip control chars, HTML tags and limit string length.
 * Used as defense-in-depth against malicious LLM output or OCR injection.
 * Frontend also escapes on display (M1.1), but we cap and clean here so
 * data is not persistently corrupt in the DB.
 */
function sanitizeString(s, maxLen) {
  if (s === null || s === undefined) return '';
  let out = String(s);
  // Strip NUL and ASCII control chars (except newline/tab)
  out = out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  // Strip out all HTML/script/tag-like constructs
  out = out.replace(
    /<\s*\/?\s*(script|iframe|object|embed|style|link|meta|img|svg|math|base)\b[^>]*>/gi,
    ''
  );
  // Remove remaining <...> patterns (generic HTML tags) — we want plain text
  out = out.replace(/<[^>]*>/g, '');
  // Trim + cap length
  out = out.trim();
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

/**
 * Allow only safe URL schemes for stored recipe URLs.
 * Returns null for javascript:, data:, vbscript: etc.
 */
function sanitizeUrl(u) {
  if (!u) return null;
  const s = String(u).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  if (s.length > 500) return null;
  return s;
}

// ============================================================
// LLM prompt
// ============================================================
//
// NOTE: the prompt strings below are deliberately Norwegian — they
// instruct the LLM to respond in Norwegian. This is functional content,
// not developer-facing text.

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
// LLM call + JSON extraction
// ============================================================

async function parseRecipeWithLlm({ title, text, sourceUrl }) {
  try {
    const result = await llm.llmChat(
      [
        { role: 'system', content: IMPORT_SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt({ title, text, sourceUrl }) },
      ],
      { temperature: 0.2, maxTokens: 2048 }
    );

    const content = typeof result === 'string' ? result : (result && result.content) || '';
    if (!content) return { error: 'Empty LLM response' };

    // First: try to match a JSON object in the response (may be wrapped
    // in markdown)
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { error: 'No JSON in LLM response', raw: content };

    try {
      const parsed = JSON.parse(match[0]);
      return { parsed };
    } catch (err) {
      return { error: `JSON parse failed: ${err.message}`, raw: match[0] };
    }
  } catch (err) {
    return { error: `LLM call failed: ${err.message}` };
  }
}

// ============================================================
// Validation + normalisation of parsed recipe
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
    // Strip HTML tags / control chars before the normalizer sees the name
    const name = sanitizeString(ing.name, MAX_INGREDIENT_NAME_CHARS);
    if (!name) continue;

    // Run through the phase C normalizer for qty/unit extraction + EN→NO.
    // If the LLM already provided qty/unit we respect it and only use
    // the normalizer to translate the name.
    const llmQty = Number.isFinite(ing.qty) && ing.qty > 0 ? ing.qty : null;
    const llmUnit = typeof ing.unit === 'string' && ing.unit ? sanitizeString(ing.unit, 20) : null;

    const norm = normalizer.normalizeSync({
      name,
      qty: llmQty,
      unit: llmUnit,
    });

    out.push({
      name: sanitizeString(norm.nameNo || name.toLowerCase(), MAX_INGREDIENT_NAME_CHARS),
      qty: norm.qty ?? llmQty ?? 1,
      unit: sanitizeString(norm.unit ?? llmUnit ?? 'stk', 20),
      optional: false,
    });
  }
  return out;
}

function sanitizeSteps(rawSteps) {
  if (!Array.isArray(rawSteps)) return [];
  return rawSteps
    .map((s) => sanitizeString(s, MAX_STEP_CHARS))
    .filter(Boolean)
    .slice(0, 30);
}

// ============================================================
// Public: importFromText
// ============================================================

/**
 * Parse a free-form recipe text via LLM and write to DB.
 *
 * @param {Object} repos
 * @param {Object} input
 * @param {string} input.text                — raw recipe text (required)
 * @param {string} [input.title]             — optional name hint
 * @param {string} [input.sourceUrl]         — source URL if known
 * @param {string} [input.language]          — 'no'|'en'|'auto' (default auto)
 * @returns {Promise<{recipeId?, recipe?, error?, raw?}>}
 */
async function importFromText(
  repos,
  { text, title = null, sourceUrl = null, language = 'auto' } = {}
) {
  if (!text || typeof text !== 'string' || text.trim().length < 20) {
    return { error: 'Recipe text is too short (minimum 20 chars)' };
  }

  const detectedLang =
    language === 'auto' ? normalizer.detectLanguage(text.slice(0, 400)) : language;

  logger.info(
    { titleHint: title, len: text.length, language: detectedLang },
    'recipe-import: start'
  );

  const llmRes = await parseRecipeWithLlm({ title, text, sourceUrl });
  if (llmRes.error) {
    logger.warn({ err: llmRes.error }, 'recipe-import: LLM failed');
    return { error: llmRes.error, raw: llmRes.raw };
  }

  const parsed = llmRes.parsed;
  // M1.5: scrub all user/LLM-controlled text against XSS + control chars
  // before DB write
  const name = sanitizeString(parsed.name || title || '', MAX_NAME_CHARS);
  if (!name) return { error: 'Missing recipe name in LLM response', raw: parsed };

  const ingredients = sanitizeIngredients(parsed.ingredients);
  if (ingredients.length === 0) {
    return { error: 'No valid ingredients parsed', raw: parsed };
  }

  const steps = sanitizeSteps(parsed.steps);
  const category = sanitizeCategory(parsed.category);
  const prepTime =
    Number.isFinite(parsed.prepTimeMin) && parsed.prepTimeMin > 0
      ? `${Math.min(Math.round(parsed.prepTimeMin), 9999)} min`
      : null;
  const servings =
    Number.isFinite(parsed.servings) && parsed.servings > 0
      ? Math.min(Math.round(parsed.servings), 99)
      : 2;
  const safeSourceUrl = sanitizeUrl(sourceUrl);

  const recipeId = repos.recipes.insert({
    name,
    category,
    prepTime,
    source: safeSourceUrl ? 'import_url' : 'import_text',
    url: safeSourceUrl,
    servings,
    notes: steps.length > 0 ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : null,
    ingredients,
  });

  logger.info({ recipeId, name, ingredientCount: ingredients.length }, 'recipe-import: saved');

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

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function extForMime(mime) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

/**
 * Save an uploaded image buffer to a temporary file, run OCR, and pass
 * the resulting text through importFromText.
 *
 * @param {Object} repos
 * @param {Object} input
 * @param {Buffer} input.buffer              — raw bytes (required)
 * @param {string} input.mime                — 'image/jpeg' etc.
 * @param {string} [input.title]             — optional name hint
 * @param {Function} [input.ocrAdapter]      — override for tests
 * @returns {Promise<{recipeId?, error?, raw?}>}
 */
async function importFromImage(repos, { buffer, mime, title = null, ocrAdapter = null } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { error: 'Empty or invalid image buffer' };
  }
  if (buffer.length > 10 * 1024 * 1024) {
    return { error: 'Image is too large (max 10MB)' };
  }
  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    return { error: `Invalid image type: ${mime}` };
  }

  // Save to a temp file so the Tesseract CLI can read it
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const tmpPath = path.join(os.tmpdir(), `recipe-import-${hash}.${extForMime(mime)}`);
  fs.writeFileSync(tmpPath, buffer);

  try {
    const adapter =
      ocrAdapter ||
      ((await receiptService.isOcrAvailable())
        ? receiptService.tesseractOcr
        : receiptService.nullOcr);
    const ocr = await adapter(tmpPath);
    const text = (ocr && ocr.text) || '';
    if (!text || text.trim().length < 20) {
      return { error: 'OCR returned too little text — not a recipe or unreadable image' };
    }

    return await importFromText(repos, { text, title });
  } catch (err) {
    logger.warn({ err: err.message }, 'recipe-import: OCR failed');
    return { error: `OCR failed: ${err.message}` };
  } finally {
    // Best-effort cleanup of temp file
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  importFromText,
  importFromImage,
  // exported for tests
  sanitizeCategory,
  sanitizeIngredients,
  sanitizeSteps,
  sanitizeString,
  sanitizeUrl,
  buildUserPrompt,
  MAX_TEXT_CHARS,
  parseRecipeWithLlm,
  IMPORT_SYSTEM_PROMPT,
};
