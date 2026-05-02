// Ingredient normalizer (Iteration 3b phase C)
//
// Responsibilities:
//   1. Detect language (EN vs NO) of an ingredient name
//   2. Translate EN → NO via static dictionary (multi_word first, then
//      single_word)
//   3. Strip stop words (fresh, chopped, finely, large, …)
//   4. Extract qty + unit from a free-form string (e.g. "400g ground
//      beef" → qty=400, unit='g', name='ground beef')
//   5. Cup-to-gram conversion for common dry goods
//   6. LLM fallback when the dictionary does not cover enough words
//      (>20% unknown), cached in llm_cache with a stable key
//
// Design choices:
//   - Pure function (except the LLM fallback which takes repos for the
//     cache). Can be used both synchronously (dict-only) via
//     normalizeSync() and asynchronously (with LLM fallback) via
//     normalize().
//   - 80% threshold: if at least 80% of "significant tokens" (after
//     stop-word removal) are in the dictionary, accept the dict result.
//     Otherwise → LLM.
//   - LLM call uses the existing llm_cache (key:
//     'ingr_tr:<lowercase raw>'). TTL is 30 days — translations are
//     stable.
//   - If LLM is not available (no Ollama) → pass through the dict
//     result even if below threshold. Better than failing.
//   - Norwegian input is pass-through — we do not try to normalise
//     NO→NO except for qty/unit extraction and lowercase trim.

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
    // Pre-compute sorted multi-word keys (longest first) for match priority
    _dict._multiWordKeysSorted = Object.keys(_dict.multi_word || {}).sort(
      (a, b) => b.length - a.length
    );
    _dict._stopWordsSet = new Set(_dict.stop_words || []);
  } catch (err) {
    logger.error({ err: err.message, filePath }, 'normalizer: failed to load dictionary');
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
// Language detection
// ============================================================

// Norwegian-only characters indicate NO
const NORWEGIAN_CHARS = /[æøåÆØÅ]/;

// Heuristic: a string with no æøå AND that contains at least one
// English dictionary word → probably EN. Strings with æøå → NO.
function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'unknown';
  if (NORWEGIAN_CHARS.test(text)) return 'no';

  const dict = loadDictionary();
  const lowered = text.toLowerCase();
  const tokens = tokenize(lowered);

  // Check multi-word first
  for (const phrase of dict._multiWordKeysSorted) {
    if (lowered.includes(phrase)) return 'en';
  }
  // Then single-word
  for (const tok of tokens) {
    if (dict.single_word[tok]) return 'en';
  }
  // No match — unknown, treated as NO (passthrough)
  return 'unknown';
}

// ============================================================
// Tokenisation and qty/unit extraction
// ============================================================

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[()[\],;]/g, ' ') // characters that split words
    .split(/\s+/)
    .filter(Boolean);
}

// Regex that matches "400g", "1.5 kg", "2 cups", "1/2 tsp", "3 stk"
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
  // Handles "1/2", "3/4", etc.
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
// Translation (static dictionary)
// ============================================================

/**
 * Strip stop words from a token list.
 */
function stripStopWords(tokens) {
  const dict = loadDictionary();
  return tokens.filter((t) => !dict._stopWordsSet.has(t));
}

/**
 * Translate EN → NO via dict. Returns { name, coverage, source }.
 * coverage = fraction of significant tokens (in the original text, after
 * stop-word removal) that were hit by either multi-word or single-word
 * rules.
 */
function translateViaDict(text) {
  const dict = loadDictionary();
  const lowered = text.toLowerCase().trim();

  // Count significant tokens in the original text — this is the
  // denominator for coverage
  const origSignificantCount = stripStopWords(tokenize(lowered)).length;

  let working = lowered;
  let hits = 0;
  // Mark tokens that come from a replacement (so we don't double-count
  // in the single-word phase)
  const replacedTokenSet = new Set();

  // 1. Multi-word replacements (longest first for correct priority)
  for (const phrase of dict._multiWordKeysSorted) {
    while (working.includes(phrase)) {
      const phraseSigCount = stripStopWords(tokenize(phrase)).length;
      hits += phraseSigCount;
      const replacement = dict.multi_word[phrase];
      // Mark replacement tokens (they "belong to" multi-word coverage)
      for (const tok of tokenize(replacement)) replacedTokenSet.add(tok);
      working = working.replace(phrase, replacement);
    }
  }

  // 2. Tokenise post-replace, strip stop-words, translate single tokens
  const tokens = tokenize(working);
  const significant = stripStopWords(tokens);

  const translated = significant.map((tok) => {
    // Already covered by a multi-word replacement — don't double-count
    if (replacedTokenSet.has(tok)) return tok;
    if (dict.single_word[tok]) {
      hits++;
      return dict.single_word[tok];
    }
    // Unknown token — keep as-is
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
// Cup conversion (dry goods)
// ============================================================

/**
 * If qty+unit is cup and the name is a known dry good, convert to grams.
 * Returns { qty, unit } unchanged if no conversion is possible.
 */
function maybeConvertCup(qty, unit, nameNo) {
  if (qty == null || unit == null) return { qty, unit };
  if (unit !== 'cup' && unit !== 'cups') return { qty, unit };

  const dict = loadDictionary();
  const table = dict.unit_conversions && dict.unit_conversions.cup;
  if (!table) return { qty, unit };

  // Find the first matching key in nameNo (token substring)
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
 * Ask the LLM to translate an unknown ingredient name to Norwegian.
 * Caches in llm_cache with a 30-day TTL.
 * Returns null if the LLM is not available or fails.
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
      /* ignore, fall through */
    }
  }

  // Dynamic require of llm to avoid require cycle (llm uses repos)
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
    // llmChat is the general low-level chat function in llm.js
    if (typeof llm.llmChat !== 'function') return null;
    const result = await llm.llmChat(
      [
        { role: 'system', content: 'Du er en oversettelses-assistent for matvarer.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.1, maxTokens: 64 }
    );

    // llmChat returns { type, content } — we only want text answers
    const responseText =
      typeof result === 'string'
        ? result
        : result && result.type === 'text'
          ? result.content
          : null;
    if (!responseText) return null;

    // Try to parse JSON from the response (may be wrapped in a markdown fence)
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
    logger.warn({ err: err.message, rawText }, 'normalizer: LLM fallback failed');
    return null;
  }
}

// ============================================================
// Public API
// ============================================================

const DICT_COVERAGE_THRESHOLD = 0.8;

/**
 * Synchronous normalisation — dict only, no LLM. Used by
 * shopping-list.service.generateForWeek (which is synchronous).
 *
 * @param {Object} input
 * @param {string} input.name — ingredient name (may include qty/unit
 *     embedded)
 * @param {number} [input.qty] — qty if already known
 * @param {string} [input.unit] — unit if already known
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

  // Extract qty/unit if not provided
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

  // Norwegian or unknown → passthrough (only strip non-Norwegian stop words)
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

  // English → dict translate
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
 * Asynchronous normalisation — can fall back to LLM when dict coverage
 * is low. Used by the enricher (which is already async).
 */
async function normalize(repos, input) {
  const dictRes = normalizeSync(input);
  if (!dictRes.needsLlm || dictRes.language !== 'en') return dictRes;

  const llmRes = await translateViaLlm(repos, dictRes.nameOriginal);
  if (!llmRes) return dictRes; // LLM not available → keep dict result

  // Run another dict pass on LLM output for stop-word stripping + unit conversion
  const cleaned = translateViaDict(llmRes.name);
  const converted = maybeConvertCup(dictRes.qty, dictRes.unit, cleaned.name || llmRes.name);

  return {
    ...dictRes,
    nameNo: cleaned.name || llmRes.name,
    qty: converted.qty,
    unit: converted.unit,
    confidence: Math.max(dictRes.confidence, 0.85),
    source: llmRes.source, // 'llm' or 'llm_cache'
    needsLlm: false,
  };
}

/**
 * Reset dict cache — used by tests that want to reload the dictionary.
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
