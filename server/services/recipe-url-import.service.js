'use strict';

// Recipe URL import — fetches an HTML page and extracts a structured
// recipe from JSON-LD (schema.org/Recipe). Supports matprat.no, godt.no,
// and any generic site that embeds <script type="application/ld+json">
// with a Recipe object. Returns a payload shaped for recipes.insert().
//
// Out of scope: Instagram (auth required), Pinterest (API token),
// TikTok (heavy anti-scraping). Those paste attempts fail cleanly.

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000; // ~2 MB, enough for any recipe page
const USER_AGENT = 'FamilyAssistant/1.0 (+https://github.com/ChristerFrestad/FamilyAssistant)';

const BLOCKED_HOST_SUFFIXES = [
  'instagram.com',
  'www.instagram.com',
  'pinterest.com',
  'www.pinterest.com',
  'pin.it',
  'tiktok.com',
  'www.tiktok.com',
];

const BLOCKED_HOST_MSGS = {
  instagram: 'Instagram-lenker krever innlogging og kan ikke importeres automatisk.',
  pinterest: 'Pinterest-lenker krever API-token og kan ikke importeres automatisk.',
  tiktok: 'TikTok-lenker kan ikke importeres automatisk.',
};

function assertSupportedUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Ugyldig URL.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('URL må begynne med http:// eller https://');
  }
  const host = u.hostname.toLowerCase();
  for (const bad of BLOCKED_HOST_SUFFIXES) {
    if (host === bad || host.endsWith('.' + bad)) {
      const key = bad.includes('instagram')
        ? 'instagram'
        : bad.includes('pinterest') || bad === 'pin.it'
          ? 'pinterest'
          : 'tiktok';
      throw new Error(BLOCKED_HOST_MSGS[key]);
    }
  }
  // Block private/loopback ranges as a simple SSRF guard.
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|localhost$)/i.test(host)) {
    throw new Error('URL må peke til en offentlig nettside.');
  }
  return u;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`Kilden svarte med HTTP ${res.status}.`);
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.includes('html')) {
      throw new Error(`Kilden returnerte ${ct || 'ukjent type'}, ikke HTML.`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_HTML_BYTES) {
      throw new Error('Siden er for stor til å lese (> 2 MB).');
    }
    return new TextDecoder('utf-8').decode(buf);
  } finally {
    clearTimeout(timeout);
  }
}

// Extract all <script type="application/ld+json">...</script> blocks.
// Returns parsed JSON objects (non-Recipe entries are filtered by caller).
function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Some sites emit JSON with HTML entities inside strings. Try a
      // naive unescape before giving up.
      try {
        out.push(JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
      } catch {
        // skip malformed block
      }
    }
  }
  return out;
}

function isRecipeNode(node) {
  if (!node || typeof node !== 'object') return false;
  const t = node['@type'];
  if (!t) return false;
  if (typeof t === 'string') return t === 'Recipe';
  if (Array.isArray(t)) return t.includes('Recipe');
  return false;
}

// Walk JSON-LD structures (may be flat, array, or @graph) and yield the
// first Recipe node found.
function findRecipeNode(jsonLdEntries) {
  for (const entry of jsonLdEntries) {
    if (Array.isArray(entry)) {
      const found = findRecipeNode(entry);
      if (found) return found;
      continue;
    }
    if (isRecipeNode(entry)) return entry;
    if (entry && Array.isArray(entry['@graph'])) {
      const found = findRecipeNode(entry['@graph']);
      if (found) return found;
    }
  }
  return null;
}

// "PT30M" / "PT1H15M" → "30 min" / "1 t 15 min"
function parseIsoDuration(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?/i.exec(iso.trim());
  if (!m) return null;
  const hours = m[1] ? Number(m[1]) : 0;
  const mins = m[2] ? Number(m[2]) : 0;
  if (!hours && !mins) return null;
  if (hours && mins) return `${hours} t ${mins} min`;
  if (hours) return `${hours} t`;
  return `${mins} min`;
}

function textOf(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val)) return val.map(textOf).filter(Boolean).join('; ');
  if (typeof val === 'object') {
    if (typeof val.text === 'string') return val.text.trim();
    if (typeof val.name === 'string') return val.name.trim();
  }
  return '';
}

// Heuristic: try to split an ingredient string like "200 g laks" into
// { name, qty, unit }. The recipes.insert() schema requires qty + unit,
// so when parsing fails we fall back to qty=1, unit='stk' with the full
// string as name — downstream product resolution still works.
function parseIngredientLine(line) {
  const s = String(line || '').trim();
  if (!s) return null;
  // Pattern: "400 g laks", "1 dl fløte", "2 ts olje"
  const m = /^(\d+(?:[.,]\d+)?)\s*([a-zA-ZøåæÅÆØ]+)\s+(.+)$/.exec(s);
  if (m) {
    const qty = Number(m[1].replace(',', '.'));
    const unit = m[2].toLowerCase();
    const name = m[3].trim();
    if (Number.isFinite(qty)) return { name, qty, unit };
  }
  return { name: s, qty: 1, unit: 'stk' };
}

function inferSourceLabel(urlObj) {
  const host = urlObj.hostname.toLowerCase();
  if (host.endsWith('matprat.no')) return 'matprat';
  if (host.endsWith('godt.no')) return 'godt';
  return host;
}

function inferCategory(recipe) {
  // schema.org recipeCategory is free text; we map into our 3-bucket enum.
  const cat = String(recipe.recipeCategory || '').toLowerCase();
  if (/(hverdag|rask|quick)/.test(cat)) return 'rask';
  if (/(helg|fest|weekend|søndag|sondag|party)/.test(cat)) return 'helg';
  // Total time hint: <30 min → rask, >60 min → helg, else comfort.
  const total = parseIsoDuration(recipe.totalTime) || parseIsoDuration(recipe.cookTime);
  if (total && /^(\d+) min$/.test(total)) {
    const mins = Number(total.replace(' min', ''));
    if (mins <= 30) return 'rask';
    if (mins >= 60) return 'helg';
  }
  return 'comfort';
}

function mapRecipeNode(node, urlObj) {
  const name = textOf(node.name) || 'Importert oppskrift';
  const prepTime = parseIsoDuration(node.totalTime) || parseIsoDuration(node.cookTime);
  const servingsRaw = node.recipeYield;
  const servings = (() => {
    if (!servingsRaw) return 2;
    if (typeof servingsRaw === 'number') return Math.max(1, Math.round(servingsRaw));
    const n = parseInt(String(servingsRaw), 10);
    return Number.isFinite(n) && n > 0 ? n : 2;
  })();
  const rawIngs = Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [];
  const ingredients = rawIngs.map(parseIngredientLine).filter(Boolean);

  let instructions = [];
  if (Array.isArray(node.recipeInstructions)) {
    instructions = node.recipeInstructions.map(textOf).filter(Boolean);
  } else if (typeof node.recipeInstructions === 'string') {
    instructions = node.recipeInstructions
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    name,
    category: inferCategory(node),
    prepTime: prepTime,
    servings,
    url: urlObj.toString(),
    source: inferSourceLabel(urlObj),
    ingredients,
    notes: instructions.length ? instructions.join('\n') : null,
  };
}

async function importRecipeFromUrl(rawUrl) {
  const urlObj = assertSupportedUrl(rawUrl);
  const html = await fetchHtml(urlObj);
  const jsonLd = extractJsonLd(html);
  if (jsonLd.length === 0) {
    throw new Error('Fant ingen strukturerte oppskriftsdata (JSON-LD) på siden.');
  }
  const recipeNode = findRecipeNode(jsonLd);
  if (!recipeNode) {
    throw new Error('Siden har JSON-LD, men ingen Recipe-node.');
  }
  return mapRecipeNode(recipeNode, urlObj);
}

module.exports = {
  importRecipeFromUrl,
  // Exported for tests
  extractJsonLd,
  findRecipeNode,
  mapRecipeNode,
  parseIsoDuration,
  parseIngredientLine,
  assertSupportedUrl,
};
