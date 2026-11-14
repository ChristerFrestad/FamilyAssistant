'use strict';

// Known kitchen units. An unknown token is not guessed as "stk"
// when a quantity is missing. A bare count ("1 løk") is stk.
const UNIT_ALIASES = {
  ss: 'ss',
  spiseskje: 'ss',
  spiseskjeer: 'ss',
  tbsp: 'ss',
  tablespoon: 'ss',
  ts: 'ts',
  teskje: 'ts',
  teskjeer: 'ts',
  tsp: 'ts',
  dl: 'dl',
  ml: 'ml',
  cl: 'cl',
  l: 'l',
  liter: 'l',
  g: 'g',
  gram: 'g',
  kg: 'kg',
  stk: 'stk',
  stykk: 'stk',
  fedd: 'fedd',
  boks: 'boks',
  pakke: 'pakke',
  pk: 'pakke',
};

const VULGAR = {
  '½': 0.5,
  '⅓': 1 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅔': 2 / 3,
  '⅛': 0.125,
};

function knownUnit(token) {
  if (!token) return null;
  return UNIT_ALIASES[String(token).toLowerCase()] || null;
}

function parseNumberToken(token) {
  if (token == null) return null;
  const text = String(token).replace(/\s+/g, '');
  if (Object.prototype.hasOwnProperty.call(VULGAR, text)) return VULGAR[text];
  const slash = /^(\d+)\/(\d+)$/.exec(text);
  if (slash) {
    const den = Number(slash[2]);
    return den ? Number(slash[1]) / den : null;
  }
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * Split a Norwegian ingredient line.
 * Handles "1.00 kg poteter", "2 ss / tbsp smør", "½", "1/2",
 * ranges "2-3", and unitless counts "1 løk" / "2 store egg".
 * A range stores the lower number. Anything without a quantity
 * keeps the raw line.
 * @param {string} line
 */
function parseLibraryIngredient(line) {
  const rawLine = String(line || '').trim();
  if (!rawLine) return null;
  let text = rawLine.replace(/^ca\.?\s+/i, '');
  let qty;

  const range = /^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)(?:\s+(.+))?$/.exec(text);
  const mixed = /^(\d+)\s+([½⅓¼¾⅔⅛])(?:\s+(.+))?$/.exec(text);
  const glued = /^(\d+)([½⅓¼¾⅔⅛])(?:\s+(.+))?$/.exec(text);
  const frac = /^(\d+\s*\/\s*\d+|[½⅓¼¾⅔⅛])(?:\s+(.+))?$/.exec(text);
  const decimal = /^(\d+(?:[.,]\d+)?)(?:\s+(.+))?$/.exec(text);
  if (range) {
    qty = parseNumberToken(range[1]);
    text = (range[3] || '').trim();
  } else if (mixed || glued) {
    const hit = mixed || glued;
    qty = Number(hit[1]) + VULGAR[hit[2]];
    text = (hit[3] || '').trim();
  } else if (frac) {
    qty = parseNumberToken(frac[1]);
    text = (frac[2] || '').trim();
  } else if (decimal) {
    qty = parseNumberToken(decimal[1]);
    text = (decimal[2] || '').trim();
  } else {
    return { rawLine, qty: null, unit: null, name: rawLine };
  }
  if (qty == null) return { rawLine, qty: null, unit: null, name: rawLine };
  if (!text) return { rawLine, qty, unit: 'stk', name: rawLine };

  const unitMatch = /^([A-Za-zÆØÅæøå]+)(?:\s*\/\s*([A-Za-zÆØÅæøå]+))?(?:\s+(.+))?$/.exec(text);
  if (unitMatch) {
    const unit = knownUnit(unitMatch[1]) || knownUnit(unitMatch[2]);
    if (unit) {
      return { rawLine, qty, unit, name: (unitMatch[3] || rawLine).trim() };
    }
  }
  return { rawLine, qty, unit: 'stk', name: text };
}

module.exports = { parseLibraryIngredient, knownUnit };
