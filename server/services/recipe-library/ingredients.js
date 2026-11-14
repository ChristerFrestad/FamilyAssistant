'use strict';

// Known kitchen units. An unknown token is not guessed as "stk".
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

function knownUnit(token) {
  if (!token) return null;
  return UNIT_ALIASES[String(token).toLowerCase()] || null;
}

/**
 * Split a Norwegian ingredient line. "1.00 kg poteter" and
 * "2 ss / tbsp smør" parse. Anything we are not sure about keeps
 * the raw line and leaves qty/unit empty.
 * @param {string} line
 */
function parseLibraryIngredient(line) {
  const rawLine = String(line || '').trim();
  if (!rawLine) return null;
  const stripped = rawLine.replace(/^ca\.?\s+/i, '');
  const qtyMatch = /^(\d+(?:[.,]\d+)?)\s+(.+)$/.exec(stripped);
  if (!qtyMatch) return { rawLine, qty: null, unit: null, name: rawLine };
  const qty = Number(qtyMatch[1].replace(',', '.'));
  if (!Number.isFinite(qty)) return { rawLine, qty: null, unit: null, name: rawLine };
  const rest = qtyMatch[2];
  const unitMatch = /^([A-Za-zÆØÅæøå]+)(?:\s*\/\s*([A-Za-zÆØÅæøå]+))?\s+(.+)$/.exec(rest);
  if (!unitMatch) return { rawLine, qty: null, unit: null, name: rawLine };
  const unit = knownUnit(unitMatch[1]) || knownUnit(unitMatch[2]);
  if (!unit) return { rawLine, qty: null, unit: null, name: rawLine };
  return { rawLine, qty, unit, name: unitMatch[3].trim() };
}

module.exports = { parseLibraryIngredient, knownUnit };
