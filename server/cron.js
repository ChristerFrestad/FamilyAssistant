// Cron system for FamilyAssistant (Phase 1: uses repositories)
// No external dependencies \u2014 plain Node.js setTimeout.

const { getWeekYear } = require('./seed');
const { generateSundayDraft } = require('./services/meal-planning.service');
const { applyCpiIndexing } = require('./services/price-reference.service');
const { removeExpired } = require('./services/pantry.service');
const { enrichPendingLists } = require('./services/shopping-list-enricher.service');
const { purgeSoftDeletedUsers } = require('./auth/gdpr-routes');
const { logger } = require('./logger');

const activeTimers = new Set();
let cronStopped = false;

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[CRON ${ts}] ${msg}`);
}

function msUntilNext(dayOfWeek, hour, minute = 0) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  const currentDay = now.getDay();
  let daysUntil = dayOfWeek - currentDay;
  if (daysUntil < 0 || (daysUntil === 0 && now >= target)) daysUntil += 7;
  target.setDate(target.getDate() + daysUntil);
  return target.getTime() - now.getTime();
}

// === Job 1: Sunday push at 14:00 ===
function sundayPushJob(repos) {
  const nextWeekDate = new Date(Date.now() + 7 * 86400000);
  const nextWk = getWeekYear(nextWeekDate);

  if (repos.mealPlans.exists(nextWk)) {
    log(`Sunday push: week ${nextWk} already has a plan \u2014 skipping`);
    return;
  }

  const draft = generateSundayDraft(repos);
  repos.sundayDrafts.save(draft.weekYear, draft.meals);

  const names = draft.meals.map((s) => repos.recipes.getById(s.recipeId)?.name || '?').join(', ');
  log(`Sunday push: generated suggestion for ${draft.weekYear} \u2014 ${names}`);
  repos.notifications.insert('sunday_push', `Forslag til ukemeny for ${draft.weekYear} er klart`, {
    weekYear: draft.weekYear,
  });
}

// === Job 2: Shelf-life warnings (daily at 08:00) ===
function shelfLifeCheckJob(repos) {
  const today = new Date().toISOString().split('T')[0];
  const inventoryMap = repos.inventory.getAll();
  const productsMap = repos.products.getAllAsMap();
  const warnings = [];

  for (const [key, inv] of Object.entries(inventoryMap)) {
    if (!inv.expiresEst) continue;
    const expires = new Date(inv.expiresEst);
    const daysLeft = Math.ceil((expires.getTime() - Date.now()) / 86400000);
    if (daysLeft <= 1 && (inv.qtyRemaining || 0) > 0) {
      const product = productsMap[key];
      warnings.push({
        product: product ? product.productName : key,
        daysLeft,
        qtyRemaining: inv.qtyRemaining,
        unit: inv.unit,
        message:
          daysLeft <= 0
            ? `\u26a0\ufe0f ${product?.productName || key} har g\u00e5tt ut!`
            : `\u23f0 ${product?.productName || key} utl\u00f8per i morgen!`,
      });
    }
  }

  if (warnings.length > 0) {
    const summary = warnings.map((w) => w.product).join(', ');
    repos.notifications.insert(
      'shelf_life',
      `${warnings.length} varer utl\u00f8per snart: ${summary}`,
      { date: today, warnings }
    );
    log(`Shelf-life: ${warnings.length} items expiring soon: ${summary}`);
  } else {
    log('Shelf-life: all OK');
  }
}

// === Job 3: Inventory depletion (daily at 22:00) ===
function dailyDepletionJob(repos) {
  const wk = getWeekYear();
  const dayOfWeek = (new Date().getDay() + 6) % 7;
  const plan = repos.mealPlans.getWeek(wk);
  const todaySlot = plan.find((p) => p.dayOfWeek === dayOfWeek);

  if (!todaySlot || todaySlot.status === 'away' || todaySlot.status === 'skipped') {
    log('Depletion: no dinner today \u2014 skipping');
    return;
  }

  const recipe = repos.recipes.getById(todaySlot.recipeId);
  if (!recipe) {
    log(`Depletion: recipe ${todaySlot.recipeId} not found`);
    return;
  }

  // Reduce inventory for the recipe ingredients
  // (No outer tx \u2014 every operation is idempotent and reduceDaily has its own)
  const depleted = [];
  for (const ing of recipe.ingredients || []) {
    const key = ing.productKey || (ing.name || '').toLowerCase();
    const inv = repos.inventory.getByKey(key);
    if (inv && (inv.qtyRemaining || 0) > 0) {
      repos.inventory.reduceQty(key, ing.qty);
      depleted.push(`${key}: -${ing.qty}${ing.unit || ''}`);
    }
  }
  repos.consumables.reduceDaily(recipe.equipment || []);

  if (depleted.length > 0) {
    log(`Depletion: dinner "${recipe.name}" used: ${depleted.join(', ')}`);
  }
}

// === Job 4: Chore generation (Mondays at 07:00) ===
function weeklyChoresJob(repos) {
  const wk = getWeekYear();
  if (repos.choreSchedules.exists(wk)) {
    log(`Chores: week ${wk} already has a plan`);
    return;
  }
  repos.choreSchedules.seedDefault(wk);
  log(`Chores: created plan for week ${wk}`);
}

// === Job 5: LLM cache cleanup (daily at 04:00) ===
function llmCacheCleanupJob(repos) {
  const removed = repos.llmCache.cleanup();
  if (removed > 0) log(`LLM cache: removed ${removed} expired entries`);
}

// === Job 6: Pantry expired cleanup (daily at 08:05 — just after shelf-life warning) ===
function pantryExpiredJob(repos) {
  const removed = removeExpired(repos);
  if (removed > 0) log(`Pantry: removed ${removed} expired items from inventory`);
}

// === Jobb 7: CPI-indeksering av prisreferanser (m\u00e5nedlig — 1. i m\u00e5neden kl. 05:00) ===
// Bruker setTimeout-loop hver 24t men kj\u00f8rer kun hvis dato === 1.
function priceCpiIndexingJob(repos) {
  const now = new Date();
  if (now.getDate() !== 1) return;
  try {
    const n = applyCpiIndexing(repos);
    log(`Price CPI: updated ${n} price references`);
  } catch (err) {
    log(`Price CPI ERROR: ${err.message}`);
  }
}

// === Job 8: Shopping list enrichment (every 10 minutes) ===
// Picks up lists with enrichment_status='pending' or 'partial' and runs
// them through product-resolver + Kassal. Sequential per list to share
// the rate-limit budget. Errors are swallowed per list.
function shoppingEnrichmentJob(repos) {
  // enrichPendingLists is async — we don't await it inside the cron
  // callback so reschedule isn't blocked. Errors go to the log.
  enrichPendingLists(repos, { maxLists: 3, delayMs: 1100 })
    .then((results) => {
      if (results.length === 0) return;
      const summary = results
        .map((r) => `#${r.listId}:${r.finalStatus}(+${r.enriched}/~${r.skipped})`)
        .join(' ');
      log(`Enrichment: ${summary}`);
    })
    .catch((err) => log(`Enrichment ERROR: ${err.message}`));
}

// === Scheduler ===

function logCronError(name, err) {
  log(`ERROR in ${name}: ${err.message}\n${err.stack}`);
  logger.error({ err: { message: err.message, stack: err.stack }, job: name }, 'cron job failed');
}

function addTimer(t) {
  if (cronStopped) {
    clearTimeout(t);
    return;
  }
  activeTimers.add(t);
}

function scheduleJob(name, dayOfWeek, hour, minute, jobFn, repos) {
  function runAndReschedule() {
    try {
      jobFn(repos);
    } catch (err) {
      logCronError(name, err);
    }
    if (cronStopped) return;
    const ms = msUntilNext(dayOfWeek, hour, minute);
    log(`${name}: next run in ${Math.round(ms / 3600000)} hours`);
    const t = setTimeout(runAndReschedule, ms);
    addTimer(t);
  }
  const ms = msUntilNext(dayOfWeek, hour, minute);
  log(
    `${name}: scheduled in ${Math.round(ms / 3600000)} hours (${new Date(Date.now() + ms).toLocaleString('no-NO')})`
  );
  const t = setTimeout(runAndReschedule, ms);
  addTimer(t);
}

function scheduleDailyJob(name, hour, minute, jobFn, repos) {
  function runAndReschedule() {
    try {
      jobFn(repos);
    } catch (err) {
      logCronError(name, err);
    }
    if (cronStopped) return;
    const t = setTimeout(runAndReschedule, 24 * 3600000);
    addTimer(t);
  }
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  let ms = target.getTime() - now.getTime();
  if (ms < 0) ms += 24 * 3600000;
  log(`${name}: scheduled in ${Math.round(ms / 3600000)} hours`);
  const t = setTimeout(runAndReschedule, ms);
  addTimer(t);
}

// Interval-based scheduler for frequent jobs (e.g. enrichment every 10 min).
// First run is after intervalMs (not immediate) to let the server warm up.
function scheduleIntervalJob(name, intervalMs, jobFn, repos) {
  function runAndReschedule() {
    try {
      jobFn(repos);
    } catch (err) {
      logCronError(name, err);
    }
    if (cronStopped) return;
    const t = setTimeout(runAndReschedule, intervalMs);
    addTimer(t);
  }
  log(`${name}: scheduled every ${Math.round(intervalMs / 60000)} minutes`);
  const t = setTimeout(runAndReschedule, intervalMs);
  addTimer(t);
}

// === Phase F7: Sync of recipe sources ===
async function recipeSourcesSyncJob(repos) {
  try {
    const recipeSourcesService = require('./services/recipe-sources.service');
    const result = await recipeSourcesService.syncAllEnabled(repos);
    log(`Recipe-sources sync: ${result.synced || 0}/${result.total || 0} synced`);
  } catch (err) {
    log(`ERROR in recipe-sources sync: ${err.message}`);
  }
}

function gdprPurgeJob(repos) {
  try {
    const res = purgeSoftDeletedUsers(repos);
    if (res.purged > 0) {
      log(`GDPR: hard-deleted ${res.purged} soft-deleted user(s)`);
    }
  } catch (err) {
    log(`ERROR in GDPR purge: ${err.message}`);
  }
}

function sessionCleanupJob(repos) {
  try {
    const n = repos?.auth?.cleanupExpired?.();
    if (n > 0) log(`Sessions: cleaned up ${n} expired`);
  } catch (err) {
    log(`ERROR in session cleanup: ${err.message}`);
  }
}

function magicLinkCleanupJob(repos) {
  try {
    const n = repos?.auth?.cleanupExpiredMagicLinks?.();
    if (n > 0) log(`Magic-link tokens: cleaned up ${n} expired`);
  } catch (err) {
    log(`ERROR in magic-link cleanup: ${err.message}`);
  }
}

function startCronJobs(repos) {
  if (!repos) {
    log('WARNING: startCronJobs called without repos \u2014 cron jobs are disabled');
    return;
  }
  log('=== Starting cron jobs ===');
  scheduleJob('Sunday-push', 0, 14, 0, sundayPushJob, repos);
  scheduleJob('Chore-plan', 1, 7, 0, weeklyChoresJob, repos);
  scheduleDailyJob('Shelf-life', 8, 0, shelfLifeCheckJob, repos);
  scheduleDailyJob('Pantry-expired', 8, 5, pantryExpiredJob, repos);
  scheduleDailyJob('Depletion', 22, 0, dailyDepletionJob, repos);
  scheduleDailyJob('LLM-cache-cleanup', 4, 0, llmCacheCleanupJob, repos);
  scheduleDailyJob('Price-CPI-indexing', 5, 0, priceCpiIndexingJob, repos);
  scheduleDailyJob('GDPR-soft-delete-purge', 3, 30, gdprPurgeJob, repos);
  scheduleDailyJob('Session-cleanup', 4, 10, sessionCleanupJob, repos);
  scheduleDailyJob('Magic-link-cleanup', 4, 15, magicLinkCleanupJob, repos);
  scheduleIntervalJob('Shopping-enrichment', 10 * 60000, shoppingEnrichmentJob, repos);
  // Phase F7: sync recipe sources every 6 hours
  scheduleIntervalJob('Recipe-sources-sync', 6 * 60 * 60 * 1000, recipeSourcesSyncJob, repos);
  log('=== All cron jobs scheduled ===');
}

function stopCronJobs() {
  cronStopped = true;
  for (const t of activeTimers) clearTimeout(t);
  activeTimers.clear();
  log('=== Cron jobs stopped ===');
}

module.exports = {
  startCronJobs,
  stopCronJobs,
  sundayPushJob,
  shelfLifeCheckJob,
  dailyDepletionJob,
  weeklyChoresJob,
  llmCacheCleanupJob,
  pantryExpiredJob,
  priceCpiIndexingJob,
  shoppingEnrichmentJob,
  recipeSourcesSyncJob,
};
