'use strict';

// Learned store-walk order for shopping-list categories.
//
// Idea (pattern only, own implementation): the order in which a family
// ticks items off while in the shop tells us how they walk the store.
// If they always take produce first and dairy last, the list should show
// categories in that order. Inspired by KitchenOwl's item ordering
// (AGPL-3.0; no code reused, only the idea).
//
// Pure functions. No DB access here; the repo supplies bought history.

const DEFAULT_TRIP_GAP_MINUTES = 45;
const DEFAULT_MIN_TRIPS = 2;
const DEFAULT_MIN_CATEGORIES_PER_TRIP = 2;

function parseTime(value) {
  if (!value) return NaN;
  // SQLite datetime('now') gives 'YYYY-MM-DD HH:MM:SS' in UTC.
  const iso = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T') + 'Z';
  return Date.parse(iso);
}

/**
 * Split bought history into shopping trips.
 * A trip is a run of check-offs on the same list with no gap longer than
 * `gapMinutes`. Each trip is the list of categories in the order they
 * were first ticked off.
 *
 * @param {Array<{listId:number, category:string|null, boughtAt:string}>} rows
 * @returns {string[][]}
 */
function splitIntoTrips(rows, { gapMinutes = DEFAULT_TRIP_GAP_MINUTES } = {}) {
  const byList = new Map();
  for (const r of rows || []) {
    const t = parseTime(r.boughtAt);
    if (!Number.isFinite(t)) continue;
    const cat = r.category || 'other';
    if (!byList.has(r.listId)) byList.set(r.listId, []);
    byList.get(r.listId).push({ cat, t });
  }
  const trips = [];
  const gapMs = gapMinutes * 60 * 1000;
  for (const events of byList.values()) {
    events.sort((a, b) => a.t - b.t);
    let current = [];
    let lastT = null;
    for (const e of events) {
      if (lastT !== null && e.t - lastT > gapMs) {
        trips.push(current);
        current = [];
      }
      if (!current.includes(e.cat)) current.push(e.cat);
      lastT = e.t;
    }
    if (current.length) trips.push(current);
  }
  return trips;
}

/**
 * Learn a category order from trips. Each category gets the mean of its
 * normalised position (0 = first, 1 = last) over the trips it appears in.
 * Categories seen in fewer than `minTrips` trips are left out, so a
 * single odd trip does not reorder the list.
 *
 * @param {string[][]} trips
 * @returns {string[]} learned order (may be empty)
 */
function learnCategoryOrder(
  trips,
  { minTrips = DEFAULT_MIN_TRIPS, minCategoriesPerTrip = DEFAULT_MIN_CATEGORIES_PER_TRIP } = {}
) {
  const stats = new Map();
  const usable = (trips || []).filter((t) => t.length >= minCategoriesPerTrip);
  if (usable.length < minTrips) return [];
  for (const trip of usable) {
    const n = trip.length;
    trip.forEach((cat, i) => {
      const pos = i / (n - 1);
      const s = stats.get(cat) || { sum: 0, count: 0 };
      s.sum += pos;
      s.count += 1;
      stats.set(cat, s);
    });
  }
  return Array.from(stats.entries())
    .filter(([, s]) => s.count >= minTrips)
    .map(([cat, s]) => ({ cat, mean: s.sum / s.count }))
    .sort((a, b) => a.mean - b.mean || a.cat.localeCompare(b.cat, 'nb'))
    .map((x) => x.cat);
}

/**
 * Reorder `[category, items]` entries: learned categories first in learned
 * order, then the rest in their original order. Stable and total: never
 * drops or duplicates an entry.
 */
function applyLearnedOrder(entries, learnedOrder) {
  if (!Array.isArray(learnedOrder) || learnedOrder.length === 0) return entries;
  const rank = new Map(learnedOrder.map((c, i) => [c, i]));
  return entries
    .map((e, i) => ({ e, i, r: rank.has(e[0]) ? rank.get(e[0]) : Infinity }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.e);
}

module.exports = {
  splitIntoTrips,
  learnCategoryOrder,
  applyLearnedOrder,
  DEFAULT_TRIP_GAP_MINUTES,
  DEFAULT_MIN_TRIPS,
};
