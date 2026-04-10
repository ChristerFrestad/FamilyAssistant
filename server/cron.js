// Cron-system for Familieassistenten (Fase 1: bruker repositories)
// Bruker ingen eksterne avhengigheter \u2014 ren Node.js setTimeout.

const { getWeekYear } = require('./seed');
const { generateSundayDraft } = require('./services/meal-planning.service');
const { applyCpiIndexing } = require('./services/price-reference.service');
const { removeExpired } = require('./services/pantry.service');
const { enrichPendingLists } = require('./services/shopping-list-enricher.service');

const activeTimers = new Set();

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

// === Jobb 1: S\u00f8ndagspush kl. 14:00 ===
function sundayPushJob(repos) {
  const nextWeekDate = new Date(Date.now() + 7 * 86400000);
  const nextWk = getWeekYear(nextWeekDate);

  if (repos.mealPlans.exists(nextWk)) {
    log(`S\u00f8ndagspush: Uke ${nextWk} har allerede en plan \u2014 hopper over`);
    return;
  }

  const draft = generateSundayDraft(repos);
  repos.sundayDrafts.save(draft.weekYear, draft.meals);

  const names = draft.meals.map(s => repos.recipes.getById(s.recipeId)?.name || '?').join(', ');
  log(`S\u00f8ndagspush: Generert forslag for ${draft.weekYear} \u2014 ${names}`);
  repos.notifications.insert('sunday_push', `Forslag til ukemeny for ${draft.weekYear} er klart`, { weekYear: draft.weekYear });
}

// === Jobb 2: Holdbarhetsvarsler (daglig kl. 08:00) ===
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
        message: daysLeft <= 0
          ? `\u26a0\ufe0f ${product?.productName || key} har g\u00e5tt ut!`
          : `\u23f0 ${product?.productName || key} utl\u00f8per i morgen!`,
      });
    }
  }

  if (warnings.length > 0) {
    const summary = warnings.map(w => w.product).join(', ');
    repos.notifications.insert('shelf_life', `${warnings.length} varer utl\u00f8per snart: ${summary}`, { date: today, warnings });
    log(`Holdbarhet: ${warnings.length} varer utl\u00f8per snart: ${summary}`);
  } else {
    log('Holdbarhet: Alt OK');
  }
}

// === Jobb 3: Inventory depletion (daglig kl. 22:00) ===
function dailyDepletionJob(repos) {
  const wk = getWeekYear();
  const dayOfWeek = (new Date().getDay() + 6) % 7;
  const plan = repos.mealPlans.getWeek(wk);
  const todaySlot = plan.find(p => p.dayOfWeek === dayOfWeek);

  if (!todaySlot || todaySlot.status === 'away' || todaySlot.status === 'skipped') {
    log('Depletion: Ingen middag i dag \u2014 hopper over');
    return;
  }

  const recipe = repos.recipes.getById(todaySlot.recipeId);
  if (!recipe) {
    log(`Depletion: Fant ikke oppskrift ${todaySlot.recipeId}`);
    return;
  }

  // Reduser inventory for oppskriftsingredienser
  // (Ingen ytre tx \u2014 hver operasjon er idempotent og reduceDaily har sin egen)
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
    log(`Depletion: Middagen "${recipe.name}" brukte: ${depleted.join(', ')}`);
  }
}

// === Jobb 4: Husarbeid-generering (mandager kl. 07:00) ===
function weeklyChoresJob(repos) {
  const wk = getWeekYear();
  if (repos.choreSchedules.exists(wk)) {
    log(`Husarbeid: Uke ${wk} har allerede en plan`);
    return;
  }
  repos.choreSchedules.seedDefault(wk);
  log(`Husarbeid: Opprettet plan for uke ${wk}`);
}

// === Jobb 5: LLM-cache cleanup (daglig kl. 04:00) ===
function llmCacheCleanupJob(repos) {
  const removed = repos.llmCache.cleanup();
  if (removed > 0) log(`LLM-cache: Fjernet ${removed} utl\u00f8pte entries`);
}

// === Jobb 6: Pantry expired cleanup (daglig kl. 08:05 — rett etter holdbarhetsvarsel) ===
function pantryExpiredJob(repos) {
  const removed = removeExpired(repos);
  if (removed > 0) log(`Pantry: Fjernet ${removed} utl\u00f8pte varer fra inventar`);
}

// === Jobb 7: CPI-indeksering av prisreferanser (m\u00e5nedlig — 1. i m\u00e5neden kl. 05:00) ===
// Bruker setTimeout-loop hver 24t men kj\u00f8rer kun hvis dato === 1.
function priceCpiIndexingJob(repos) {
  const now = new Date();
  if (now.getDate() !== 1) return;
  try {
    const n = applyCpiIndexing(repos);
    log(`Pris-CPI: Oppdaterte ${n} prisreferanser`);
  } catch (err) {
    log(`Pris-CPI FEIL: ${err.message}`);
  }
}

// === Jobb 8: Shopping-list enrichment (hvert 10. minutt) ===
// Plukker opp lister som står på enrichment_status='pending' eller 'partial'
// og kjører dem videre gjennom product-resolver + Kassal. Sekvensiell per
// liste for å dele rate-limit-budsjettet. Feil svelges per liste.
function shoppingEnrichmentJob(repos) {
  // enrichPendingLists er async — vi venter ikke på den inni cron-callbacken
  // for å ikke blokkere reschedule. Feil går til log.
  enrichPendingLists(repos, { maxLists: 3, delayMs: 1100 })
    .then(results => {
      if (results.length === 0) return;
      const summary = results.map(r =>
        `#${r.listId}:${r.finalStatus}(+${r.enriched}/~${r.skipped})`
      ).join(' ');
      log(`Enrichment: ${summary}`);
    })
    .catch(err => log(`Enrichment FEIL: ${err.message}`));
}

// === Scheduler ===
function scheduleJob(name, dayOfWeek, hour, minute, jobFn, repos) {
  function runAndReschedule() {
    try { jobFn(repos); }
    catch (err) { log(`FEIL i ${name}: ${err.message}\n${err.stack}`); }
    const ms = msUntilNext(dayOfWeek, hour, minute);
    log(`${name}: Neste kj\u00f8ring om ${Math.round(ms / 3600000)} timer`);
    const t = setTimeout(runAndReschedule, ms);
    activeTimers.add(t);
  }
  const ms = msUntilNext(dayOfWeek, hour, minute);
  log(`${name}: Planlagt om ${Math.round(ms / 3600000)} timer (${new Date(Date.now() + ms).toLocaleString('no-NO')})`);
  const t = setTimeout(runAndReschedule, ms);
  activeTimers.add(t);
}

function scheduleDailyJob(name, hour, minute, jobFn, repos) {
  function runAndReschedule() {
    try { jobFn(repos); }
    catch (err) { log(`FEIL i ${name}: ${err.message}\n${err.stack}`); }
    const t = setTimeout(runAndReschedule, 24 * 3600000);
    activeTimers.add(t);
  }
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  let ms = target.getTime() - now.getTime();
  if (ms < 0) ms += 24 * 3600000;
  log(`${name}: Planlagt om ${Math.round(ms / 3600000)} timer`);
  const t = setTimeout(runAndReschedule, ms);
  activeTimers.add(t);
}

// Interval-basert scheduler for hyppige jobber (f.eks. enrichment hvert 10 min).
// Første kjøring er etter intervalMs (ikke umiddelbart) for å la serveren varme opp.
function scheduleIntervalJob(name, intervalMs, jobFn, repos) {
  function runAndReschedule() {
    try { jobFn(repos); }
    catch (err) { log(`FEIL i ${name}: ${err.message}\n${err.stack}`); }
    const t = setTimeout(runAndReschedule, intervalMs);
    activeTimers.add(t);
  }
  log(`${name}: Planlagt hvert ${Math.round(intervalMs / 60000)}. minutt`);
  const t = setTimeout(runAndReschedule, intervalMs);
  activeTimers.add(t);
}

// === Fase F7: Synk av oppskriftskilder ===
async function recipeSourcesSyncJob(repos) {
  try {
    const recipeSourcesService = require('./services/recipe-sources.service');
    const result = await recipeSourcesService.syncAllEnabled(repos);
    log(`Recipe-sources sync: ${result.synced || 0}/${result.total || 0} synket`);
  } catch (err) {
    log(`FEIL i recipe-sources sync: ${err.message}`);
  }
}

function startCronJobs(repos) {
  if (!repos) {
    log('ADVARSEL: startCronJobs kalt uten repos \u2014 cron-jobber er deaktivert');
    return;
  }
  log('=== Starter cron-jobber ===');
  scheduleJob('S\u00f8ndagspush', 0, 14, 0, sundayPushJob, repos);
  scheduleJob('Husarbeidplan', 1, 7, 0, weeklyChoresJob, repos);
  scheduleDailyJob('Holdbarhet', 8, 0, shelfLifeCheckJob, repos);
  scheduleDailyJob('Pantry-expired', 8, 5, pantryExpiredJob, repos);
  scheduleDailyJob('Depletion', 22, 0, dailyDepletionJob, repos);
  scheduleDailyJob('LLM-cache-cleanup', 4, 0, llmCacheCleanupJob, repos);
  scheduleDailyJob('Pris-CPI-indeksering', 5, 0, priceCpiIndexingJob, repos);
  scheduleIntervalJob('Shopping-enrichment', 10 * 60000, shoppingEnrichmentJob, repos);
  // Fase F7: synk oppskriftskilder hver 6. time
  scheduleIntervalJob('Recipe-sources-sync', 6 * 60 * 60 * 1000, recipeSourcesSyncJob, repos);
  log('=== Alle cron-jobber planlagt ===');
}

function stopCronJobs() {
  for (const t of activeTimers) clearTimeout(t);
  activeTimers.clear();
  log('=== Cron-jobber stoppet ===');
}

module.exports = {
  startCronJobs, stopCronJobs,
  sundayPushJob, shelfLifeCheckJob, dailyDepletionJob, weeklyChoresJob,
  llmCacheCleanupJob, pantryExpiredJob, priceCpiIndexingJob,
  shoppingEnrichmentJob,
  recipeSourcesSyncJob,
};
