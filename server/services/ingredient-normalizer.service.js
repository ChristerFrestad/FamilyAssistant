// Ingredient normalizer (Iterasjon 3b fase C)
//
// Ansvar:
//   1. Gjett språk (EN vs NO) på et ingrediensnavn
//   2. Oversett EN → NO via statisk ordbok (multi_word først, så single_word)
//   3. Fjern stopp-ord (fresh, chopped, finely, large, …)
//   4. Trekk ut qty + unit fra en fritt formatert streng
//      (eks. "400g ground beef" → qty=400, unit='g', name='ground beef')
//   5. Cup-til-gram konvertering for vanlige tørrvarer
//   6. LLM-fallback når ordboka ikke dekker nok ord (>20% ukjente),
//      cachet i llm_cache med stabil nøkkel
//
// Designvalg:
//   - Ren funksjon (bortsett fra LLM-fallback som tar repos for cache).
//     Kan brukes både synkron (dict-only) via normalizeSync() og
//     asynkron (med LLM-fallback) via normalize().
//   - 80%-terskel: hvis minst 80% av "betydelige tokens" (etter
//     stopp-ord-fjerning) finnes i ordboka, godta dict-resultatet.
//     Ellers → LLM.
//   - LLM-kall bruker eksisterende llm_cache (key: 'ingr_tr:<lowercase raw>').
//     TTL er 30 dager — oversettelser er stabile.
//   - Hvis LLM ikke er tilgjengelig (ingen Ollama) → pass through
//     dict-resultatet selv om under terskel. Bedre enn å feile.
//   - Norsk input er passthrough — vi forsøker ikke å normalisere NO→NO
//     bortsett fra qty/unit-utvinning og lowercase trim.

const path = require('path');
const fs = require('fs');
const { logger } = require('../logger');

// ============================================================
// Data loading (lazy singleton)
// ============================================================

let _dict = null;
function loadDictionary() {
  if (_dict) return _dict;
  const filePath = path.join(__dirname, '..', 'data', 'ingredient-dictionary-en-no.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    _dict = JSON.parse(raw);
    // Pre-compute sorted multi-word keys (lengste først) for match-prioritet
    _dict._multiWordKeysSorted = Object.keys(_dict.multi_word || {}).sort(
      (a, b) => b.length - a.length
    );
    _dict._stopWordsSet = new Set(_dict.stop_words || []);
  } catch (err) {
    logger.error({ err: err.message, filePath }, 'normalizer: kunne ikke laste ordbok');
    _dict = {
      multi_word: {},
      single_word: {},
      stop_words: [],
      unit_conversions: {},
      _multiWordKeysSorted: [],
      _stopWordsSet: new Set(),
    };
  }
  return _dict;
}

// ============================================================
// Språkdeteksjon
// ============================================================

// Norske tegn som indikerer klart NO
const NORWEGIAN_CHARS = /[æøåÆØÅ]/;

// Heuristikk: streng med ingen æøå OG som inneholder minst ett engelsk
// ordbok-ord → sannsynligvis EN. Strenger med æøå → NO.
function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'unknown';
  if (NORWEGIAN_CHARS.test(text)) return 'no';

  const dict = loadDictionary();
  const lowered = text.toLowerCase();
  const tokens = tokenize(lowered);

  // Sjekk multi-word først
  for (const phrase of dict._multiWordKeysSorted) {
    if (lowered.includes(phrase)) return 'en';
  }
  // Så single-word
  for (const tok of tokens) {
    if (dict.single_word[tok]) return 'en';
  }
  // Ingen match — ukjent, behandles som NO (passthrough)
  return 'unknown';
}

// ============================================================
// Tokenisering og qty/unit-utvinning
// ============================================================

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[()[\],;]/g, ' ') // tegn som splitter ord
    .split(/\s+/)
    .filter(Boolean);
}

// Regex som fanger "400g", "1.5 kg", "2 cups", "1/2 tsp", "3 stk"
const QTY_UNIT_REGEX =
  /(\d+(?:[.,]\d+)?(?:\/\d+)?)\s*(kg|kilo|kilogram|g|gram|mg|l|liter|dl|cl|ml|stk|pcs|piece|pieces|cup|cups|tbsp|tsp|tablespoon|teaspoon|tablespoons|teaspoons|oz|lb|lbs|pound|pounds)\b/i;

const UNIT_CANONICAL = {
  kg: 'kg',
  kilo: 'kg',
  kilogram: 'kg',
  g: 'g',
  gram: 'g',
  mg: 'mg',
  l: 'l',
  liter: 'l',
  dl: 'dl',
  cl: 'cl',
  ml: 'ml',
  stk: 'stk',
  pcs: 'stk',
  piece: 'stk',
  pieces: 'stk',
  cup: 'cup',
  cups: 'cup',
  tbsp: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  oz: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
};

function parseFraction(str) {
  // Håndterer "1/2", "3/4" osv.
  if (str.includes('/')) {
    const [num, den] = str.split('/').map(Number);
    if (den) return num / den;
  }
  return parseFloat(str.replace(',', '.'));
}

function extractQtyUnit(text) {
  if (!text) return { qty: null, unit: null, textWithoutQty: text || '' };
  const match = text.match(QTY_UNIT_REGEX);
  if (!match) return { qty: null, unit: null, textWithoutQty: text };
  const qty = parseFraction(match[1]);
  const unit = UNIT_CANONICAL[match[2].toLowerCase()] || match[2].toLowerCase();
  const textWithoutQty = text.replace(match[0], ' ').replace(/\s+/g, ' ').trim();
  return { qty, unit, textWithoutQty };
}

// ============================================================
// Oversettelse (statisk ordbok)
// ============================================================

/**
 * Fjern stopp-ord fra en token-liste.
 */
function stripStopWords(tokens) {
  const dict = loadDictionary();
  return tokens.filter((t) => !dict._stopWordsSet.has(t));
}

/**
 * Oversett EN → NO via dict. Returnerer { name, coverage, source }.
 * coverage = andel av betydelige tokens (i originalteksten, etter stopp-ord-fjerning)
 * som ble truffet av enten multi-word eller single-word regler.
 */
function translateViaDict(text) {
  const dict = loadDictionary();
  const lowered = text.toLowerCase().trim();

  // Tell betydelige tokens i originalteksten — denne er nevneren for coverage
  const origSignificantCount = stripStopWords(tokenize(lowered)).length;

  let working = lowered;
  let hits = 0;
  // Marker ord som kommer fra replacement (så vi ikke dobbelt-teller i single-word-fasen)
  const replacedTokenSet = new Set();

  // 1. Multi-word replacements (lengste først for riktig prioritet)
  for (const phrase of dict._multiWordKeysSorted) {
    while (working.includes(phrase)) {
      const phraseSigCount = stripStopWords(tokenize(phrase)).length;
      hits += phraseSigCount;
      const replacement = dict.multi_word[phrase];
      // Marker replacement-tokens (disse "tilhører" multi-word-dekning)
      for (const tok of tokenize(replacement)) replacedTokenSet.add(tok);
      working = working.replace(phrase, replacement);
    }
  }

  // 2. Tokeniser post-replace, fjern stopp-ord, oversett enkeltord
  const tokens = tokenize(working);
  const significant = stripStopWords(tokens);

  const translated = significant.map((tok) => {
    // Allerede dekket av multi-word replacement — ikke dobbelt-tell
    if (replacedTokenSet.has(tok)) return tok;
    if (dict.single_word[tok]) {
      hits++;
      return dict.single_word[tok];
    }
    // Ukjent token — behold som det er
    return tok;
  });

  const coverage = origSignificantCount > 0 ? Math.min(1, hits / origSignificantCount) : 0;

  return {
    name: translated.join(' ').trim(),
    coverage,
    significantCount: origSignificantCount,
  };
}

// ============================================================
// Cup-konvertering (dry goods)
// ============================================================

/**
 * Hvis qty+unit er cup og navnet er en kjent tørrvare, konverter til gram.
 * Returnerer { qty, unit } uendret hvis ingen konvertering mulig.
 */
function maybeConvertCup(qty, unit, nameNo) {
  if (qty == null || unit == null) return { qty, unit };
  if (unit !== 'cup' && unit !== 'cups') return { qty, unit };

  const dict = loadDictionary();
  const table = dict.unit_conversions && dict.unit_conversions.cup;
  if (!table) return { qty, unit };

  // Finn første matching nøkkel i nameNo (token-substring)
  const lowered = (nameNo || '').toLowerCase();
  for (const key of Object.keys(table)) {
    if (key.startsWith('_')) continue;
    if (lowered.includes(key)) {
      return { qty: qty * table[key], unit: 'g' };
    }
  }
  return { qty, unit };
}

// ============================================================
// LLM fallback
// ============================================================

/**
 * Ber LLM om å oversette et ukjent ingrediensnavn til norsk.
 * Cache'r i llm_cache med 30-dagers TTL.
 * Returnerer null hvis LLM ikke er tilgjengelig eller feiler.
 */
async function translateViaLlm(repos, rawText) {
  if (!repos || !repos.llmCache) return null;

  const cacheKey = `ingr_tr:${rawText.toLowerCase().trim()}`;
  const cached = repos.llmCache.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached.response);
      return { name: parsed.name, source: 'llm_cache' };
    } catch {
      /* ignorer, fall through */
    }
  }

  // Dynamisk import av llm for å unngå require-syklus (llm bruker repos)
  let llm;
  try {
    llm = require('../llm');
  } catch {
    return null;
  }
  if (!llm || typeof llm.isLLMAvailable !== 'function') return null;

  try {
    const available = await llm.isLLMAvailable();
    if (!available) return null;
  } catch {
    return null;
  }

  const prompt = `Oversett følgende matvare/ingrediens fra engelsk til norsk. Svar KUN med JSON på formen {"name":"..."} uten ekstra tekst. Ingrediens: "${rawText}"`;

  try {
    // llmChat er den generelle low-level chat-funksjonen i llm.js
    if (typeof llm.llmChat !== 'function') return null;
    const result = await llm.llmChat(
      [
        { role: 'system', content: 'Du er en oversettelses-assistent for matvarer.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.1, maxTokens: 64 }
    );

    // llmChat returnerer { type, content } — vi vil kun ha tekst-svar
    const responseText =
      typeof result === 'string'
        ? result
        : result && result.type === 'text'
          ? result.content
          : null;
    if (!responseText) return null;

    // Prøv å parse JSON fra svaret (kan være innpakket i markdown-fence)
    const jsonMatch = responseText.match(/\{[^{}]*"name"[^{}]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.name) return null;

    // Cache
    repos.llmCache.set(cacheKey, {
      model: llm.OLLAMA_MODEL || 'unknown',
      prompt,
      response: JSON.stringify({ name: parsed.name }),
      ttlSeconds: 30 * 86400,
    });

    return { name: parsed.name, source: 'llm' };
  } catch (err) {
    logger.warn({ err: err.message, rawText }, 'normalizer: LLM-fallback feilet');
    return null;
  }
}

// ============================================================
// Public API
// ============================================================

const DICT_COVERAGE_THRESHOLD = 0.8;

/**
 * Synkron normalisering — kun ordbok, ingen LLM. Brukes fra
 * shopping-list.service.generateForWeek (som er synkron).
 *
 * @param {Object} input
 * @param {string} input.name — ingrediensnavn (kan inneholde qty/unit innbakt)
 * @param {number} [input.qty] — qty hvis allerede kjent
 * @param {string} [input.unit] — unit hvis allerede kjent
 * @returns {{nameOriginal, nameNo, qty, unit, language, confidence, source}}
 */
function normalizeSync({ name, qty = null, unit = null }) {
  const nameOriginal = (name || '').trim();
  if (!nameOriginal) {
    return {
      nameOriginal: '',
      nameNo: '',
      qty,
      unit,
      language: 'unknown',
      confidence: 0,
      source: 'passthrough',
    };
  }

  // Utvinn qty/unit hvis ikke oppgitt
  let workingName = nameOriginal;
  if (qty == null || unit == null) {
    const extracted = extractQtyUnit(nameOriginal);
    if (extracted.qty != null && qty == null) qty = extracted.qty;
    if (extracted.unit != null && unit == null) unit = extracted.unit;
    if (extracted.qty != null || extracted.unit != null) {
      workingName = extracted.textWithoutQty;
    }
  }

  const language = detectLanguage(workingName);

  // Norsk eller ukjent → passthrough (fjern kun stopp-ord som ikke er norske)
  if (language === 'no' || language === 'unknown') {
    const cleaned = workingName.replace(/\s+/g, ' ').trim();
    return {
      nameOriginal,
      nameNo: cleaned.toLowerCase(),
      qty,
      unit,
      language,
      confidence: language === 'no' ? 1.0 : 0.5,
      source: 'passthrough',
    };
  }

  // Engelsk → dict-oversett
  const dictResult = translateViaDict(workingName);
  const converted = maybeConvertCup(qty, unit, dictResult.name);

  return {
    nameOriginal,
    nameNo: dictResult.name,
    qty: converted.qty,
    unit: converted.unit,
    language: 'en',
    confidence: dictResult.coverage,
    source: 'dict',
    needsLlm: dictResult.coverage < DICT_COVERAGE_THRESHOLD,
  };
}

/**
 * Asynkron normalisering — kan falle tilbake til LLM hvis dict-dekning
 * er lav. Brukes av enricher (som allerede er async).
 */
async function normalize(repos, input) {
  const dictRes = normalizeSync(input);
  if (!dictRes.needsLlm || dictRes.language !== 'en') return dictRes;

  const llmRes = await translateViaLlm(repos, dictRes.nameOriginal);
  if (!llmRes) return dictRes; // LLM ikke tilgjengelig → behold dict-resultat

  // Kjør en ny dict-runde på LLM-output for stopp-ord-fjerning + unit-konvertering
  const cleaned = translateViaDict(llmRes.name);
  const converted = maybeConvertCup(dictRes.qty, dictRes.unit, cleaned.name || llmRes.name);

  return {
    ...dictRes,
    nameNo: cleaned.name || llmRes.name,
    qty: converted.qty,
    unit: converted.unit,
    confidence: Math.max(dictRes.confidence, 0.85),
    source: llmRes.source, // 'llm' eller 'llm_cache'
    needsLlm: false,
  };
}

/**
 * Reset dict cache — brukes av tester som vil re-laste ordboka.
 */
function _resetDictionaryCache() {
  _dict = null;
}

module.exports = {
  normalize,
  normalizeSync,
  detectLanguage,
  translateViaDict,
  extractQtyUnit,
  maybeConvertCup,
  DICT_COVERAGE_THRESHOLD,
  _resetDictionaryCache,
};
