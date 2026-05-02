// @ts-check
/**
 * Phase F — Canonical productKey slugification.
 *
 * All product names coming in from the UI (pantry, shopping, manual
 * add) MUST go through this function. Goal: same item = same key
 * regardless of whether it came from Kassal, pantry history or a
 * free-form name.
 *
 * Rules:
 *  - Lowercase
 *  - Æ → e, Ø → o, Å → a (Norwegian → ASCII)
 *  - Hyphen and underscore → nothing
 *  - Whitespace → hyphen
 *  - All other non-alphanumeric characters removed
 *  - Trim to a max of 64 chars
 *
 * @param {unknown} name - Raw product name from UI or API
 * @returns {string} Canonical lowercase slug (max 64 chars), or empty
 *     string on invalid input
 */
function slugifyProductKey(name) {
  if (!name || typeof name !== 'string') return '';
  return (
    name
      .toLowerCase()
      .trim()
      // Norwegian characters
      .replace(/æ/g, 'e')
      .replace(/ø/g, 'o')
      .replace(/å/g, 'a')
      // All diacritic characters
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Whitespace → hyphen
      .replace(/\s+/g, '-')
      // Strip anything that is not a-z, 0-9 or hyphen
      .replace(/[^a-z0-9-]/g, '')
      // Collapse repeated hyphens
      .replace(/-+/g, '-')
      // Strip leading/trailing
      .replace(/^-+|-+$/g, '')
      // Max length
      .slice(0, 64)
  );
}

module.exports = { slugifyProductKey };
