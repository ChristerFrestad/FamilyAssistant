// Alle API-ruter samlet i \u00e9n fil. Registrerer seg p\u00e5 en router-instans.
// Hver rute-handler er en async (ctx) => ... funksjon.
// Validering skjer via Zod-middleware f\u00f8r handleren.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { getWeekYear } = require('./seed');
const { errors } = require('./http/errors');
const { validateBody } = require('./http/validate');
const { registerAuthRoutes } = require('./auth/routes');
const { registerFamilyRoutes } = require('./auth/family-routes');
const { registerLlmConfigRoutes } = require('./auth/llm-routes');
const { registerGdprRoutes } = require('./auth/gdpr-routes');
const { registerFeedbackRoutes } = require('./http/feedback-routes');
const { registerBootstrapRoutes } = require('./http/bootstrap');
const { registerBrandingRoutes } = require('./http/branding');
const { config } = require('./config');
const { requireRole, hasRole } = require('./auth/middleware');
const { withCache, invalidate, responseCache } = require('./http/cache');
const metrics = require('./http/metrics');
const schemas = require('./schemas');

const { buildShoppingList, generateForWeek } = require('./services/shopping-list.service');
const { enrichInBackground } = require('./services/shopping-list-enricher.service');
const { enrichItemForFrontend } = require('./repositories/shopping.repo');
const {
  getSwapSuggestions,
  checkShelfLife,
  generateSundayDraft,
  generatePantryRestOfWeek,
  computeMissingForRestOfWeek,
} = require('./services/meal-planning.service');
const { ensureCurrentWeek } = require('./services/seed.service');
const pantryService = require('./services/pantry.service');
const pantryResolver = require('./services/pantry-resolver.service');
const pantryDeduction = require('./services/pantry-deduction.service');
const { createShelfLifeLearner } = require('./services/shelf-life-learner.service');
const priceReferenceService = require('./services/price-reference.service');
const receiptService = require('./services/receipt.service');
const recipeImportService = require('./services/recipe-import.service');
const { slugifyProductKey } = require('./services/slugify');
const { extractChain } = require('./services/product-resolver.service');

const {
  isLLMAvailable,
  chat,
  suggestRecipeFromText,
  extractIntent,
  OLLAMA_MODEL,
  LLM_BACKEND,
} = require('./llm');
const { transcribe, isSTTAvailable } = require('./stt');

const DAY_NAMES = [
  'Mandag',
  'Tirsdag',
  'Onsdag',
  'Torsdag',
  'Fredag',
  'L\u00f8rdag',
  'S\u00f8ndag',
];

/**
 * Auto-merge the shopping list when the week is complete. Called from
 * the meal routes after mutations.
 *
 * Smart-merge preserves any items the user has interacted with (bought
 * rows + manual/extra rows) and adds fresh meal-ingredient rows from
 * the current meal plan. This is safe to run on every meal swap: an
 * existing active list is no longer a blocker the way it was pre-
 * 2026-05-03 (PR shopping-smart-merge). Errors are swallowed so the
 * meal update itself does not fail because of shopping-list issues.
 */
function toChoreDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    task: row.task,
    details: row.details ?? null,
    frequency: row.frequency,
    defaultDay: row.default_day ?? null,
    icon: row.icon ?? null,
    assigneeMemberId: row.assignee_member_id ?? null,
    intervalDays: row.interval_days ?? null,
    active: !!row.active,
  };
}

function choreCatalogMap(repos) {
  return new Map(repos.chores.getAll({ includeInactive: true }).map((c) => [c.id, c]));
}

function maybeAutogenerateShoppingList(repos, weekYear) {
  try {
    if (!repos.mealPlans.isWeekComplete(weekYear)) return null;
    const result = generateForWeek(repos, weekYear, { force: false, mode: 'merge' });
    invalidate('shopping');
    // Phase B: kick off background enrichment — no await, no throw.
    // If KASSAL_API_KEY is missing, enrichList marks the list as done noop.
    if (result && result.listId) {
      enrichInBackground(repos, result.listId);
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * SBOM-6: audit-log helper. Wraps a handler and logs to audit_log after
 * a successful response. Should only be used on destructive operations
 * (DELETE, overwriting PUT/PATCH on sensitive resources).
 *
 * @param {object} repos
 * @param {object} spec  { entityType, getEntityId?, getBefore?, getAfter?, metadata? }
 * @param {function} handler  (ctx) => void
 */
function withAudit(repos, spec, handler) {
  return (ctx) => {
    // Snapshot "before" before the handler runs (if spec provides getBefore)
    let before = null;
    try {
      if (typeof spec.getBefore === 'function') before = spec.getBefore(ctx, repos);
    } catch {
      /* silent: audit must not block */
    }

    // Run handler — rethrow so http/server.js can catch
    handler(ctx);

    // Record audit event after the handler returned without throw.
    // This ensures failed operations do not generate audit noise.
    try {
      const entityId = typeof spec.getEntityId === 'function' ? spec.getEntityId(ctx) : null;
      let after = null;
      if (typeof spec.getAfter === 'function') after = spec.getAfter(ctx, repos);

      repos.auditLog.record({
        requestId: ctx.requestId || ctx.req?.headers?.['x-request-id'] || 'unknown',
        actor: 'local',
        action: (ctx.req?.method || 'UNKNOWN').toUpperCase(),
        entityType: spec.entityType,
        entityId,
        route: ctx.req?.url || 'unknown',
        before,
        after,
        metadata: typeof spec.metadata === 'function' ? spec.metadata(ctx) : spec.metadata,
      });
    } catch {
      /* silent: audit errors must never affect the response */
    }
  };
}

function registerRoutes(router, { repos, serverState }) {
  // Single shelf-life learner per server instance — it needs both repos and
  // the raw db handle to update products.shelf_days_learned.
  const shelfLifeLearner = createShelfLifeLearner(repos, repos._db);

  function requirePositiveInt(value, name = 'id') {
    const n = parseInt(value, 10);
    if (!Number.isInteger(n) || n <= 0)
      throw errors.badRequest(`${name} must be a positive integer`);
    return n;
  }

  // ============================================================
  // BOOTSTRAP (phase 22 — zero-config first-run wizard)
  // ============================================================
  // Always register the bootstrap status endpoint so the frontend
  // (and test suite) can introspect mode. Complete/generate-token are
  // gated by config.BOOTSTRAP_MODE inside the handlers, so even outside
  // bootstrap-mode a malicious caller gets 403, not a write.
  registerBootstrapRoutes(router, { config });

  // Sprint 10 brand-config + favicon + logo-mark + manifest. Public
  // (no-auth) routes that the frontend consumes via useBrandConfig()
  // and the browser pulls for tab-icon / PWA-manifest. Registered
  // before the bootstrap-mode short-circuit below so the favicon
  // request from the setup wizard still succeeds.
  registerBrandingRoutes(router, { config });

  // When in bootstrap-mode, block everything else under /api/* so a
  // half-configured server can't be used accidentally. /health and
  // /ready still respond below. Static /setup.html + manifest + icons
  // are served via the tryServeSpaFallback path in server.js.
  if (config.BOOTSTRAP_MODE) {
    router.all('/api/*', (ctx) => {
      // Carve-out: bootstrap endpoints already matched above and returned
      // before the catch-all would run, so this only fires for other /api/*
      // paths.
      if (ctx.pathname.startsWith('/api/bootstrap/')) return;
      ctx.json(
        {
          type: 'about:blank',
          title: 'Setup required',
          status: 503,
          detail: 'Instance not configured. Complete setup at /setup.html.',
          setupUrl: '/setup.html',
        },
        503
      );
    });
  }

  // ============================================================
  // ROLE MATRIX (phase 6 — role enforcement)
  // ============================================================
  //
  // Authenticated requests carry ctx.user with one of three roles:
  //   owner > adult > child
  //
  // The bearer-token RPi fallback and the no-auth legacy dev mode both
  // synthesise a local user with role=owner so existing single-tenant
  // installations keep working unchanged.
  //
  // GET endpoints are open to every authenticated role — all family
  // members can read pantry, menu, shopping list, calendar and chores.
  //
  // Mutation endpoints apply one of:
  //   requireRole('adult') — blocks child (read-only) from editing
  //                          pantry, menu, shopping, calendar, recipes,
  //                          profile, receipts, AI chat, consumables,
  //                          chore postponement, sunday-push.
  //   requireRole('owner') — owner-only: environment/integration
  //                          settings, LLM config mutations, family
  //                          lifecycle (invite/remove members, delete
  //                          family, transfer ownership).
  //
  // Endpoints with no role middleware but behind authenticate() require
  // only a logged-in user:
  //   GET  /api/chores                  — any family member can list catalog.
  //   PUT  /api/chores/complete         — any family member can check off
  //                                       chores (plan matrix allows this).
  //   POST /api/profile/filter-usage    — low-risk usage tracker, child OK.
  //   POST /api/llm/warm                — cache priming, child OK.
  //   PUT  /api/notifications/read      — mark notifications read.
  //
  // The tenant-isolation layer (AsyncLocalStorage + repo WHERE clauses)
  // is orthogonal: role enforcement limits WHAT a user can do, tenant
  // scoping limits WHICH family's data they touch.

  // ============================================================
  // AUTH (Google OAuth, magic-link, sessions)
  // ============================================================
  registerAuthRoutes(router, { repos });

  // ============================================================
  // FAMILY + INVITATIONS (phase 7)
  // ============================================================
  registerFamilyRoutes(router, { repos });

  // ============================================================
  // PER-FAMILY LLM CONFIG (phase 8)
  // ============================================================
  registerLlmConfigRoutes(router, { repos });

  // ============================================================
  // GDPR ENDPOINTS (phase 10 — export + soft-delete)
  // ============================================================
  registerGdprRoutes(router, { repos });

  // ============================================================
  // FEEDBACK (phase 15 — in-app feedback + recipe thumbs)
  // ============================================================
  registerFeedbackRoutes(router, { repos });

  // ============================================================
  // HEALTH / READY
  // ============================================================
  router.get('/health', (ctx) => {
    ctx.json({
      status: 'ok',
      uptimeSec: Math.round((Date.now() - serverState.startedAt) / 1000),
      pid: process.pid,
      memMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
  });

  // Admin-only detailed health snapshot. Combines /health, /ready and
  // a few extras useful for the post-pilot admin UI without exposing
  // them to the public probe. Returns 403 for non-admin users.
  router.get('/health/detailed', (ctx) => {
    if (!ctx.user || !ctx.user.is_admin) {
      throw errors.forbidden('Admin role required.');
    }
    let migrationCount = 0;
    let activeUsers24h = 0;
    let kassalApiKeyConfigured = false;
    try {
      migrationCount = repos._db.prepare('SELECT COUNT(*) AS cnt FROM schema_migrations').get().cnt;
    } catch {
      /* table may not exist on first boot */
    }
    try {
      activeUsers24h = repos._db
        .prepare(
          `SELECT COUNT(DISTINCT user_id) AS cnt FROM sessions
             WHERE last_seen_at >= datetime('now', '-24 hours')`
        )
        .get().cnt;
    } catch {
      /* sessions table may have schema variance */
    }
    try {
      kassalApiKeyConfigured = !!process.env.KASSAL_API_KEY;
    } catch {
      /* ignore */
    }
    ctx.json({
      status: 'ok',
      version: require('../package.json').version,
      nodeEnv: process.env.NODE_ENV || 'production',
      uptimeSec: Math.round((Date.now() - serverState.startedAt) / 1000),
      memMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      pid: process.pid,
      migrationCount,
      activeUsers24h,
      kassalApiKeyConfigured,
      pilotMode: !!process.env.PILOT_MODE,
      magicLinkConsole: !!process.env.MAGIC_LINK_CONSOLE,
    });
  });

  router.get('/ready', (ctx) => {
    // M4.2: utvidet ready-sjekk med dependency + kapasitet-signaler
    const checks = { server: serverState.ready, repos: repos !== null };
    const warnings = [];
    let dbSizeBytes = null;
    let diskFreeBytes = null;

    // DB-size (fra filen hvis vi har DB_PATH)
    try {
      const fs = require('fs');
      const { DB_PATH } = require('./db');
      if (DB_PATH && fs.existsSync(DB_PATH)) {
        dbSizeBytes = fs.statSync(DB_PATH).size;
        // Advarsel hvis DB > 500 MB
        if (dbSizeBytes > 500 * 1024 * 1024) warnings.push('db_size_over_500mb');
      }
    } catch {
      /* silent */
    }

    // Disk-space (statfs is Linux-only on Node ≥18.15, so wrap in try)
    try {
      const fs = require('fs');
      if (fs.statfsSync) {
        const s = fs.statfsSync(require('path').dirname(require('./db').DB_PATH || process.cwd()));
        diskFreeBytes = s.bfree * s.bsize;
        if (diskFreeBytes < 100 * 1024 * 1024) warnings.push('disk_under_100mb');
      }
    } catch {
      /* stille */
    }

    // Backup-freshness — siste backup <30t gammel?
    let lastBackupAgeHours = null;
    try {
      const fs = require('fs');
      const path = require('path');
      const { BACKUP_DIR } = require('./backup');
      if (fs.existsSync(BACKUP_DIR)) {
        const files = fs
          .readdirSync(BACKUP_DIR)
          .filter((f) => /^familieassistenten-\d{4}-\d{2}-\d{2}\.db$/.test(f))
          .map((f) => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length > 0) {
          lastBackupAgeHours = Math.round((Date.now() - files[0].mtime) / 3600000);
          if (lastBackupAgeHours > 30) warnings.push('backup_stale_over_30h');
        }
      }
    } catch {
      /* stille */
    }

    // Circuit breaker state — ikke blocker 503, bare rapporteres
    let breakersOpen = 0;
    try {
      const snap = require('./services/circuit-breaker').snapshotAll();
      for (const b of Object.values(snap)) {
        if (b.state === 'OPEN') breakersOpen++;
      }
      if (breakersOpen > 0) warnings.push(`breakers_open_${breakersOpen}`);
    } catch {
      /* stille */
    }

    // Uke 5 PERF-4: Memory budget-sjekk. Flagger warning hvis RSS over
    // MEMORY_BUDGET_MB (default 512). Blokker ikke /ready — dette er en
    // signal-warning for alerting/dashboards.
    let rssMB = null;
    let memoryBudgetMB = null;
    try {
      const { config: cfg } = require('./config');
      rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
      memoryBudgetMB = cfg.MEMORY_BUDGET_MB;
      if (rssMB > memoryBudgetMB) {
        warnings.push(`rss_over_budget_${rssMB}mb`);
      } else if (rssMB > memoryBudgetMB * 0.9) {
        warnings.push(`rss_near_budget_${rssMB}mb`);
      }
    } catch {
      /* stille */
    }

    // SBOM-5: token-age-sjekk. Flagger warning hvis AUTH_TOKEN_CREATED_AT er
    // eldre enn AUTH_TOKEN_MAX_AGE_DAYS. Blokker ikke /ready — dette er
    // en hygiene-warning, ikke en driftsstopp.
    let tokenAgeDays = null;
    try {
      const { config: cfg } = require('./config');
      if (cfg.AUTH_TOKEN && cfg.AUTH_TOKEN_CREATED_AT) {
        const created = Date.parse(cfg.AUTH_TOKEN_CREATED_AT);
        if (!Number.isNaN(created)) {
          tokenAgeDays = Math.floor((Date.now() - created) / 86_400_000);
          if (tokenAgeDays > cfg.AUTH_TOKEN_MAX_AGE_DAYS) {
            warnings.push(`auth_token_stale_${tokenAgeDays}d`);
          }
        }
      } else if (cfg.AUTH_TOKEN && !cfg.AUTH_TOKEN_CREATED_AT && cfg.NODE_ENV === 'production') {
        // Token er satt men alder er ukjent — noter men ikke blokker
        warnings.push('auth_token_age_unknown');
      }
    } catch {
      /* stille */
    }

    const ready =
      checks.server &&
      checks.repos &&
      !warnings.some((w) => w === 'disk_under_100mb' || w === 'db_size_over_500mb');

    ctx.json(
      {
        ready,
        driver: serverState.driver,
        kbEntries: repos ? repos.kb.count() : 0,
        fts5: repos?.hasFTS || false,
        checks,
        dbSizeBytes,
        dbSizeMB: dbSizeBytes != null ? Math.round(dbSizeBytes / 1024 / 1024) : null,
        diskFreeBytes,
        diskFreeMB: diskFreeBytes != null ? Math.round(diskFreeBytes / 1024 / 1024) : null,
        lastBackupAgeHours,
        breakersOpen,
        tokenAgeDays,
        rssMB,
        memoryBudgetMB,
        warnings,
      },
      ready ? 200 : 503
    );
  });

  // ============================================================
  // MEALS
  // ============================================================
  router.get(
    '/api/meals/week/:weekYear',
    withCache(['meals'], (ctx) => {
      const wk = ctx.params.weekYear;
      if (!repos.mealPlans.exists(wk)) ensureCurrentWeek(repos);
      const plan = repos.mealPlans.getWeek(wk);
      ctx.json({
        weekYear: wk,
        meals: plan.map((slot) => ({
          ...slot,
          dayName: DAY_NAMES[slot.dayOfWeek],
          recipe: slot.recipeId ? repos.recipes.getById(slot.recipeId) : null,
        })),
      });
    })
  );

  router.get(
    '/api/meals/current',
    withCache(['meals'], (ctx) => {
      const wk = ensureCurrentWeek(repos);
      const plan = repos.mealPlans.getWeek(wk);
      ctx.json({
        weekYear: wk,
        meals: plan.map((slot) => ({
          ...slot,
          dayName: DAY_NAMES[slot.dayOfWeek],
          recipe: slot.recipeId ? repos.recipes.getById(slot.recipeId) : null,
        })),
      });
    })
  );

  router.put(
    '/api/meals/swap',
    requireRole('adult'),
    validateBody(schemas.mealsSwapBody),
    (ctx) => {
      const { weekYear, dayOfWeek, recipeId } = ctx.body;
      const wk = weekYear || ensureCurrentWeek(repos);
      if (!repos.mealPlans.exists(wk)) ensureCurrentWeek(repos);
      repos.mealPlans.setRecipe(wk, dayOfWeek, recipeId, 'planned');
      invalidate('meals', 'today', 'shopping');
      const autogen = maybeAutogenerateShoppingList(repos, wk);
      ctx.json({
        ok: true,
        mealPlan: repos.mealPlans.getWeek(wk),
        autogeneratedShoppingList: autogen,
      });
    }
  );

  router.put(
    '/api/meals/status',
    requireRole('adult'),
    validateBody(schemas.mealsStatusBody),
    (ctx) => {
      const { weekYear, dayOfWeek, status } = ctx.body;
      const wk = weekYear || ensureCurrentWeek(repos);
      if (!repos.mealPlans.exists(wk)) ensureCurrentWeek(repos);
      repos.mealPlans.setStatus(wk, dayOfWeek, status);
      invalidate('meals', 'today');
      const autogen = maybeAutogenerateShoppingList(repos, wk);
      ctx.json({ ok: true, autogeneratedShoppingList: autogen });
    }
  );

  router.put(
    '/api/meals/reorder',
    requireRole('adult'),
    validateBody(schemas.mealsReorderBody),
    (ctx) => {
      const { weekYear, fromDay, toDay } = ctx.body;
      const wk = weekYear || ensureCurrentWeek(repos);
      if (!repos.mealPlans.exists(wk)) ensureCurrentWeek(repos);
      const plan = repos.mealPlans.getWeek(wk);
      const shelfCheck = checkShelfLife(repos, plan, fromDay, toDay);
      repos.mealPlans.swapDays(wk, fromDay, toDay);
      invalidate('meals', 'today');
      ctx.json({
        ok: true,
        shelfWarnings: shelfCheck.warnings,
        mealPlan: repos.mealPlans.getWeek(wk),
      });
    }
  );

  router.get('/api/meals/suggestions/:dayOfWeek', (ctx) => {
    const dow = parseInt(ctx.params.dayOfWeek, 10);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      throw errors.badRequest('dayOfWeek m\u00e5 v\u00e6re 0\u20136');
    }
    const wk = ensureCurrentWeek(repos);
    ctx.json({ suggestions: getSwapSuggestions(repos, dow, wk) });
  });

  // "Hva kan jeg lage n\u00e5?" \u2014 returnerer 5 oppskrifter i valgt kategori,
  // rangert etter pantry-dekning. Brukeren velger hvilken dag den legges p\u00e5.
  router.post(
    '/api/meals/pantry-suggestions',
    requireRole('adult'),
    validateBody(schemas.pantrySuggestionBody),
    (ctx) => {
      ensureCurrentWeek(repos);
      const result = generatePantryRestOfWeek(repos, { category: ctx.body.category });
      ctx.json(result);
    }
  );

  // Bruker aksepterer ett eller flere valg \u2014 lagrer dem i ukeplanen og
  // poster et 'missing_ingredients'-varsel for resten av uka.
  router.post(
    '/api/meals/pantry-suggestions/accept',
    requireRole('adult'),
    validateBody(schemas.pantrySuggestionAcceptBody),
    (ctx) => {
      const wk = ensureCurrentWeek(repos);
      for (const m of ctx.body.meals) {
        repos.mealPlans.setRecipe(wk, m.dayOfWeek, m.recipeId, 'planned');
      }
      invalidate('meals', 'today', 'shopping');

      const missing = computeMissingForRestOfWeek(repos, wk);
      if (missing.length > 0) {
        repos.notifications.insert(
          'missing_ingredients',
          `${missing.length} ingredienser mangler for resten av uka`,
          { weekYear: wk, items: missing }
        );
      }
      ctx.json({ ok: true, missing, weekYear: wk });
    }
  );

  // ----------------------------------------------------------------
  // Sprint 6 — Meal-cooked smart-coupling
  //
  // POST /api/meals/:id/mark-eaten
  //   Set meal_plans.status='cooked' and return ingredient deduction
  //   suggestions for the cook-dialog to render. Cook is committed
  //   even if the user later picks "Skip trekk" — the two states are
  //   independent.
  //
  // POST /api/meals/:id/apply-deduction
  //   Apply user-confirmed deductions. Each item lands as a
  //   pantry.service.correctQty call which writes inventory_log
  //   (reason='correction', notes='meal_deduction:<mealId>') and
  //   re-runs the low-stock trigger naturally.
  //
  // POST /api/meals/:id/unmark-eaten
  //   Roll status back to 'planned'. Used by the dialog Cancel
  //   action so an accidental tap can be undone before any pantry
  //   mutation lands.
  // ----------------------------------------------------------------

  router.post('/api/meals/:id/mark-eaten', requireRole('adult'), (ctx) => {
    const mealId = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(mealId) || mealId <= 0) throw errors.badRequest('Invalid meal id');
    const slot = repos.mealPlans.getById(mealId);
    if (!slot) throw errors.notFound(`Meal ${mealId} not found`);
    if (!slot.recipeId) {
      throw errors.badRequest('Cannot mark cooked: no recipe on this slot', {
        code: 'NO_RECIPE',
      });
    }
    if (slot.status === 'away' || slot.status === 'skipped' || slot.status === 'removed') {
      throw errors.badRequest('Cannot mark cooked: slot is in a non-cookable state', {
        code: 'WRONG_STATUS',
      });
    }

    const alreadyCooked = slot.status === 'cooked';
    if (!alreadyCooked) {
      repos.mealPlans.setStatusById(mealId, 'cooked');
      invalidate('meals', 'today');
    }
    const suggestions = pantryDeduction.buildSuggestions(repos, slot);
    ctx.json({
      mealId,
      recipeId: slot.recipeId,
      alreadyCooked,
      suggestions,
    });
  });

  router.post(
    '/api/meals/:id/apply-deduction',
    requireRole('adult'),
    validateBody(schemas.mealApplyDeductionBody),
    (ctx) => {
      const mealId = parseInt(ctx.params.id, 10);
      if (!Number.isInteger(mealId) || mealId <= 0) throw errors.badRequest('Invalid meal id');
      const slot = repos.mealPlans.getById(mealId);
      if (!slot) throw errors.notFound(`Meal ${mealId} not found`);
      if (slot.status !== 'cooked') {
        throw errors.badRequest('Apply-deduction requires status=cooked', {
          code: 'NOT_COOKED',
        });
      }

      const items = Array.isArray(ctx.body?.items) ? ctx.body.items : [];
      const result = pantryDeduction.applyDeduction(repos, mealId, items);
      invalidate('inventory', 'shopping', 'today');
      ctx.json({ ok: true, mealId, ...result });
    }
  );

  router.post('/api/meals/:id/unmark-eaten', requireRole('adult'), (ctx) => {
    const mealId = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(mealId) || mealId <= 0) throw errors.badRequest('Invalid meal id');
    const slot = repos.mealPlans.getById(mealId);
    if (!slot) throw errors.notFound(`Meal ${mealId} not found`);
    if (slot.status !== 'cooked') {
      ctx.json({ ok: true, alreadyPlanned: true });
      return;
    }
    repos.mealPlans.setStatusById(mealId, 'planned');
    invalidate('meals', 'today');
    ctx.json({ ok: true });
  });

  // ============================================================
  // RECIPES
  // ============================================================

  // B7 / D7 — Build FamilyContext from repos. Reads family_profile (for
  // fallback-arv) + family_profile_members (for per-member diet data).
  // Returns a FamilyContext compatible with recipe-filter.service.
  // Defined as a route-local helper so tests that mock repos don't need
  // to import it.
  function buildFilterContext() {
    const recipeFilter = require('./services/recipe-filter.service');
    const familyProfile = repos.familyProfile.get();
    // ctx.familyId lives on each request, but this helper is called
    // inside handlers so we rely on AsyncLocalStorage via getFamilyId().
    // Callers must ensure the family-context is set.
    const { getFamilyId } = require('./auth/family-context');
    const fid = getFamilyId();
    const members = fid ? repos.family.listMembers(fid) : [];
    return recipeFilter.buildFamilyContext({ familyProfile, members });
  }

  // B7 — parse ?ignoreDietTags=true (D7 override toggle). The toggle is
  // UI-driven per D7 — the server does NOT persist it.
  function parseIgnoreDietTags(query) {
    const raw = query?.ignoreDietTags;
    if (raw === true || raw === 'true' || raw === '1') return true;
    return false;
  }

  // B7 — annotate a recipe with BOTH legacy fields (safeForProfile,
  // blockedIngredients, checkedAgainst) AND new per-member fields
  // (perMember.allergy/dislike/diet + hiddenByAllergy/hiddenByDiet/
  // shownWithDislikeWarning). Legacy callers read the top-level keys;
  // new callers read perMember.*. Both APIs coexist during transition.
  function annotateRecipePerMember(recipe, familyContext, options) {
    const recipeFilter = require('./services/recipe-filter.service');
    const res = recipeFilter.filterRecipeForFamily(recipe, familyContext, options);
    // Legacy fields derived from the new per-member result.
    // safeForProfile is true iff no allergy was triggered (same as legacy).
    const legacyBlocked = res.allergy.blockedIngredients.map(
      ({ blockedFor: _blockedFor, ...rest }) => rest
    );
    return Object.assign({}, recipe || {}, {
      // Legacy (uke 9 SAF-2 shape) — UI code that pre-dates B7 keeps working.
      safeForProfile: res.allergy.safeForFamily,
      blockedIngredients: legacyBlocked,
      checkedAgainst: res.allergy.effectiveAllergies,
      // B7 / D7 — per-member attribution + three-layer result
      perMember: {
        allergy: res.allergy,
        dislike: res.dislike,
        diet: res.diet,
      },
      hiddenByAllergy: res.hiddenByAllergy,
      hiddenByDiet: res.hiddenByDiet,
      shownWithDislikeWarning: res.shownWithDislikeWarning,
    });
  }

  router.get('/api/recipes', (ctx) => {
    // Phase F7: supports ?source=mine|ai|all|imported
    // Filters on recipes.source_type (enum), not recipes.source (free text)
    const source = ctx.query.source;
    const all = repos.recipes.getAll();
    let filtered = all;
    if (source === 'mine') {
      filtered = all.filter((r) => (r.source_type || r.sourceType || 'manual') === 'manual');
    } else if (source === 'ai') {
      filtered = all.filter((r) => (r.source_type || r.sourceType) === 'ai');
    } else if (source === 'imported') {
      filtered = all.filter((r) => (r.source_type || r.sourceType) === 'imported');
    }
    // B7 / D7: Three-layer per-member filter with backward-compat legacy fields.
    const familyContext = buildFilterContext();
    const ignoreDietTags = parseIgnoreDietTags(ctx.query);
    const annotated = filtered.map((r) =>
      annotateRecipePerMember(r, familyContext, { ignoreDietTags })
    );
    ctx.json({
      recipes: annotated,
      filter: {
        ignoreDietTags,
        activeDietTags: Array.from(
          new Set(annotated.flatMap((r) => r.perMember.diet.activeDietTags))
        ),
      },
    });
  });

  router.get('/api/recipes/:id', (ctx) => {
    const id = requirePositiveInt(ctx.params.id);
    const recipe = repos.recipes.getById(id);
    if (!recipe) throw errors.notFound(`Oppskrift ${id} ikke funnet`);
    const familyContext = buildFilterContext();
    const ignoreDietTags = parseIgnoreDietTags(ctx.query);
    const annotated = annotateRecipePerMember(recipe, familyContext, { ignoreDietTags });
    ctx.json({ recipe: annotated });
  });

  /**
   * POST /api/profile/check-recipe — deterministisk allergi-sjekk.
   *
   * Uke 9 SAF-1/SAF-2 kept backward-compatible: the legacy shape
   * (safeForProfile + blockedIngredients + checkedAgainst) is preserved,
   * and B7/D7 adds perMember + hiddenByAllergy/hiddenByDiet/
   * shownWithDislikeWarning on the side.
   *
   * Body can override both profile (family-level) and members (per-member
   * diet data) for "what-if" scenarios — useful for recipe-import flow
   * that wants to validate against the current family without writing
   * any data. If profile/members are omitted, the current family's
   * data is used.
   */
  router.post('/api/profile/check-recipe', requireRole('adult'), (ctx) => {
    const body = ctx.body || {};
    const recipe = body.recipe || { ingredients: body.ingredients || [] };
    if (!Array.isArray(recipe.ingredients)) {
      throw errors.badRequest('recipe.ingredients must be an array');
    }
    const recipeFilter = require('./services/recipe-filter.service');
    const baseCtx = buildFilterContext();
    // Allow caller to override profile and/or members; unset keys fall
    // back to current-family data.
    const familyContext = recipeFilter.buildFamilyContext({
      familyProfile: body.profile || {
        allergies: baseCtx.familyAllergies,
        dislikes: baseCtx.familyDislikes,
      },
      members: Array.isArray(body.members) ? body.members : baseCtx.members,
    });
    const ignoreDietTags = parseIgnoreDietTags(ctx.query) || body.ignoreDietTags === true;
    const res = recipeFilter.filterRecipeForFamily(recipe, familyContext, { ignoreDietTags });
    // Legacy shape + per-member bundle.
    const legacyBlocked = res.allergy.blockedIngredients.map(
      ({ blockedFor: _blockedFor, ...rest }) => rest
    );
    ctx.json({
      // Legacy
      safeForProfile: res.allergy.safeForFamily,
      blockedIngredients: legacyBlocked,
      checkedAgainst: res.allergy.effectiveAllergies,
      // B7 / D7
      perMember: { allergy: res.allergy, dislike: res.dislike, diet: res.diet },
      hiddenByAllergy: res.hiddenByAllergy,
      hiddenByDiet: res.hiddenByDiet,
      shownWithDislikeWarning: res.shownWithDislikeWarning,
    });
  });

  /**
   * GET /api/recipes/:id/similar — Phase F4.
   * Returns top-N similar recipes based on:
   *   - Ingredient Jaccard similarity (weight 0.6)
   *   - Category match (0.3)
   *   - Servings proximity (0.1)
   */
  router.get('/api/recipes/:id/similar', (ctx) => {
    const recipeSimilarity = require('./services/recipe-similarity.service');
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isFinite(id)) throw errors.badRequest('Invalid recipe id');
    const limit = Math.min(parseInt(ctx.query.limit, 10) || 5, 20);
    const similar = recipeSimilarity.findSimilar(repos, id, limit);
    ctx.json({ similar, count: similar.length });
  });

  // Recipe import — text (Phase D).
  //
  // Image import goes through /api/recipes/import/image (separate endpoint)
  // because the global body parser auto-parses JSON and does not support
  // binary. For images the frontend first calls a base64-JSON endpoint, or
  // importFromImage is invoked directly from a future multipart route.
  router.post(
    '/api/recipes/import',
    requireRole('adult'),
    validateBody(schemas.recipeImportTextBody),
    async (ctx) => {
      const result = await recipeImportService.importFromText(repos, ctx.body);
      if (result.error) throw errors.badRequest(result.error);
      invalidate('recipes');
      // Week 9 SAF-2: run deterministic allergy check on the imported recipe
      // BEFORE the response is returned. Frontend shows a warning when
      // safeForProfile=false.
      // The recipe is still saved (the user may choose to keep it), but
      // the flag prevents an "unsafe accept".
      if (result.recipe) {
        // B7 / D7 — per-member filter with legacy fields preserved.
        const recipeFilter = require('./services/recipe-filter.service');
        const familyContext = buildFilterContext();
        const filterRes = recipeFilter.filterRecipeForFamily(result.recipe, familyContext);
        // Legacy shape (uke 9 SAF-2) preserved for callers that pre-date B7
        const legacyBlocked = filterRes.allergy.blockedIngredients.map(
          ({ blockedFor: _blockedFor, ...rest }) => rest
        );
        result.safeForProfile = filterRes.allergy.safeForFamily;
        result.blockedIngredients = legacyBlocked;
        result.checkedAgainst = filterRes.allergy.effectiveAllergies;
        // B7 / D7 additions — callers can opt in
        result.perMember = {
          allergy: filterRes.allergy,
          dislike: filterRes.dislike,
          diet: filterRes.diet,
        };
        result.hiddenByAllergy = filterRes.hiddenByAllergy;
        result.hiddenByDiet = filterRes.hiddenByDiet;
        result.shownWithDislikeWarning = filterRes.shownWithDislikeWarning;
      }
      ctx.json({ ok: true, ...result }, 201);
    }
  );

  // Recipe image import. The image is sent as a base64 string inside the
  // JSON body: { imageBase64: "<base64>", mime: "image/png", title?: "..." }
  // This avoids the binary-parser problem and keeps the route compatible
  // with the global JSON body parser.
  router.post('/api/recipes/import/image', requireRole('adult'), async (ctx) => {
    const body = ctx.body || {};
    if (typeof body.imageBase64 !== 'string' || body.imageBase64.length < 20) {
      throw errors.badRequest('imageBase64 is required and must be a base64-encoded string');
    }
    const mime = typeof body.mime === 'string' ? body.mime.toLowerCase() : '';
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(mime)) {
      throw errors.badRequest(`Invalid mime: ${mime}. Allowed: ${allowed.join(', ')}`);
    }
    let buffer;
    try {
      buffer = Buffer.from(body.imageBase64, 'base64');
    } catch (err) {
      throw errors.badRequest(`Kunne ikke dekode base64: ${err.message}`);
    }
    if (buffer.length === 0) throw errors.badRequest('Tom bildebuffer etter dekoding');

    const result = await recipeImportService.importFromImage(repos, {
      buffer,
      mime,
      title: body.title || null,
    });
    if (result.error) throw errors.badRequest(result.error);
    invalidate('recipes');
    ctx.json({ ok: true, ...result }, 201);
  });

  // ============================================================
  // SHOPPING
  // ============================================================
  router.get(
    '/api/shopping/current',
    withCache(['shopping'], (ctx) => {
      const wk = ensureCurrentWeek(repos);
      ctx.json({ weekYear: wk, ...buildShoppingList(repos, wk) });
    })
  );

  router.put(
    '/api/shopping/check',
    requireRole('adult'),
    validateBody(schemas.shoppingCheckBody),
    (ctx) => {
      const { productKey, packSize } = ctx.body;
      const product = repos.products.getByKey(productKey);
      const ps = packSize || (product ? product.pack_size : 0);
      const inv = repos.inventory.addPurchase(productKey, {
        packSize: ps,
        unit: product ? product.unit : '',
        // Prefer the learned shelf_days once we have enough samples;
        // otherwise falls back to the seeded products.shelf_days.
        shelfDays: shelfLifeLearner.effectiveShelfDays(product),
      });
      repos.purchaseLog.insert({
        productKey,
        qty: ps,
        unit: product?.unit || '',
        pricePaid: null,
        store: product?.store || null,
        source: 'manual',
      });
      invalidate('shopping', 'inventory', 'today');
      ctx.json({ ok: true, inventory: inv });
    }
  );

  router.post(
    '/api/shopping/add',
    requireRole('adult'),
    validateBody(schemas.shoppingAddBody),
    (ctx) => {
      const wk = ensureCurrentWeek(repos);
      repos.shoppingExtras.add(wk, ctx.body);
      invalidate('shopping');
      ctx.json({ ok: true });
    }
  );

  // ---- Persistent shopping list (Iterasjon 3b fase A) --------------

  /**
   * POST /api/shopping/generate — generate (or regenerate) the active
   * shopping list for a week.
   *
   * Body: { weekYear?, force?, mode? }
   *   - mode='merge' (default): smart-merge preserves bought items
   *     and manual/extra rows, then adds fresh meal-ingredient rows
   *     from the current meal plan. The frontend "Regenerate from
   *     this week's meals" CTA uses this mode.
   *   - mode='replace': wipe and regenerate from scratch.
   *   - force=true: allow even when the week is not complete.
   *
   * Fails with 400 WEEK_NOT_COMPLETE if the week is incomplete and
   * force is not set.
   */
  router.post(
    '/api/shopping/generate',
    requireRole('adult'),
    validateBody(schemas.shoppingGenerateBody),
    (ctx) => {
      const wk = ctx.body.weekYear || ensureCurrentWeek(repos);
      if (!repos.mealPlans.exists(wk)) ensureCurrentWeek(repos);
      try {
        const result = generateForWeek(repos, wk, {
          force: !!ctx.body.force,
          mode: ctx.body.mode || 'merge',
        });
        invalidate('shopping');
        // Phase B: background enrichment kicks off immediately, self-rate-limited.
        if (result && result.listId) {
          enrichInBackground(repos, result.listId);
        }
        ctx.json({ ok: true, ...result });
      } catch (err) {
        if (err.code === 'WEEK_NOT_COMPLETE') {
          throw errors.badRequest(err.message, { code: err.code });
        }
        throw err;
      }
    }
  );

  /**
   * GET /api/shopping/list/current — active shopping list for the current
   * week. Returns the same shape as /list/:id. Does not create one —
   * returns a 404 if no active list exists for the week.
   *
   * NOTE: must be registered BEFORE /api/shopping/list/:id since the
   * router matches in registration order and :id would otherwise capture
   * 'current'.
   */
  router.get('/api/shopping/list/current', (ctx) => {
    const wk = ensureCurrentWeek(repos);
    const list = repos.shoppingLists.getActive(wk);
    if (!list) {
      // No active persistent list — return an empty shell so the UI can
      // show "No shopping list generated yet" without throwing.
      ctx.json({
        id: null,
        weekYear: wk,
        status: null,
        enrichmentStatus: 'done',
        items: [],
        categories: [],
        totalEstPrice: 0,
      });
      return;
    }
    // Group items by category for fast UI rendering (same shape as the
    // /api/shopping/current legacy route).
    const categoriesMap = new Map();
    let total = 0;
    for (const it of list.items) {
      // Bought items remain on the list (user requested toggle-not-hide in
      // test 0.2). Frontend styles them with .checked-off + exposes an undo
      // action; checkedOff is true when bought_at is set.
      // Items without a category fall under the 'other' enum-key — the
      // frontend localises that bucket header through i18n. Pre-existing
      // seed items carry their Norwegian category strings (Frukt & grønt,
      // Meieri, ...) and pass through unchanged; that broader migration
      // is tracked in design-gaps.md.
      const cat = it.category || 'other';
      if (!categoriesMap.has(cat)) categoriesMap.set(cat, []);
      // enrichItemForFrontend gives the row a stable shape (name,
      // checkedOff, stillNeed, mealsJson:[]). The same helper is used
      // by POST /api/shopping/items so the contract stays in lockstep.
      categoriesMap.get(cat).push(enrichItemForFrontend(it));
      total += it.estPrice || 0;
    }

    // Sorter items innenfor hver kategori etter kjede-preferanse
    const profile = repos.familyProfile ? repos.familyProfile.get() : {};
    const prefChain = (profile.preferredChain || '').toLowerCase();
    const secChain = (profile.secondaryChain || '').toLowerCase();
    if (prefChain || secChain) {
      for (const [, items] of categoriesMap) {
        for (const it of items) {
          const chain = (extractChain(it.lastSeenStore) || '').toLowerCase();
          it._chainRank = chain === prefChain ? 0 : chain === secChain ? 1 : 2;
        }
        items.sort((a, b) => {
          if (a._chainRank !== b._chainRank) return a._chainRank - b._chainRank;
          return (a.name || '').localeCompare(b.name || '', 'nb');
        });
      }
    }

    ctx.json({
      id: list.id,
      weekYear: list.weekYear,
      status: list.status,
      enrichmentStatus: list.enrichmentStatus,
      generatedAt: list.generatedAt,
      confirmedAt: list.confirmedAt,
      totalEstPrice: list.totalEstPrice || Math.round(total),
      categories: Array.from(categoriesMap.entries()).map(([category, items]) => ({
        category,
        items,
      })),
      items: list.items,
    });
  });

  /**
   * GET /api/shopping/list/:id — full persistent liste med items.
   */
  router.get('/api/shopping/list/:id', (ctx) => {
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw errors.badRequest('Invalid id');
    const list = repos.shoppingLists.getById(id);
    if (!list) throw errors.notFound(`Shopping list ${id} not found`);
    ctx.json({ list });
  });

  /**
   * PUT /api/shopping/items/:id/bought — mark item as bought. Updates
   * pantry via inventory.addPurchase + inventory_log
   * (reason='shopping_bought'), and if the item has a resolution →
   * productResolutions.incrementConfirmed.
   */
  router.put(
    '/api/shopping/items/:id/bought',
    requireRole('adult'),
    validateBody(schemas.shoppingItemBoughtBody),
    (ctx) => {
      const itemId = parseInt(ctx.params.id, 10);
      if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Invalid id');
      const parent = repos.shoppingLists.getItemWithList(itemId);
      if (!parent) throw errors.notFound(`Item ${itemId} not found`);
      const { item } = parent;
      if (item.boughtAt) {
        ctx.json({ ok: true, alreadyBought: true });
        return;
      }

      // Resolve a productKey for legacy manual items that pre-date the
      // POST /api/shopping/items productKey-resolve step. Without this
      // backfill, every row inserted before that fix lands here with
      // productKey=null and silently bypasses the pantry update — the
      // bug Christer reported on the Phase 2E pantry sub-view. Persist
      // the resolved key so subsequent reads carry the same identity.
      let productKey = item.productKey;
      if (!productKey && item.ingredientName) {
        try {
          const resolved = pantryResolver.resolveOrCreate(repos, item.ingredientName);
          if (resolved && resolved.productKey) {
            productKey = resolved.productKey;
            if (typeof repos.shoppingLists.setProductKey === 'function') {
              repos.shoppingLists.setProductKey(itemId, productKey);
            }
          }
        } catch {
          /* fall through with productKey still null */
        }
      }

      // Default to 1 unit when neither the request body nor the row
      // carries a quantity. Manual QuickAdd items routinely arrive
      // with qty=null because the user only typed a name; without a
      // sane default the qtyPurchased>0 gate below would still skip
      // the pantry update even after productKey is resolved.
      const qtyPurchased = ctx.body.qty ?? item.packSize ?? item.qty ?? 1;

      const tx = repos.transaction(() => {
        repos.shoppingLists.markItemBought(itemId, qtyPurchased);

        // Pantry + inventory_log (kun hvis vi vet product_key og qty > 0)
        if (productKey && qtyPurchased > 0) {
          const prev = repos.inventory.getByKey(productKey);
          const prevQty = prev?.qtyRemaining || 0;
          const product = repos.products.getByKey(productKey);
          repos.inventory.addPurchase(productKey, {
            packSize: qtyPurchased,
            unit: item.unit || product?.unit || '',
            // Prefer learned shelf-life once enough samples accumulate;
            // seeded products.shelf_days is the fallback.
            shelfDays: shelfLifeLearner.effectiveShelfDays(product),
          });
          const next = repos.inventory.getByKey(productKey);
          repos.inventoryLog.insert({
            productKey,
            qtyDelta: (next?.qtyRemaining || 0) - prevQty,
            newQty: next?.qtyRemaining || 0,
            unit: item.unit || product?.unit || null,
            reason: 'shopping_bought',
            sourceId: itemId,
            sourceTable: 'shopping_list_items',
          });
        }

        // Capture hook: bekreft resolution for adaptive family persona
        if (item.resolutionId) {
          repos.productResolutions.incrementConfirmed(item.resolutionId);
        }
      });
      tx();

      invalidate('shopping', 'inventory', 'today');
      ctx.json({ ok: true });
    }
  );

  /**
   * PUT /api/shopping/items/:id/unbought — undo "bought".
   *
   * Reverses /bought: clears bought_at and bought_qty, sets needs_buy=1
   * so the item reappears as active. Pantry qty is NOT rolled back —
   * unsafe if the user has eaten something in the meantime. To reduce
   * pantry use the "edit pantry" flow (PUT /api/pantry/correct).
   */
  router.put('/api/shopping/items/:id/unbought', requireRole('adult'), (ctx) => {
    const itemId = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Invalid id');
    const parent = repos.shoppingLists.getItemWithList(itemId);
    if (!parent) throw errors.notFound(`Item ${itemId} not found`);
    repos.shoppingLists.markItemUnbought(itemId);
    invalidate('shopping', 'today');
    ctx.json({ ok: true });
  });

  /**
   * DELETE /api/shopping/items/:id — permanently delete the row from
   * the active shopping list. No soft-delete; the row is removed.
   *
   * Scoped to the active week. If the user generates a new week-plan
   * and the same recipe appears, the ingredient will come back via
   * the usual generation step.
   */
  router.delete('/api/shopping/items/:id', requireRole('adult'), (ctx) => {
    const itemId = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Invalid id');
    const parent = repos.shoppingLists.getItemWithList(itemId);
    if (!parent) throw errors.notFound(`Item ${itemId} not found`);
    repos.shoppingLists.removeItem(itemId);
    invalidate('shopping', 'today');
    ctx.json({ ok: true });
  });

  /**
   * POST /api/shopping/items — manually append a single item to the
   * active shopping list. Used by the QuickAdd input on the Phase 2D
   * Shopping screen. Returns 400 NO_ACTIVE_LIST if no active list
   * exists for the current week — the client is expected to call
   * /api/shopping/generate first in that case.
   */
  router.post(
    '/api/shopping/items',
    requireRole('adult'),
    validateBody(schemas.shoppingItemAddBody),
    (ctx) => {
      const wk = ensureCurrentWeek(repos);
      const list = repos.shoppingLists.getActive(wk);
      if (!list) {
        throw errors.badRequest("No active shopping list — generate from this week's meals first", {
          code: 'NO_ACTIVE_LIST',
        });
      }
      // Resolve a productKey from the manual name so PUT /bought has
      // an inventory-link to write against. resolveOrCreate prefers
      // catalog matches (Kassal/seed) and falls back to slugify; the
      // returned key is stable across repeated adds with the same
      // name. We deliberately do NOT inherit unit/category from the
      // resolver — user-supplied values stay null when omitted, which
      // matches the existing API contract (see tests/shopping-items-
      // add.test.js). The pantry write itself reads unit from the
      // products catalog when item.unit is null.
      let productKey = null;
      try {
        const resolved = pantryResolver.resolveOrCreate(repos, ctx.body.name);
        productKey = resolved?.productKey || null;
      } catch {
        /* if resolver fails, we still insert the row without productKey;
           the lazy-resolve in PUT /bought picks it up later. */
      }
      const item = repos.shoppingLists.addItem(list.id, {
        name: ctx.body.name,
        qty: ctx.body.qty ?? null,
        unit: ctx.body.unit ?? null,
        category: ctx.body.category ?? null,
        notes: ctx.body.notes ?? null,
        productKey,
      });
      invalidate('shopping');
      ctx.json({ ok: true, item }, 201);
    }
  );

  /**
   * PUT /api/shopping/items/:id/has-home — "jeg har denne hjemme allerede".
   *
   * Different from /bought: the row stays on the shopping list (no bought_at,
   * no bought_qty) so the operator can still buy MORE later. We only top up
   * the pantry quantity via inventory.upsertManual() so pantry catches up to
   * reality without recording a purchase event.
   *
   * Body:
   *   qty         — required, how much the operator already has
   *   purchasedAt — optional YYYY-MM-DD, used as last_purchased in pantry
   */
  router.put('/api/shopping/items/:id/has-home', requireRole('adult'), (ctx) => {
    const itemId = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Invalid id');

    const parent = repos.shoppingLists.getItemWithList(itemId);
    if (!parent) throw errors.notFound(`Item ${itemId} not found`);
    const item = parent.item;
    const productKey = item.productKey;
    if (!productKey) {
      throw errors.badRequest('Varen har ingen pantry-kobling');
    }

    const qty = Number(ctx.body?.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw errors.badRequest('Ugyldig qty');

    const purchasedAt =
      typeof ctx.body?.purchasedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ctx.body.purchasedAt)
        ? ctx.body.purchasedAt
        : null;

    const unit = item.unit || '';
    if (typeof repos.inventory.upsertManual !== 'function') {
      throw errors.serviceUnavailable('Inventory-repo mangler upsertManual');
    }
    const { next: nextInv } = repos.inventory.upsertManual(productKey, {
      qtyAdded: qty,
      unit,
      incrementPurchaseCount: false,
    });

    // Optional purchasedAt override — upsertManual always sets last_purchased
    // to today; if the operator specified a date, patch it.
    if (purchasedAt) {
      try {
        repos._db
          ?.prepare('UPDATE inventory SET last_purchased = ? WHERE product_key = ?')
          .run(purchasedAt, productKey);
      } catch {
        /* ignore — cosmetic date override */
      }
    }

    try {
      if (typeof repos.inventoryLog?.insert === 'function') {
        repos.inventoryLog.insert({
          productKey,
          qtyDelta: qty,
          newQty: nextInv?.qtyRemaining ?? null,
          unit,
          reason: 'home_already_have',
          sourceId: itemId,
          sourceTable: 'shopping_list_items',
        });
      }
    } catch {
      /* logg-skrivefeil skal ikke blokkere hoved-handlingen */
    }

    invalidate('shopping', 'inventory', 'today');
    ctx.json({ ok: true });
  });

  /**
   * POST /api/shopping/items/:id/expiry — record an expiry date for an
   * already-bought shopping row (PR A.2 shelf-life learning).
   *
   * Preconditions: the row must have bought_at set, expiresAt must not
   * predate the purchase. On success we update inventory.expires_est and
   * the shelf-life learner stores an observation that feeds the
   * per-product moving average.
   */
  router.post(
    '/api/shopping/items/:id/expiry',
    requireRole('adult'),
    validateBody(schemas.shoppingItemExpiryBody),
    (ctx) => {
      const itemId = parseInt(ctx.params.id, 10);
      if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Invalid id');

      const parent = repos.shoppingLists.getItemWithList(itemId);
      if (!parent) throw errors.notFound(`Item ${itemId} not found`);
      const item = parent.item;
      const productKey = item.productKey;
      if (!productKey) throw errors.badRequest('Varen har ingen pantry-kobling');
      if (!item.boughtAt) {
        throw errors.badRequest('Item must be marked as bought before setting expiry date');
      }

      const expiresAt = ctx.body.expiresAt;
      const purchasedAt = String(item.boughtAt).slice(0, 10); // bought_at = ISO datetime
      if (expiresAt < purchasedAt) {
        throw errors.badRequest('Expiry date cannot be before purchase date');
      }

      try {
        repos._db
          .prepare('UPDATE inventory SET expires_est = ? WHERE product_key = ?')
          .run(expiresAt, productKey);
      } catch {
        /* cosmetic — best effort */
      }

      const result = shelfLifeLearner.recordObservation({
        productKey,
        purchasedAt,
        expiresAt,
        source: 'shopping_bought',
      });

      invalidate('inventory', 'shopping', 'today');
      ctx.json({ ok: true, ...result });
    }
  );

  /**
   * PUT /api/pantry/expiry — set or update an expiry date for an existing
   * pantry item. purchasedAt defaults to inventory.last_purchased. Captures
   * a shelf-life observation for learning.
   */
  router.put(
    '/api/pantry/expiry',
    requireRole('adult'),
    validateBody(schemas.pantryExpiryBody),
    (ctx) => {
      const { productKey, expiresAt } = ctx.body;
      const inv = repos.inventory.getByKey(productKey);
      if (!inv) throw errors.notFound(`Pantry-vare ${productKey} ikke funnet`);

      const purchasedAt = ctx.body.purchasedAt || inv.lastPurchased;
      if (!purchasedAt) {
        throw errors.badRequest('Missing purchase date — send purchasedAt or set last_purchased');
      }
      if (expiresAt < purchasedAt) {
        throw errors.badRequest('Expiry date cannot be before purchase date');
      }

      try {
        repos._db
          .prepare('UPDATE inventory SET expires_est = ? WHERE product_key = ?')
          .run(expiresAt, productKey);
      } catch {
        /* cosmetic — best effort */
      }

      const result = shelfLifeLearner.recordObservation({
        productKey,
        purchasedAt,
        expiresAt,
        source: 'pantry_edit',
      });

      invalidate('inventory', 'shopping', 'today');
      ctx.json({ ok: true, ...result });
    }
  );

  /**
   * GET /api/products/:productKey/shelf-life — summary used by pantry UI
   * to show learned-shelf-life badges (e.g. "Lært: Nd (X kjøp)") and
   * surface which value is in effect.
   */
  router.get('/api/products/:productKey/shelf-life', (ctx) => {
    const productKey = String(ctx.params.productKey || '').trim();
    if (!productKey) throw errors.badRequest('productKey is required');
    const product = repos.products.getByKey(productKey);
    if (!product) throw errors.notFound(`Produkt ${productKey} ikke funnet`);
    ctx.json(shelfLifeLearner.summarizeProduct(productKey, product));
  });

  /**
   * PUT /api/shopping/items/:id/unpantry — "jeg har ikke denne varen likevel".
   * Flipper pantry_has=0, needs_buy=1.
   */
  router.put('/api/shopping/items/:id/unpantry', requireRole('adult'), (ctx) => {
    const itemId = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Invalid id');
    const parent = repos.shoppingLists.getItemWithList(itemId);
    if (!parent) throw errors.notFound(`Item ${itemId} not found`);
    repos.shoppingLists.markItemUnpantry(itemId);
    invalidate('shopping');
    ctx.json({ ok: true });
  });

  /**
   * POST /api/shopping/list/:id/enrich — manual retry of Kassal enrichment.
   * Used when a previous run stopped on 'partial' (rate limit/circuit) or
   * 'failed'. Returns 202 immediately and runs the enricher in the
   * background. For 'done'/'running' this is no-op (idempotency is handled
   * by enrichList).
   */
  router.post('/api/shopping/list/:id/enrich', requireRole('adult'), (ctx) => {
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw errors.badRequest('Invalid id');
    const list = repos.shoppingLists.getById(id);
    if (!list) throw errors.notFound(`Shopping list ${id} not found`);
    // If the list is on 'partial' or 'failed' we must reset to 'pending'
    // first so enrichList doesn't bail on the 'already_done' check.
    // 'pending' and 'partial' are already passed through by the enricher.
    if (list.enrichmentStatus === 'failed') {
      repos.shoppingLists.setEnrichmentStatus(id, 'pending', {});
    }
    enrichInBackground(repos, id);
    ctx.json({ ok: true, listId: id, enrichmentStatus: 'pending' }, 202);
  });

  /**
   * POST /api/shopping/list/:id/done — close the shopping list manually.
   */
  router.post('/api/shopping/list/:id/done', requireRole('adult'), (ctx) => {
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw errors.badRequest('Invalid id');
    const list = repos.shoppingLists.getById(id);
    if (!list) throw errors.notFound(`Shopping list ${id} not found`);
    repos.shoppingLists.markDone(id);
    invalidate('shopping');
    ctx.json({ ok: true });
  });

  // ============================================================
  // CHORES
  // ============================================================
  router.get('/api/chores', (ctx) => {
    const includeInactive = ctx.query.includeInactive === '1' && hasRole(ctx.user, 'adult');
    const chores = repos.chores.getAll({ includeInactive }).map(toChoreDto);
    ctx.json({ chores });
  });

  router.post('/api/chores', requireRole('adult'), validateBody(schemas.choreCreateBody), (ctx) => {
    let row;
    try {
      row = repos.chores.insert(ctx.body);
    } catch (err) {
      throw errors.badRequest(err.message);
    }
    const defaultDay = ctx.body.defaultDay;
    if (defaultDay != null) {
      const wk = getWeekYear();
      if (repos.choreSchedules.exists(wk)) {
        repos.choreSchedules.add(wk, row.id, defaultDay);
      }
    }
    invalidate('chores', 'today');
    ctx.json({ ok: true, chore: toChoreDto(row) }, 201);
  });

  router.patch(
    '/api/chores/:id',
    requireRole('adult'),
    validateBody(schemas.choreUpdateBody),
    (ctx) => {
      const id = parseInt(ctx.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) throw errors.badRequest('Invalid id');
      let row;
      try {
        row = repos.chores.update(id, ctx.body);
      } catch (err) {
        throw errors.badRequest(err.message);
      }
      if (!row) throw errors.notFound('Oppgave ikke funnet');
      invalidate('chores', 'today');
      ctx.json({ ok: true, chore: toChoreDto(row) });
    }
  );

  router.get(
    '/api/chores/current',
    withCache(['chores'], (ctx) => {
      const wk = ensureCurrentWeek(repos);
      const schedule = repos.choreSchedules.getWeek(wk);
      const choresMap = choreCatalogMap(repos);
      const result = schedule
        .map((s) => {
          const chore = choresMap.get(s.choreId);
          const effectiveDay = s.postponedTo !== null ? s.postponedTo : s.scheduledDay;
          return {
            ...s,
            task: chore?.task || '?',
            icon: chore?.icon || '',
            frequency: chore?.frequency || '',
            details: chore?.details || null,
            effectiveDay,
            dayName: DAY_NAMES[effectiveDay] || '',
          };
        })
        .sort((a, b) => a.effectiveDay - b.effectiveDay);
      ctx.json({ weekYear: wk, chores: result });
    })
  );

  router.put(
    '/api/chores/postpone',
    requireRole('adult'),
    validateBody(schemas.chorePostponeBody),
    (ctx) => {
      const { weekYear, choreId } = ctx.body;
      const wk = weekYear || ensureCurrentWeek(repos);
      const schedule = repos.choreSchedules.getWeek(wk);
      const slot = schedule.find((s) => s.choreId === choreId);
      if (!slot) throw errors.notFound('Oppgave ikke funnet');

      const currentDay = slot.postponedTo !== null ? slot.postponedTo : slot.scheduledDay;
      if (currentDay === 4) {
        const nextWk = getWeekYear(new Date(Date.now() + 7 * 86400000));
        if (!repos.choreSchedules.exists(nextWk)) repos.choreSchedules.seedDefault(nextWk);
        repos.choreSchedules.add(nextWk, choreId, 0);
        repos.choreSchedules.postpone(wk, choreId, -1);
      } else if (currentDay < 4) {
        repos.choreSchedules.postpone(wk, choreId, currentDay + 1);
      }
      invalidate('chores', 'today');
      ctx.json({ ok: true });
    }
  );

  router.put('/api/chores/complete', validateBody(schemas.choreCompleteBody), (ctx) => {
    const { weekYear, choreId } = ctx.body;
    const wk = weekYear || ensureCurrentWeek(repos);
    // B5 gamification: attribute the completion to a real user id when
    // possible. Synthetic LOCAL_USER (pilot single-tenant) has id=0 and
    // is not a row in users — pass null so the chore_completions.user_id
    // FK stays satisfied.
    const userId = ctx.user && !ctx.user._synthetic ? ctx.user.id : null;
    repos.choreSchedules.markDone(wk, choreId, { userId });
    invalidate('chores', 'today');
    ctx.json({ ok: true });
  });

  // Undo "done" or "postponed" — resets status to 'pending' so the row
  // gets its regular action buttons back. Body-schema reuses
  // choreCompleteBody (same { weekYear?, choreId }).
  router.put('/api/chores/undone', validateBody(schemas.choreCompleteBody), (ctx) => {
    const { weekYear, choreId } = ctx.body;
    const wk = weekYear || ensureCurrentWeek(repos);
    repos.choreSchedules.markUndone(wk, choreId);
    invalidate('chores', 'today');
    ctx.json({ ok: true });
  });

  // ============================================================
  // INVENTORY / PRODUCTS / CONSUMABLES
  // ============================================================
  router.get(
    '/api/inventory',
    withCache(['inventory'], (ctx) => {
      ctx.json({ inventory: repos.inventory.getAll() });
    })
  );

  router.get(
    '/api/products',
    withCache(['products'], (ctx) => {
      const q = ctx.query.q || '';
      if (q.length > 500) throw errors.badRequest('q max 500 tegn');
      if (q) ctx.json({ products: repos.products.search(q) });
      else ctx.json({ products: repos.products.getAllAsMap() });
    })
  );

  router.get(
    '/api/consumables',
    withCache(['consumables'], (ctx) => {
      ctx.json({ consumables: repos.consumables.getAll() });
    })
  );

  router.put(
    '/api/consumables/:id',
    requireRole('adult'),
    validateBody(schemas.consumableUpdateBody),
    (ctx) => {
      const id = requirePositiveInt(ctx.params.id);
      repos.consumables.update(id, ctx.body);
      const c = repos.consumables.getById(id);
      if (!c) throw errors.notFound(`Consumable ${id} ikke funnet`);
      invalidate('consumables', 'shopping');
      ctx.json({ ok: true, consumable: c });
    }
  );

  router.post(
    '/api/consumables/:id/bought',
    requireRole('adult'),
    validateBody(schemas.consumableBoughtBody),
    (ctx) => {
      const id = parseInt(ctx.params.id, 10);
      const c = repos.consumables.markBought(id, ctx.body.qty);
      if (!c) throw errors.notFound(`Consumable ${id} ikke funnet`);
      invalidate('consumables', 'shopping');
      ctx.json({ ok: true, consumable: c });
    }
  );

  router.post('/api/consumables/toggle-auto/:id', requireRole('adult'), (ctx) => {
    const id = requirePositiveInt(ctx.params.id);
    const c = repos.consumables.toggleAuto(id);
    if (!c) throw errors.notFound(`Consumable ${id} ikke funnet`);
    invalidate('consumables', 'shopping');
    ctx.json({ ok: true, consumable: c });
  });

  // ============================================================
  // PANTRY (Iteration 1 — manual add + correction + log)
  // ============================================================

  /**
   * GET /api/pantry/suggest?q= — phase F, autocomplete for pantry add.
   * Combines catalog search (repos.products) + pantry history.
   * Always returns a "new" row at the bottom when no exact match exists.
   */
  router.get('/api/pantry/suggest', (ctx) => {
    const q = (ctx.query.q || '').trim();
    if (q.length < 1) {
      ctx.json({ suggestions: [] });
      return;
    }
    const suggestions = pantryResolver.resolvePantryInput(repos, q);
    ctx.json({ suggestions });
  });

  /**
   * GET /api/pantry — flat liste over alle inventory-rader med produktnavn
   * for visning i UI. Skjuler rader med qty_remaining=0 som standard.
   */
  router.get('/api/pantry', (ctx) => {
    const inventoryMap = repos.inventory.getAll();
    const productsMap = repos.products.getAllAsMap();
    const units = require('./services/units');
    const items = [];
    for (const [productKey, inv] of Object.entries(inventoryMap)) {
      if (!inv.qtyRemaining || inv.qtyRemaining <= 0) continue;
      const p = productsMap[productKey];
      const total = inv.totalSize ?? null;
      const ratio = total ? units.calculateRatio(inv.qtyRemaining, total) : null;
      items.push({
        productKey,
        ingredientName: productKey,
        ingredientNameNo: p?.productName || productKey,
        name: p?.productName || productKey,
        quantity: inv.qtyRemaining,
        total,
        ratio,
        isLow: ratio !== null ? ratio < units.LOW_THRESHOLD : false,
        unit: inv.unit || p?.unit || '',
        category: p?.category || null,
        expiresEst: inv.expiresEst || null,
        lastPurchased: inv.lastPurchased || null,
        // PR A.2 — learned shelf-life metadata so pantry UI can show a
        // learned-days badge. shelfDaysLearned stays null until
        // sampleCount crosses MIN_SAMPLES_TO_TRUST.
        shelfDaysLearned: p?.shelfDaysLearned ?? null,
        shelfDaysSampleCount: p?.shelfDaysSampleCount ?? 0,
        shelfDaysSeed: p?.shelfDays ?? null,
      });
    }
    // Sorter alfabetisk etter visningsnavn
    items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nb'));
    ctx.json({ items });
  });

  /**
   * DELETE /api/pantry/:productKey — nullstill pantry-rad ("har ikke likevel").
   * Skriver inventory_log med reason='correction' for audit trail.
   */
  router.delete(
    '/api/pantry/:productKey',
    requireRole('adult'),
    withAudit(
      repos,
      {
        entityType: 'pantry_item',
        getEntityId: (ctx) => ctx.params.productKey,
        getBefore: (ctx) => repos.inventory.getByKey(ctx.params.productKey),
        metadata: () => ({ reason: 'UI: har ikke likevel' }),
      },
      (ctx) => {
        const productKey = ctx.params.productKey;
        if (!productKey) throw errors.badRequest('productKey is required');
        const existing = repos.inventory.getByKey(productKey);
        if (!existing) throw errors.notFound(`Pantry-vare '${productKey}' ikke funnet`);
        try {
          pantryService.correctQty(repos, {
            productKey,
            newQty: 0,
            notes: 'UI: har ikke likevel',
          });
        } catch (err) {
          throw errors.badRequest(err.message);
        }
        invalidate('inventory', 'shopping', 'today');
        ctx.json({ ok: true, productKey });
      }
    )
  );

  router.post(
    '/api/pantry/add',
    requireRole('adult'),
    validateBody(schemas.pantryAddBody),
    (ctx) => {
      try {
        // Fase F: resolve query → productKey hvis klient ikke oppgir productKey
        const body = { ...ctx.body };
        let resolved = null;
        if (!body.productKey && body.query) {
          resolved = pantryResolver.resolveOrCreate(repos, body.query);
          body.productKey = resolved.productKey;
          if (!body.unit && resolved.unit) body.unit = resolved.unit;
          if (!body.category && resolved.category) body.category = resolved.category;
        }
        // Hvis productKey kom direkte, normaliser alltid via slugify for trygghets skyld
        if (body.productKey) {
          const normalized = slugifyProductKey(body.productKey) || body.productKey;
          body.productKey = normalized;
        }
        const result = pantryService.addToPantry(repos, body);
        // Apply optional backdated purchase date. pantryService always
        // stamps last_purchased with today; if the operator picked a
        // different date in the UI, patch it here.
        if (body.purchasedAt && body.productKey) {
          try {
            repos._db
              ?.prepare('UPDATE inventory SET last_purchased = ? WHERE product_key = ?')
              .run(body.purchasedAt, body.productKey);
          } catch {
            /* cosmetic — ignore */
          }
        }
        invalidate('inventory', 'shopping', 'today');
        ctx.json({ ok: true, item: result, resolved: resolved || undefined });
      } catch (err) {
        throw errors.badRequest(err.message);
      }
    }
  );

  router.put(
    '/api/pantry/correct',
    requireRole('adult'),
    validateBody(schemas.pantryCorrectBody),
    (ctx) => {
      try {
        const result = pantryService.correctQty(repos, ctx.body);
        // Optional purchasedAt override — same pattern as /add.
        if (ctx.body.purchasedAt && ctx.body.productKey) {
          try {
            repos._db
              ?.prepare('UPDATE inventory SET last_purchased = ? WHERE product_key = ?')
              .run(ctx.body.purchasedAt, ctx.body.productKey);
          } catch {
            /* cosmetic — ignore */
          }
        }
        invalidate('inventory', 'shopping', 'today');
        ctx.json({ ok: true, ...result });
      } catch (err) {
        throw errors.badRequest(err.message);
      }
    }
  );

  router.get('/api/pantry/log', (ctx) => {
    const limit = Math.min(parseInt(ctx.query.limit, 10) || 100, 500);
    const key = ctx.query.productKey;
    const reason = ctx.query.reason;
    let rows;
    if (key) rows = repos.inventoryLog.getByKey(key, limit);
    else if (reason) rows = repos.inventoryLog.getByReason(reason, limit);
    else rows = repos.inventoryLog.getRecent(limit);
    ctx.json({ log: rows, counts: repos.inventoryLog.countByReason() });
  });

  router.get('/api/pantry/value', (ctx) => {
    ctx.json(priceReferenceService.estimatePantryValue(repos));
  });

  // ============================================================
  // FASE F6 — .env-skriving + integrasjons-test
  // ============================================================
  router.get('/api/settings/env', (ctx) => {
    const envStore = require('./services/env-store.service');
    ctx.json({ values: envStore.readMasked() });
  });

  router.post('/api/settings/env', requireRole('owner'), async (ctx) => {
    const envStore = require('./services/env-store.service');
    const { key, value } = ctx.body || {};
    if (!key || typeof key !== 'string') {
      throw errors.badRequest('key is required');
    }
    if (value === undefined || value === null) {
      throw errors.badRequest('value is required');
    }
    try {
      const result = await envStore.write(key, String(value));
      ctx.json(result);
    } catch (err) {
      throw errors.badRequest(err.message);
    }
  });

  router.post('/api/integrations/:name/test', requireRole('owner'), async (ctx) => {
    const envStore = require('./services/env-store.service');
    const name = ctx.params.name;
    const result = await envStore.testIntegration(name);
    ctx.json(result);
  });

  // ============================================================
  // FASE F7 — Recipe sources (oppskriftskilder)
  // ============================================================
  router.get('/api/sources', (ctx) => {
    const sources = repos.recipeSources ? repos.recipeSources.getAll() : [];
    ctx.json({ sources });
  });

  router.post('/api/sources', requireRole('adult'), (ctx) => {
    if (!repos.recipeSources) {
      throw errors.badRequest('recipe_sources-tabell ikke tilgjengelig (migrasjon?)');
    }
    const { url, type, label } = ctx.body || {};
    if (!url || typeof url !== 'string') {
      throw errors.badRequest('url is required');
    }
    // Enkel URL-validering
    if (!/^https?:\/\//i.test(url)) {
      throw errors.badRequest('url must start with http:// or https://');
    }
    const recipeSourcesService = require('./services/recipe-sources.service');
    const detectedType = type || recipeSourcesService.detectType(url);
    try {
      const id = repos.recipeSources.insert({ url, type: detectedType, label });
      ctx.json({ ok: true, id, type: detectedType });
    } catch (err) {
      // UNIQUE constraint
      if (err.message && err.message.includes('UNIQUE')) {
        throw errors.badRequest('Denne URL-en finnes allerede');
      }
      throw errors.badRequest(err.message);
    }
  });

  router.delete(
    '/api/sources/:id',
    requireRole('adult'),
    withAudit(
      repos,
      {
        entityType: 'recipe_source',
        getEntityId: (ctx) => parseInt(ctx.params.id, 10),
        getBefore: (ctx) => {
          const id = parseInt(ctx.params.id, 10);
          return Number.isFinite(id) && repos.recipeSources
            ? repos.recipeSources.getById(id)
            : null;
        },
      },
      (ctx) => {
        if (!repos.recipeSources) throw errors.notFound('not supported');
        const id = requirePositiveInt(ctx.params.id);
        repos.recipeSources.delete(id);
        ctx.json({ ok: true });
      }
    )
  );

  router.post('/api/sources/:id/sync', requireRole('adult'), async (ctx) => {
    if (!repos.recipeSources) throw errors.notFound('not supported');
    const id = requirePositiveInt(ctx.params.id);
    const recipeSourcesService = require('./services/recipe-sources.service');
    const result = await recipeSourcesService.syncSource(repos, id);
    ctx.json(result);
  });

  // ============================================================
  // FASE F3 — Family profile + filter usage
  // ============================================================
  router.get('/api/profile', (ctx) => {
    ctx.json(repos.familyProfile.get());
  });

  router.put(
    '/api/profile',
    requireRole('adult'),
    validateBody(schemas.profileUpdateBody),
    withAudit(
      repos,
      {
        entityType: 'family_profile',
        getEntityId: () => 'default',
        getBefore: () => repos.familyProfile.get(),
        getAfter: () => repos.familyProfile.get(),
      },
      (ctx) => {
        const body = ctx.body || {};
        const updated = repos.familyProfile.update(body);
        ctx.json({ ok: true, profile: updated });
      }
    )
  );

  router.get('/api/profile/defaults', (ctx) => {
    // Return recommended filter suggestions based on the family profile
    const profile = repos.familyProfile.get();
    const suggestions = [];

    // Allergy-based: if lactose is in allergies → suggest "Lactose-free"
    for (const allergy of profile.allergies || []) {
      const lower = String(allergy).toLowerCase();
      if (lower.includes('laktose')) suggestions.push('laktosefri');
      if (lower.includes('gluten')) suggestions.push('glutenfri');
      if (lower.includes('nøtt') || lower.includes('nott')) suggestions.push('nottefri');
    }

    // Preference-based
    if (profile.preferences?.vegetarian) suggestions.push('vegetar');
    if (profile.preferences?.quickMeals) suggestions.push('rask');
    if (profile.preferences?.familyFriendly) suggestions.push('barnevennlig');

    ctx.json({
      recommended: [...new Set(suggestions)],
      profile: { hasData: (profile.members?.length || 0) > 0 },
    });
  });

  router.get('/api/profile/filter-usage', (ctx) => {
    const limit = Math.min(parseInt(ctx.query.limit, 10) || 3, 10);
    const topN = repos.filterUsage.getTopN(limit);
    ctx.json({ top: topN });
  });

  router.post('/api/profile/filter-usage', (ctx) => {
    const { filterId, action } = ctx.body || {};
    if (!filterId || typeof filterId !== 'string') {
      throw errors.badRequest('filterId is required');
    }
    if (!['enabled', 'disabled'].includes(action)) {
      throw errors.badRequest('action must be "enabled" or "disabled"');
    }
    repos.filterUsage.recordUsage(filterId, action);
    ctx.json({ ok: true });
  });

  // ============================================================
  // PRICE REFERENCES (Iterasjon 1)
  // ============================================================
  router.get('/api/prices/lookup', (ctx) => {
    const productKey = ctx.query.productKey;
    const ean = ctx.query.ean;
    if (!productKey && !ean) {
      throw errors.badRequest('productKey or ean must be provided');
    }
    const result = priceReferenceService.lookupPrice(repos, productKey, { ean });
    if (!result) {
      ctx.json({ found: false, productKey: productKey || null, ean: ean || null });
      return;
    }
    ctx.json({ found: true, ...result });
  });

  router.get('/api/prices/search', (ctx) => {
    const q = ctx.query.q || '';
    if (!q || q.length < 1) throw errors.badRequest('q is required');
    if (q.length > 500) throw errors.badRequest('q max 500 tegn');
    const results = repos.priceReferences.search(q, 20);
    ctx.json({ query: q, results });
  });

  router.get('/api/prices/stats', (ctx) => {
    ctx.json(repos.priceReferences.stats());
  });

  // ============================================================
  // RECEIPTS (Iteration 2 — receipt ingest)
  // ============================================================
  // Upload accepts raw binary (image/*, application/pdf) via the request
  // body. MIME must be provided via Content-Type.
  router.post('/api/receipts/upload', requireRole('adult'), async (ctx) => {
    const contentType = ctx.req.headers['content-type'] || 'application/octet-stream';
    const mimeType = contentType.split(';')[0].trim();
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(mimeType)) {
      throw errors.badRequest(`Invalid MIME type: ${mimeType}. Allowed: ${allowed.join(', ')}`);
    }

    const MAX = 10 * 1024 * 1024;
    const declaredLength = parseInt(ctx.req.headers['content-length'], 10);
    if (declaredLength > MAX) {
      throw errors.payloadTooLarge(`Content-Length ${declaredLength} overstiger maks ${MAX} bytes`);
    }

    const chunks = [];
    let total = 0;
    for await (const chunk of ctx.req) {
      total += chunk.length;
      if (total > MAX) throw errors.payloadTooLarge(`Fil > ${MAX} bytes`);
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) throw errors.badRequest('Tom fil');

    try {
      const result = await receiptService.processUpload(repos, { buffer, mimeType });
      const items = repos.receiptItems.getByReceipt(result.receiptId);
      const receipt = repos.receipts.getById(result.receiptId);
      invalidate('receipts');
      ctx.json({ ok: true, ...result, receipt, items });
    } catch (err) {
      throw errors.internal(err.message);
    }
  });

  router.get('/api/receipts', (ctx) => {
    const status = ctx.query.status || null;
    const limit = Math.min(parseInt(ctx.query.limit, 10) || 50, 200);
    ctx.json({
      receipts: repos.receipts.list({ status, limit }),
      stats: repos.receipts.stats(),
    });
  });

  router.get('/api/receipts/:id', (ctx) => {
    const id = parseInt(ctx.params.id, 10);
    const receipt = repos.receipts.getById(id);
    if (!receipt) throw errors.notFound(`Receipt ${id} ikke funnet`);
    const items = repos.receiptItems.getByReceipt(id);
    ctx.json({ receipt, items });
  });

  router.put(
    '/api/receipts/confirm',
    requireRole('adult'),
    validateBody(schemas.receiptConfirmBody),
    (ctx) => {
      const { receiptId, items } = ctx.body;
      const receipt = repos.receipts.getById(receiptId);
      if (!receipt) throw errors.notFound(`Receipt ${receiptId} not found`);

      // Optional: user has made edits before confirm
      if (Array.isArray(items)) {
        for (const edit of items) {
          const { id, ...fields } = edit;
          repos.receiptItems.updateItem(id, fields);
        }
      }

      try {
        const result = receiptService.confirmReceipt(repos, receiptId);
        invalidate('receipts', 'inventory', 'shopping', 'today');
        ctx.json({ ok: true, ...result });
      } catch (err) {
        throw errors.badRequest(err.message);
      }
    }
  );

  router.delete(
    '/api/receipts/:id',
    requireRole('adult'),
    withAudit(
      repos,
      {
        entityType: 'receipt',
        getEntityId: (ctx) => parseInt(ctx.params.id, 10),
        getBefore: (ctx) => {
          const id = parseInt(ctx.params.id, 10);
          return Number.isFinite(id) ? repos.receipts.getById(id) : null;
        },
        metadata: () => ({ reason: 'rejected via API' }),
      },
      (ctx) => {
        const id = parseInt(ctx.params.id, 10);
        const receipt = repos.receipts.getById(id);
        if (!receipt) throw errors.notFound(`Receipt ${id} ikke funnet`);
        repos.receipts.markStatus(id, 'rejected');
        invalidate('receipts');
        ctx.json({ ok: true, status: 'rejected' });
      }
    )
  );

  // ============================================================
  // TODAY
  // ============================================================
  router.get(
    '/api/today',
    withCache(['today'], (ctx) => {
      const wk = ensureCurrentWeek(repos);
      const dayOfWeek = (new Date().getDay() + 6) % 7;
      const plan = repos.mealPlans.getWeek(wk);
      const todaySlot = plan.find((p) => p.dayOfWeek === dayOfWeek);
      const recipe = todaySlot?.recipeId ? repos.recipes.getById(todaySlot.recipeId) : null;

      const choresMap = choreCatalogMap(repos);
      const todayChores = repos.choreSchedules
        .getWeek(wk)
        .filter((s) => {
          const effectiveDay =
            s.postponedTo !== null && s.postponedTo >= 0 ? s.postponedTo : s.scheduledDay;
          return effectiveDay === dayOfWeek && s.status !== 'done';
        })
        .map((s) => {
          const chore = choresMap.get(s.choreId);
          return { ...s, task: chore?.task, icon: chore?.icon };
        });

      const todayStr = new Date().toISOString().slice(0, 10);
      const events = repos.calendar.getEvents(todayStr, todayStr);

      ctx.json({
        dayName: DAY_NAMES[dayOfWeek],
        dayOfWeek,
        weekYear: wk,
        meal: todaySlot ? { ...todaySlot, recipe } : null,
        chores: todayChores,
        events,
      });
    })
  );

  // ============================================================
  // SUNDAY PUSH
  // ============================================================
  router.get('/api/sunday-push', (ctx) => {
    const draft = generateSundayDraft(repos);
    repos.sundayDrafts.save(draft.weekYear, draft.meals);

    const hasExisting = repos.mealPlans.exists(draft.weekYear);
    if (!hasExisting) repos.mealPlans.seedDefault(draft.weekYear, draft.meals);

    const shopList = buildShoppingList(repos, draft.weekYear);
    const meals = draft.meals.map((s) => ({
      ...s,
      dayName: DAY_NAMES[s.dayOfWeek],
      recipe: repos.recipes.getById(s.recipeId),
    }));

    const productsMap = repos.products.getAllAsMap();
    const freshItems = shopList.categories
      .flatMap((c) => c.items)
      .filter((i) => i.source === 'recipe');
    const shelfDays = freshItems
      .map((i) => productsMap[i.key]?.shelfDays || 365)
      .filter((x) => x < 365);
    const minShelf = shelfDays.length > 0 ? Math.min(...shelfDays) : 14;
    const handledag = minShelf <= 2 ? 'Onsdag eller torsdag (ferskvarer!)' : 'Mandag eller tirsdag';

    ctx.json({
      weekYear: draft.weekYear,
      meals,
      shoppingList: shopList,
      handledag,
      message: `Forslag til uke ${draft.weekYear.split('-W')[1]} \u2014 tilpass som du vil!`,
    });
  });

  router.post(
    '/api/sunday-push/accept',
    requireRole('adult'),
    validateBody(schemas.sundayAcceptBody),
    (ctx) => {
      const { weekYear, meals } = ctx.body;
      const tx = repos.transaction(() => {
        for (const m of meals) {
          repos.mealPlans.setRecipe(
            weekYear,
            m.dayOfWeek,
            m.recipeId || m.recipe?.id,
            m.status || 'planned'
          );
        }
        repos.sundayDrafts.markAccepted(weekYear);
      });
      tx();
      invalidate('meals', 'today', 'shopping');
      ctx.json({ ok: true, weekYear });
    }
  );

  // ============================================================
  // SYSTEM STATUS (used by Settings → About panel)
  // ============================================================
  router.get('/api/status', (ctx) => {
    let driver = 'unknown';
    let migrationCount = 0;
    try {
      // Try to determine backend by looking for a better-sqlite3-specific method
      driver = repos._db && typeof repos._db.name === 'string' ? 'better-sqlite3' : 'sql.js';
    } catch {
      /* silent */
    }
    try {
      migrationCount = repos._db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c;
    } catch {
      /* table may not exist yet */
    }
    // M2.3: expose circuit-breaker state for observability
    let breakers = null;
    try {
      breakers = require('./services/circuit-breaker').snapshotAll();
    } catch {
      /* modulen skal alltid finnes */
    }

    // Dynamic, operator-useful fields. Everything optional-chained so an
    // older build without a given repo method degrades to null in UI.
    const pkg = require('../package.json');
    let llm = null;
    try {
      if (repos.llmConfigs && typeof repos.llmConfigs.getActive === 'function') {
        const active = repos.llmConfigs.getActive();
        if (active) llm = { backend: active.backend || null, model: active.model || null };
      }
    } catch {
      /* ignore */
    }
    let lastBackup = null;
    try {
      const backupModule = require('./backup');
      if (typeof backupModule.getLastBackupInfo === 'function') {
        lastBackup = backupModule.getLastBackupInfo();
      }
    } catch {
      /* backup module optional at runtime */
    }
    const counts = {};
    try {
      counts.recipes = repos.recipes?.count?.() ?? null;
    } catch {
      counts.recipes = null;
    }
    try {
      counts.pantryItems = repos.inventory?.count?.() ?? null;
    } catch {
      counts.pantryItems = null;
    }
    try {
      counts.familyMembers = repos.members?.count?.() ?? null;
    } catch {
      counts.familyMembers = null;
    }

    ctx.json({
      version: pkg.version,
      db: driver,
      migrations: `${migrationCount} applikert`,
      uptime: Math.round(process.uptime()),
      breakers,
      llm,
      lastBackupAt: lastBackup?.ts || null,
      lastBackupBytes: lastBackup?.bytes || null,
      recipeCount: counts.recipes,
      pantryItemCount: counts.pantryItems,
      familyMemberCount: counts.familyMembers,
    });
  });

  // ============================================================
  // LLM / STT
  // ============================================================
  router.get('/api/llm/status', async (ctx) => {
    const llmStatus = await isLLMAvailable();
    const sttStatus = await isSTTAvailable();
    ctx.json({
      ...llmStatus,
      model: OLLAMA_MODEL,
      backend: LLM_BACKEND,
      stt: sttStatus,
      kb: { totalInteractions: repos.kb.count() },
    });
  });

  // Uke 5 PERF-5: LLM cache health + prune expired entries.
  // Dette er en "hygiene"-endpoint som kan kalles av cron eller manuelt
  // fra Kontrollrommet. Cleanup tar <10ms for hundrevis av entries.
  router.post('/api/llm/warm', (ctx) => {
    const entriesBefore = repos.llmCache.count();
    let pruned;
    try {
      pruned = repos.llmCache.cleanup();
    } catch (err) {
      throw errors.internal('LLM cache cleanup failed: ' + err.message);
    }
    const stats = repos.llmCache.stats();
    ctx.json({
      ok: true,
      entriesBefore,
      pruned,
      entriesAfter: stats.entries,
      totalHits: stats.totalHits,
      note: 'Cleanup only removes expired entries. Active warming requires real LLM access.',
    });
  });

  router.get('/api/llm/cache/stats', (ctx) => {
    ctx.json(repos.llmCache.stats());
  });

  router.post('/api/stt/transcribe', requireRole('adult'), async (ctx) => {
    // STT tar r\u00e5 buffer, ikke JSON \u2014 les direkte fra req
    const chunks = [];
    for await (const chunk of ctx.req) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);
    try {
      const result = await transcribe(audioBuffer, { format: 'wav' });
      ctx.json(result);
    } catch (err) {
      throw errors.internal(err.message);
    }
  });

  router.get('/api/stt/status', async (ctx) => {
    ctx.json(await isSTTAvailable());
  });

  router.post(
    '/api/llm/chat',
    requireRole('adult'),
    validateBody(schemas.llmChatBody),
    async (ctx) => {
      const { message, history, saveToKB } = ctx.body;
      const wk = ensureCurrentWeek(repos);
      const dayOfWeek = (new Date().getDay() + 6) % 7;
      const plan = repos.mealPlans.getWeek(wk);
      const todaySlot = plan.find((p) => p.dayOfWeek === dayOfWeek);
      const todayRecipe = todaySlot?.recipeId ? repos.recipes.getById(todaySlot.recipeId) : null;

      const choresMap = choreCatalogMap(repos);
      const todayChoresList = repos.choreSchedules
        .getWeek(wk)
        .filter((s) => {
          const eff = s.postponedTo !== null && s.postponedTo >= 0 ? s.postponedTo : s.scheduledDay;
          return eff === dayOfWeek && s.status !== 'done';
        })
        .map((s) => choresMap.get(s.choreId)?.task)
        .filter(Boolean);

      const dbAdapter = { kbSearch: (q, l) => repos.kb.search(q, l) };
      const result = await chat(
        message,
        history || [],
        {
          todayMeal: todayRecipe?.name,
          todayChores: todayChoresList.join(', ') || 'Ingen',
        },
        dbAdapter
      );

      const executedTools = [];
      if (result.type === 'tool_calls' && result.toolCalls) {
        for (const tc of result.toolCalls) {
          try {
            const toolResult = executeToolCall(repos, tc.name, tc.arguments, wk);
            executedTools.push({ tool: tc.name, args: tc.arguments, result: toolResult });
            repos.llmAudit.log({
              toolName: tc.name,
              arguments: tc.arguments,
              result: toolResult,
              success: toolResult.ok !== false,
              userMessage: message,
            });
          } catch (err) {
            executedTools.push({ tool: tc.name, args: tc.arguments, error: err.message });
            repos.llmAudit.log({
              toolName: tc.name,
              arguments: tc.arguments,
              result: { error: err.message },
              success: false,
              userMessage: message,
            });
          }
        }
      }

      const responseText =
        result.type === 'tool_calls'
          ? result.textResponse ||
            executedTools.map((t) => t.result?.message || `\u2713 ${t.tool}`).join('\n')
          : result.content;

      if (saveToKB) {
        const intent = await extractIntent(message).catch(() => ({ intent: 'chat' }));
        repos.kb.insert({
          timestamp: new Date().toISOString(),
          userMessage: message,
          aiResponse: responseText,
          context: { meal: todayRecipe?.name, dayOfWeek },
          intent: intent.intent,
          entities: intent.entities,
        });
      }

      ctx.json({
        response: responseText,
        toolCalls: executedTools.length > 0 ? executedTools : undefined,
      });
    }
  );

  router.post(
    '/api/llm/recipe',
    requireRole('adult'),
    validateBody(schemas.llmRecipeBody),
    async (ctx) => {
      const query = ctx.body.query;

      // Library-first: if an existing recipe matches the typed name, return
      // it without calling the LLM. This eliminates hallucinated URLs for
      // anything already in the family's saved library.
      try {
        const existing = repos.recipes.findByName(query);
        if (existing) {
          ctx.res.setHeader('X-LLM-Cache', 'LIBRARY');
          return ctx.json({
            name: existing.name,
            category: existing.category,
            prepTime: existing.prepTime,
            servings: existing.servings,
            url: existing.url || null,
            source: 'library',
            recipeId: existing.id,
            ingredients: (existing.ingredients || []).map((i) => ({
              name: i.name,
              qty: i.qty,
              unit: i.unit,
              optional: !!i.optional,
            })),
          });
        }
      } catch {
        /* fall through to LLM on repo error */
      }

      // Persistent LLM cache: the same recipe query returns the same answer
      // for 7 days. Cache-key is bumped to recipe-v2: so old hallucinated
      // URLs from the pre-fix cache are no longer hit.
      const key = crypto
        .createHash('sha256')
        .update(`recipe-v2:${OLLAMA_MODEL}:${query.toLowerCase().trim()}`)
        .digest('hex');
      const hit = repos.llmCache.get(key);
      if (hit) {
        ctx.res.setHeader('X-LLM-Cache', 'HIT');
        try {
          return ctx.json({ ...JSON.parse(hit.response), source: 'llm' });
        } catch {
          /* fall through to regeneration */
        }
      }
      const result = await suggestRecipeFromText(query);
      if (result && !result.error) {
        repos.llmCache.set(key, {
          model: OLLAMA_MODEL,
          prompt: query,
          response: JSON.stringify(result),
          ttlSeconds: 7 * 24 * 3600,
        });
      }
      ctx.res.setHeader('X-LLM-Cache', 'MISS');
      ctx.json({ ...result, source: result && !result.error ? 'llm' : undefined });
    }
  );

  // Generate with LLM and save the recipe in the family library in one call.
  // Used by "Swap dinner" when the user accepts an AI-generated recipe:
  // meal_plans.recipe_id is FK to recipes, so we must persist before swap.
  router.post('/api/recipes/from-llm', requireRole('adult'), async (ctx) => {
    const query = String(ctx.body?.query || '').trim();
    if (!query) throw errors.badRequest('Missing query');

    // If the library already has a match, reuse it.
    const existing = repos.recipes.findByName(query);
    if (existing) {
      return ctx.json({ ok: true, recipeId: existing.id, source: 'library', recipe: existing });
    }

    const llmResult = await suggestRecipeFromText(query);
    if (!llmResult || llmResult.error || !llmResult.name) {
      throw errors.badRequest(llmResult?.error || 'AI kunne ikke generere oppskrift');
    }
    const allowedCategories = new Set(['rask', 'comfort', 'helg']);
    const category = allowedCategories.has(llmResult.category) ? llmResult.category : 'comfort';
    const payload = {
      name: String(llmResult.name).slice(0, 200),
      category,
      prepTime: llmResult.prepTime || null,
      servings: Number(llmResult.servings) > 0 ? Number(llmResult.servings) : 2,
      source: 'llm',
      url: null, // never persist hallucinated URLs
      notes: Array.isArray(llmResult.instructions) ? llmResult.instructions.join('\n') : null,
      equipment: Array.isArray(llmResult.equipment) ? llmResult.equipment : null,
      ingredients: Array.isArray(llmResult.ingredients)
        ? llmResult.ingredients
            .filter((i) => i && i.name && Number.isFinite(Number(i.qty)) && i.unit)
            .map((i) => ({
              name: String(i.name),
              qty: Number(i.qty),
              unit: String(i.unit),
              optional: !!i.optional,
            }))
        : [],
    };
    const recipeId = repos.recipes.insert(payload);
    invalidate('recipes');
    ctx.json({
      ok: true,
      recipeId,
      source: 'llm',
      recipe: { id: recipeId, ...payload },
    });
  });

  // Import recipe from a URL (matprat/godt/generic schema.org/Recipe).
  // The service does the fetch + JSON-LD parsing; we persist and return
  // the stored recipe so the caller can swap to it.
  router.post('/api/recipes/import-url', requireRole('adult'), async (ctx) => {
    const url = String(ctx.body?.url || '').trim();
    if (!url) throw errors.badRequest('Missing url');
    let parsed;
    try {
      const svc = require('./services/recipe-url-import.service');
      parsed = await svc.importRecipeFromUrl(url);
    } catch (err) {
      throw errors.badRequest(err.message || 'Kunne ikke importere oppskrift fra lenke');
    }
    const recipeId = repos.recipes.insert(parsed);
    invalidate('recipes');
    ctx.json({
      ok: true,
      recipeId,
      source: parsed.source || 'imported',
      recipe: { id: recipeId, ...parsed },
    });
  });

  // ============================================================
  // NOTIFICATIONS
  // ============================================================
  router.get('/api/notifications', (ctx) => {
    ctx.json({ notifications: repos.notifications.getUnread() });
  });

  router.put('/api/notifications/read', (ctx) => {
    repos.notifications.markAllRead();
    ctx.json({ ok: true });
  });

  // ============================================================
  // CALENDAR
  // ============================================================
  router.get(
    '/api/calendar/events',
    withCache(['calendar'], (ctx) => {
      const from = ctx.query.from || new Date().toISOString().slice(0, 10);
      const to = ctx.query.to || from;
      ctx.json({ events: repos.calendar.getEvents(from, to) });
    })
  );

  router.post(
    '/api/calendar/events',
    requireRole('adult'),
    validateBody(schemas.calendarEventBody),
    (ctx) => {
      const ev = repos.calendar.insert(ctx.body);
      invalidate('calendar', 'today');
      ctx.json({ ok: true, event: ev });
    }
  );

  router.delete(
    '/api/calendar/events/:id',
    requireRole('adult'),
    withAudit(
      repos,
      {
        entityType: 'calendar_event',
        getEntityId: (ctx) => parseInt(ctx.params.id, 10),
      },
      (ctx) => {
        const evId = parseInt(ctx.params.id, 10);
        repos.calendar.delete(evId);
        invalidate('calendar', 'today');
        ctx.json({ ok: true });
      }
    )
  );

  // ============================================================
  // SBOM-7: Audit log (read-only) — non-repudiation for destruktive ops
  // Krever AUTH_TOKEN i prod; /api/* er allerede bearer-beskyttet.
  // ============================================================
  router.get('/api/audit', (ctx) => {
    const limit = Math.max(1, Math.min(500, parseInt(ctx.query.limit, 10) || 100));
    const entityType = ctx.query.entityType || null;
    const entityId = ctx.query.entityId || null;

    let entries;
    if (entityType) {
      entries = repos.auditLog.getByEntity(entityType, entityId, limit);
    } else {
      entries = repos.auditLog.getRecent(limit);
    }
    ctx.json({
      entries,
      count: entries.length,
      note: 'Append-only log. Hashes are sha256 of JSON-serialised before/after.',
    });
  });

  router.get('/api/audit/stats', (ctx) => {
    ctx.json(repos.auditLog.stats());
  });

  // ============================================================
  // KB / self-improvement
  // ============================================================
  router.get('/api/kb/stats', (ctx) => {
    ctx.json({
      totalInteractions: repos.kb.count(),
      recentTopics: repos.kb.getRecent(5).map((e) => (e.user_message || '').slice(0, 50)),
    });
  });

  router.get('/api/kb/search', (ctx) => {
    const q = ctx.query.q || '';
    if (q.length > 500) throw errors.badRequest('q max 500 tegn');
    ctx.json({ results: repos.kb.search(q, 10) });
  });

  // ============================================================
  // CACHE STATS (Fase 3 observability)
  // ============================================================
  router.get('/api/cache/stats', (ctx) => {
    ctx.json({
      responseCache: responseCache.stats(),
      llmCache: repos.llmCache.stats(),
    });
  });

  // ============================================================
  // METRICS (Fase 5 observability)
  // ============================================================
  //
  // GET /metrics?format=prom    → Prometheus exposition format (default)
  // GET /metrics?format=json    → JSON-snapshot med p50/p95/p99
  //
  // Ligger utenfor /api slik at monitoring-agenter kan scrape uten
  // \u00e5 kollidere med bearer-auth hvis en reverse proxy s\u00f8rger for det.
  router.get('/metrics', (ctx) => {
    const format = ctx.query.format || 'prom';
    if (format === 'json') {
      ctx.json(metrics.snapshot());
      return;
    }
    if (ctx.res.writableEnded) return;
    const body = metrics.toPrometheus();
    const payload = Buffer.from(body, 'utf8');
    ctx.res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Content-Length': String(payload.length),
    });
    ctx.res.end(payload);
  });

  // ============================================================
  // OPENAPI SPEC (Fase 5.4)
  // ============================================================
  // Serveres fra disk slik at klientgeneratorer kan hente den fra /openapi.yaml.
  const openapiPath = path.join(__dirname, '..', 'openapi.yaml');
  router.get('/openapi.yaml', (ctx) => {
    try {
      const yaml = fs.readFileSync(openapiPath, 'utf8');
      const payload = Buffer.from(yaml, 'utf8');
      ctx.res.writeHead(200, {
        'Content-Type': 'application/yaml; charset=utf-8',
        'Content-Length': String(payload.length),
      });
      ctx.res.end(payload);
    } catch {
      throw errors.notFound('openapi.yaml not found on disk');
    }
  });

  // ============================================================
  // Admin: Kassal status (PR C3)
  // ============================================================
  // Reports activation state of the Kassal price-comparison API. Required
  // for the admin UI to know whether the env-gated infrastructure is
  // wired (KASSAL_API_KEY set) or in no-op mode. Admin-only — uses
  // ctx.user.is_admin populated by the auth middleware. When the admin
  // role migration (026) hasn't been applied yet this falls back to
  // false, which 403s — safe.
  router.get('/api/admin/kassal/status', (ctx) => {
    if (!ctx.user || !ctx.user.is_admin) {
      throw errors.forbidden('Admin role required.');
    }
    const kassalClient = require('./services/kassal-client.service');
    const enabled = !!process.env.KASSAL_API_KEY;
    const status = kassalClient.getStatus();
    let productCount = 0;
    let resolutionCount = 0;
    try {
      productCount = repos._db.prepare('SELECT COUNT(*) AS cnt FROM kassal_products').get().cnt;
      resolutionCount = repos._db
        .prepare('SELECT COUNT(*) AS cnt FROM product_resolutions')
        .get().cnt;
    } catch {
      // Tables may not exist on older DB versions.
    }
    ctx.json({
      enabled,
      apiKeyConfigured: status.apiKeyConfigured,
      productCount,
      resolutionCount,
      tokensAvailable: status.tokensAvailable,
      bucketCapacity: status.bucketCapacity,
      circuitOpen: status.circuitOpen,
      circuitOpenUntil: status.circuitOpenUntil,
    });
  });
}

// ============================================================
// Tool-call execution (fra LLM)
// ============================================================
function executeToolCall(repos, toolName, args, weekYear) {
  switch (toolName) {
    case 'add_to_shopping_list':
      repos.shoppingExtras.add(weekYear, {
        name: args.name,
        category: args.category || 'T\u00f8rrvarer & annet',
        quantity: args.quantity || 1,
      });
      invalidate('shopping');
      return {
        ok: true,
        message: `\u2713 Lagt til "${args.name}" i handlelisten (${args.category})`,
      };

    case 'add_calendar_event': {
      const ev = repos.calendar.insert({
        title: args.title,
        date: args.date,
        startTime: args.startTime || null,
        endTime: args.endTime || null,
        location: args.location || null,
      });
      invalidate('calendar', 'today');
      return { ok: true, message: `\u2713 Lagt til "${args.title}" ${args.date}`, event: ev };
    }

    case 'update_routine':
      repos.kb.insert({
        timestamp: new Date().toISOString(),
        userMessage: `[RUTINE] ${args.category}: ${args.description}`,
        aiResponse: `Registrert rutine-endring: ${args.description}`,
        intent: 'routine',
        entities: { category: args.category, action: args.action || 'add' },
      });
      return { ok: true, message: `\u2713 Rutine oppdatert: ${args.description}` };

    case 'suggest_meal': {
      const all = repos.recipes.getAll();
      const criteria = (args.criteria || '').toLowerCase();
      const matches = all
        .filter(
          (r) =>
            r.name.toLowerCase().includes(criteria) ||
            r.category.toLowerCase().includes(criteria) ||
            (r.ingredients || []).some((i) => i.name.toLowerCase().includes(criteria))
        )
        .slice(0, 3);
      return matches.length > 0
        ? {
            ok: true,
            message: `Forslag: ${matches.map((r) => `${r.name} (${r.category})`).join(', ')}`,
            suggestions: matches,
          }
        : { ok: true, message: 'Fant ingen oppskrifter som matcher.' };
    }

    case 'search_knowledge_base': {
      const results = repos.kb.search(args.query, 5);
      return results.length === 0
        ? { ok: true, message: 'Ingen relevante funn.' }
        : { ok: true, message: `Fant ${results.length} relevante samtaler`, results };
    }

    default:
      return { ok: false, message: `Ukjent verkt\u00f8y: ${toolName}` };
  }
}

module.exports = { registerRoutes };
