// @ts-check
/**
 * B7 / D7 lag 2 — SOFT filter for mislikte ingredienser.
 *
 * Mens allergy-filter er safety-laget (binær blokkering, ingen override),
 * er dislike-filter komfort-laget: oppskrifter med mislikte ingredienser
 * vises ALLTID, men UI merker ingrediensen med "Lise misliker sopp".
 *
 * Fallback-semantikk (D6): et medlem med dislikes=null arver
 * familyDislikes fra family_profile. Et medlem med dislikes=[] har
 * eksplisitt "ingen mislikte" (ikke fall tilbake).
 *
 * Matching: enkel case-insensitiv substring. I motsetning til
 * allergy-filter brukes det IKKE et utvidet trigger-synonym-kart
 * (ingen `ALLERGY_TRIGGERS`-tilsvarende) fordi dislikes er personlige
 * og bruker skriver dem ferdig. "Sopp" matcher "sopp", "champignon",
 * "skogsopp" hvis bruker skriver "sopp" i dislike-listen, men gjør det
 * ikke for "aubergine" ved mindre bruker har skrevet "aubergine".
 *
 * Design-note: dislikes og allergies kan peke på samme ord (noen
 * misliker melk UTEN å være laktoseallergiker). Det er OK — de fanges
 * av forskjellige lag, og dislike-filter rapporterer den ingrediensen
 * selv om allergy-filter også gjorde det. Call site bestemmer om de
 * vises som warning eller skjuler raden helt.
 */

/**
 * @typedef {import('./allergy-filter.service').FamilyMemberContext} FamilyMemberContext
 * @typedef {import('./allergy-filter.service').FamilyContext} FamilyContext
 */

/**
 * @typedef {object} DislikeWarning
 * @property {string} ingredient - Ingrediens-navn fra oppskriften
 * @property {string[]} dislikedBy - Navn på medlemmer som misliker denne
 * @property {string[]} triggers - Dislike-strenger som matchet
 */

/**
 * @typedef {object} DislikeCheckResult
 * @property {boolean} hasWarnings
 * @property {DislikeWarning[]} warnings
 * @property {string[]} effectiveDislikes - Union across all members
 */

function effectiveDislikesForMember(member, familyDislikes) {
  if (member.dislikes === null || member.dislikes === undefined) {
    return Array.isArray(familyDislikes) ? familyDislikes : [];
  }
  return Array.isArray(member.dislikes) ? member.dislikes : [];
}

/**
 * Check a recipe against a family context (per-member dislikes).
 * Never blocks — returns warnings only.
 *
 * @param {{ingredients?: Array<{name?: string, ingredient?: string}>}} recipe
 * @param {FamilyContext} familyContext
 * @returns {DislikeCheckResult}
 */
function checkRecipeForFamily(recipe, familyContext) {
  const fd = Array.isArray(familyContext?.familyDislikes) ? familyContext.familyDislikes : [];
  const members = Array.isArray(familyContext?.members) ? familyContext.members : [];

  const effectiveMembers =
    members.length > 0
      ? members.map((m) => ({
          name: m.name || 'Ukjent',
          effective: effectiveDislikesForMember(m, fd),
        }))
      : [{ name: 'familie', effective: fd }];

  const unionDislikes = new Set();
  for (const m of effectiveMembers) {
    for (const d of m.effective) {
      if (typeof d === 'string' && d.trim()) unionDislikes.add(d.trim());
    }
  }

  /** @type {DislikeWarning[]} */
  const warnings = [];
  const ingredients = recipe?.ingredients || [];

  for (const ing of ingredients) {
    const rawName = (ing && (ing.name || ing.ingredient)) || '';
    if (typeof rawName !== 'string' || !rawName.trim()) continue;
    const lower = rawName.toLowerCase();

    const dislikedByMembers = new Set();
    const triggers = new Set();

    for (const m of effectiveMembers) {
      for (const dislike of m.effective) {
        if (typeof dislike !== 'string' || !dislike.trim()) continue;
        const d = dislike.toLowerCase().trim();
        if (lower.includes(d)) {
          dislikedByMembers.add(m.name);
          triggers.add(dislike.trim());
        }
      }
    }

    if (dislikedByMembers.size > 0) {
      warnings.push({
        ingredient: rawName,
        dislikedBy: Array.from(dislikedByMembers).sort(),
        triggers: Array.from(triggers).sort(),
      });
    }
  }

  return {
    hasWarnings: warnings.length > 0,
    warnings,
    effectiveDislikes: Array.from(unionDislikes),
  };
}

module.exports = {
  checkRecipeForFamily,
  effectiveDislikesForMember,
};
