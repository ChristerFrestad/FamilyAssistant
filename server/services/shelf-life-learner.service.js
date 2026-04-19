'use strict';

// PR A.2 — Shelf-life learner.
//
// Responsibilities:
//   1. Record a new observation (purchase_date, expiry_date) for a product.
//   2. Recompute the product's learned shelf_days via a trimmed mean so
//      one-off outliers (e.g. "I forgot it 3 weeks") do not poison the
//      value.
//   3. Expose effectiveShelfDays() for callers of inventory.addPurchase
//      so new purchases pick up the learned value as soon as the sample
//      count crosses the trust threshold.
//
// products.shelf_days_learned and products.shelf_days_sample_count are
// global (the products table isn't yet family-scoped). Documented in the
// plan as a per-product-global simplification for the single-pilot-family
// deploy.

const MIN_SAMPLES_TO_TRUST = 3;
const RECENT_SAMPLE_WINDOW = 10;

/**
 * Compute a trimmed mean of the days-lasted samples.
 * For N >= 5 we drop the min and max to mute single-event outliers.
 * For smaller N we return the plain mean (still meaningful after
 * MIN_SAMPLES_TO_TRUST).
 */
function trimmedMean(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  // Keep only real, finite, non-negative numbers. Strings, null, and
  // undefined are dropped outright instead of being coerced to 0/NaN.
  const nums = samples.filter(
    (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0
  );
  if (nums.length === 0) return null;
  let kept = nums;
  if (nums.length >= 5) {
    const sorted = [...nums].sort((a, b) => a - b);
    kept = sorted.slice(1, -1); // drop min and max
  }
  const sum = kept.reduce((acc, n) => acc + n, 0);
  return Math.round(sum / kept.length);
}

function createShelfLifeLearner(repos, db) {
  const updateLearnedStmt = db.prepare(
    `UPDATE products
        SET shelf_days_learned = ?, shelf_days_sample_count = ?
      WHERE product_key = ?`
  );

  /**
   * Insert an observation and recompute the product's learned average.
   * Returns { observationId, daysLasted, sampleCount, learnedDays }.
   *
   * When sample count is below MIN_SAMPLES_TO_TRUST we still store the
   * observation but do NOT promote it to shelf_days_learned (consumers
   * keep using the seeded value). That keeps a single data-entry mistake
   * from pulling the learned value far from reality.
   */
  function recordObservation({ productKey, purchasedAt, expiresAt, source }) {
    if (!productKey) throw new Error('productKey is required');
    if (!purchasedAt || !expiresAt) throw new Error('purchasedAt and expiresAt are required');
    const { id: observationId, daysLasted } = repos.shelfObservations.insert({
      productKey,
      purchasedAt,
      expiresAt,
      source,
    });

    const sampleCount = repos.shelfObservations.countForProduct(productKey);
    let learnedDays = null;
    if (sampleCount >= MIN_SAMPLES_TO_TRUST) {
      const samples = repos.shelfObservations.getRecentDaysLasted(productKey, RECENT_SAMPLE_WINDOW);
      learnedDays = trimmedMean(samples);
    }
    updateLearnedStmt.run(learnedDays, sampleCount, productKey);

    return { observationId, daysLasted, sampleCount, learnedDays };
  }

  /**
   * Pick the shelf_days value to use for a new purchase. Trusts the
   * learned value once the sample count is above the threshold; otherwise
   * falls back to the seeded products.shelf_days.
   */
  function effectiveShelfDays(product) {
    if (!product) return null;
    const learned = product.shelf_days_learned ?? product.shelfDaysLearned;
    const count = product.shelf_days_sample_count ?? product.shelfDaysSampleCount ?? 0;
    if (learned != null && count >= MIN_SAMPLES_TO_TRUST) return Number(learned);
    const seeded = product.shelf_days ?? product.shelfDays;
    return seeded != null ? Number(seeded) : null;
  }

  /**
   * Summary used by GET /api/products/:productKey/shelf-life.
   */
  function summarizeProduct(productKey, product) {
    const sampleCount = repos.shelfObservations.countForProduct(productKey);
    const learned = product?.shelf_days_learned ?? product?.shelfDaysLearned ?? null;
    const seeded = product?.shelf_days ?? product?.shelfDays ?? null;
    const effective = effectiveShelfDays(product);
    const recent = repos.shelfObservations.getRecentForProduct(productKey, 5);
    return {
      sampleCount,
      learnedDays: learned != null ? Number(learned) : null,
      seedDays: seeded != null ? Number(seeded) : null,
      effectiveDays: effective != null ? Number(effective) : null,
      recentObservations: recent,
    };
  }

  return { recordObservation, effectiveShelfDays, summarizeProduct };
}

module.exports = {
  createShelfLifeLearner,
  trimmedMean,
  MIN_SAMPLES_TO_TRUST,
  RECENT_SAMPLE_WINDOW,
};
