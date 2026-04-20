// Alle API-ruter samlet i \u00e9n fil. Registrerer seg p\u00e5 en router-instans.
// Hver rute-handler er en async (ctx) => ... funksjon.
// Validering skjer via Zod-middleware f\u00f8r handleren.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { getWeekYear, chores: seedChores } = require('./seed');
const { errors } = require('./http/errors');
const { validateBody } = require('./http/validate');
const { registerAuthRoutes } = require('./auth/routes');
const { registerFamilyRoutes } = require('./auth/family-routes');
const { registerLlmConfigRoutes } = require('./auth/llm-routes');
const { registerGdprRoutes } = require('./auth/gdpr-routes');
const { registerOnboardingRoutes } = require('./auth/onboarding-routes');
const { registerFeedbackRoutes } = require('./http/feedback-routes');
const { registerBootstrapRoutes } = require('./http/bootstrap');
const { config } = require('./config');
const { requireRole } = require('./auth/middleware');
const { withCache, invalidate, responseCache } = require('./http/cache');
const metrics = require('./http/metrics');
const schemas = require('./schemas');

const { buildShoppingList, generateForWeek } = require('./services/shopping-list.service');
const { enrichInBackground } = require('./services/shopping-list-enricher.service');
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
 * Autogenerer handleliste hvis uken nettopp ble komplett og det ikke
 * finnes en aktiv liste fra før. Kalles fra meal-rutene etter mutasjoner.
 * Feil svelges slik at selve meal-oppdateringen ikke feiler pga. handleliste.
 */
function maybeAutogenerateShoppingList(repos, weekYear) {
  try {
    if (!repos.mealPlans.isWeekComplete(weekYear)) return null;
    if (repos.shoppingLists.getActive(weekYear)) return null;
    const result = generateForWeek(repos, weekYear, { force: false });
    invalidate('shopping');
    // Fase B: kick off bakgrunns-berikelse — ingen await, ingen throw.
    // Hvis KASSAL_API_KEY mangler markerer enrichList lista som done noop.
    if (result && result.listId) {
      enrichInBackground(repos, result.listId);
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * SBOM-6: audit-log helper. Wrapper en handler og logger til audit_log etter
 * vellykket respons. Skal kun brukes på destruktive operasjoner (DELETE,
 * overskrivende PUT/PATCH på sensitive ressurser).
 *
 * @param {object} repos
 * @param {object} spec  { entityType, getEntityId?, getBefore?, getAfter?, metadata? }
 * @param {function} handler  (ctx) => void
 */
function withAudit(repos, spec, handler) {
  return (ctx) => {
    // Snapshot "before" før handleren kjører (hvis spec tilbyr getBefore)
    let before = null;
    try {
      if (typeof spec.getBefore === 'function') before = spec.getBefore(ctx, repos);
    } catch {
      /* stille: audit skal ikke blokkere */
    }

    // Kjør handler — kast feil videre slik at http/server.js fanger
    handler(ctx);

    // Registrer audit-hendelse etter at handleren har returnert uten throw.
    // Dette sikrer at mislykkede operasjoner ikke genererer audit-støy.
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
      /* stille: audit-feil må aldri påvirke responsen */
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
  // ONBOARDING (phase 13 — create-family for new users)
  // ============================================================
  registerOnboardingRoutes(router, { repos });

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
      /* stille */
    }

    // Disk-space (statfs finnes bare på Linux med Node ≥18.15, så wrap i try)
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

  // ============================================================
  // RECIPES
  // ============================================================
  router.get('/api/recipes', (ctx) => {
    // Fase F7: støtter ?source=mine|ai|all|imported
    // Filtrerer på recipes.source_type (enum), ikke recipes.source (fritt tekst)
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
    // Uke 9 SAF-2: annoter hver oppskrift med safety-felter
    const allergyFilter = require('./services/allergy-filter.service');
    const profile = repos.familyProfile.get();
    const annotated = filtered.map((r) => allergyFilter.annotateRecipe(r, profile));
    ctx.json({ recipes: annotated });
  });

  router.get('/api/recipes/:id', (ctx) => {
    const id = requirePositiveInt(ctx.params.id);
    const recipe = repos.recipes.getById(id);
    if (!recipe) throw errors.notFound(`Oppskrift ${id} ikke funnet`);
    // Uke 9 SAF-2: annoter med safety-sjekk
    const allergyFilter = require('./services/allergy-filter.service');
    const profile = repos.familyProfile.get();
    const annotated = allergyFilter.annotateRecipe(recipe, profile);
    ctx.json({ recipe: annotated });
  });

  /**
   * Uke 9 SAF-1/SAF-2: POST /api/profile/check-recipe
   * Tar en oppskrift (eller bare ingredients) og returnerer deterministisk
   * allergi-sjekk mot lagret family_profile. Brukes av:
   *  - Recipe-import-flyten (før den lagrer LLM-output)
   *  - Frontend som viser et advarsels-kort
   *  - Testing / debugging
   */
  router.post('/api/profile/check-recipe', requireRole('adult'), (ctx) => {
    const allergyFilter = require('./services/allergy-filter.service');
    const body = ctx.body || {};
    const recipe = body.recipe || { ingredients: body.ingredients || [] };
    if (!Array.isArray(recipe.ingredients)) {
      throw errors.badRequest('recipe.ingredients må være en array');
    }
    // Tillat klient å overstyre profilen (for "sjekk mot hypotetisk profil")
    const profile = body.profile || repos.familyProfile.get();
    const result = allergyFilter.checkRecipe(recipe, profile);
    ctx.json(result);
  });

  /**
   * GET /api/recipes/:id/similar — Fase F4.
   * Returnerer topp-N lignende oppskrifter basert på:
   *   - Ingredient Jaccard-similarity (vekt 0.6)
   *   - Kategori-match (0.3)
   *   - Servings-proximity (0.1)
   */
  router.get('/api/recipes/:id/similar', (ctx) => {
    const recipeSimilarity = require('./services/recipe-similarity.service');
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isFinite(id)) throw errors.badRequest('Ugyldig recipe id');
    const limit = Math.min(parseInt(ctx.query.limit, 10) || 5, 20);
    const similar = recipeSimilarity.findSimilar(repos, id, limit);
    ctx.json({ similar, count: similar.length });
  });

  // Recipe import — tekst (Fase D).
  //
  // Bilde-import går via /api/recipes/import/image (eget endepunkt) fordi
  // den globale body-parseren auto-parser JSON og ikke støtter binær.
  // For bilder kaller frontend førts et base64-JSON-endepunkt, eller så
  // kjøres importFromImage direkte fra en framtidig multipart-rute.
  router.post(
    '/api/recipes/import',
    requireRole('adult'),
    validateBody(schemas.recipeImportTextBody),
    async (ctx) => {
      const result = await recipeImportService.importFromText(repos, ctx.body);
      if (result.error) throw errors.badRequest(result.error);
      invalidate('recipes');
      // Uke 9 SAF-2: kjør deterministisk allergi-sjekk på importert oppskrift
      // FØR respons returneres. Frontend viser advarsel når safeForProfile=false.
      // Selve oppskriften lagres fortsatt (brukeren kan selv velge å beholde
      // den), men flagget stopper "usikker accept".
      if (result.recipe) {
        const allergyFilter = require('./services/allergy-filter.service');
        const profile = repos.familyProfile.get();
        const safety = allergyFilter.checkRecipe(result.recipe, profile);
        result.safeForProfile = safety.safeForProfile;
        result.blockedIngredients = safety.blockedIngredients;
        result.checkedAgainst = safety.checkedAgainst;
      }
      ctx.json({ ok: true, ...result }, 201);
    }
  );

  // Recipe image-import. Bildet sendes som base64-string inni JSON-body:
  //   { imageBase64: "<base64>", mime: "image/png", title?: "..." }
  // Dette unngår binær-parser-problemet og holder ruten kompatibel med
  // den globale JSON-body-parseren.
  router.post('/api/recipes/import/image', requireRole('adult'), async (ctx) => {
    const body = ctx.body || {};
    if (typeof body.imageBase64 !== 'string' || body.imageBase64.length < 20) {
      throw errors.badRequest('imageBase64 er påkrevd og må være en base64-kodet streng');
    }
    const mime = typeof body.mime === 'string' ? body.mime.toLowerCase() : '';
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(mime)) {
      throw errors.badRequest(`Ugyldig mime: ${mime}. Støttet: ${allowed.join(', ')}`);
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
   * POST /api/shopping/generate — generer (eller regenerer) persistent
   * handleliste for en uke. Body: { weekYear?, force? }.
   * Feiler med 400 WEEK_NOT_COMPLETE hvis uken ikke er komplett og
   * force ikke er satt.
   */
  router.post(
    '/api/shopping/generate',
    requireRole('adult'),
    validateBody(schemas.shoppingGenerateBody),
    (ctx) => {
      const wk = ctx.body.weekYear || ensureCurrentWeek(repos);
      if (!repos.mealPlans.exists(wk)) ensureCurrentWeek(repos);
      try {
        const result = generateForWeek(repos, wk, { force: !!ctx.body.force });
        invalidate('shopping');
        // Fase B: bakgrunns-berikelse starter umiddelbart, rater seg selv.
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
   * GET /api/shopping/list/current — aktiv handleliste for nåværende uke.
   * Returnerer samme format som /list/:id. Oppretter ikke ny — returnerer
   * 404 hvis ingen aktiv liste finnes for uken.
   *
   * MERK: må registreres FØR /api/shopping/list/:id siden routeren matcher
   * i registreringsrekkefølge og :id ville ellers fanget 'current'.
   */
  router.get('/api/shopping/list/current', (ctx) => {
    const wk = ensureCurrentWeek(repos);
    const list = repos.shoppingLists.getActive(wk);
    if (!list) {
      // Ingen aktiv persistent liste — returner tomt skall slik at UI kan
      // vise "Ingen handleliste generert ennå" uten å kaste feil.
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
    // Gruppe items etter kategori for rask UI-rendering (samme form som
    // /api/shopping/current legacy-ruta).
    const categoriesMap = new Map();
    let total = 0;
    for (const it of list.items) {
      // Bought items remain on the list (user requested toggle-not-hide in
      // test 0.2). Frontend styles them with .checked-off + exposes an undo
      // action; checkedOff is true when bought_at is set.
      const cat = it.category || 'Tørrvarer & annet';
      if (!categoriesMap.has(cat)) categoriesMap.set(cat, []);
      // stillNeed er computed (ikke lagret i DB) — restmengde som må kjøpes
      // etter at pantry er trukket fra. Frontend bruker dette i render-template.
      const stillNeed = Math.max(0, (it.qty || 0) - (it.pantryQty || 0));
      categoriesMap.get(cat).push({
        ...it,
        stillNeed,
        hasHome: it.pantryQty || 0,
        checkedOff: !!it.boughtAt,
        source: 'recipe',
        isPantry: it.pantryHas,
        name: it.ingredientNameNo || it.ingredientName,
      });
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
    if (!Number.isInteger(id) || id <= 0) throw errors.badRequest('Ugyldig id');
    const list = repos.shoppingLists.getById(id);
    if (!list) throw errors.notFound(`Handleliste ${id} ikke funnet`);
    ctx.json({ list });
  });

  /**
   * PUT /api/shopping/items/:id/bought — merk item som kjøpt. Oppdaterer
   * pantry via inventory.addPurchase + inventory_log (reason='shopping_bought'),
   * og hvis item har en resolution → productResolutions.incrementConfirmed.
   */
  router.put(
    '/api/shopping/items/:id/bought',
    requireRole('adult'),
    validateBody(schemas.shoppingItemBoughtBody),
    (ctx) => {
      const itemId = parseInt(ctx.params.id, 10);
      if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Ugyldig id');
      const parent = repos.shoppingLists.getItemWithList(itemId);
      if (!parent) throw errors.notFound(`Item ${itemId} ikke funnet`);
      const { item } = parent;
      if (item.boughtAt) {
        ctx.json({ ok: true, alreadyBought: true });
        return;
      }

      const qtyPurchased = ctx.body.qty ?? item.packSize ?? item.qty ?? 0;

      const tx = repos.transaction(() => {
        repos.shoppingLists.markItemBought(itemId, qtyPurchased);

        // Pantry + inventory_log (kun hvis vi vet product_key og qty > 0)
        if (item.productKey && qtyPurchased > 0) {
          const prev = repos.inventory.getByKey(item.productKey);
          const prevQty = prev?.qtyRemaining || 0;
          const product = repos.products.getByKey(item.productKey);
          repos.inventory.addPurchase(item.productKey, {
            packSize: qtyPurchased,
            unit: item.unit || product?.unit || '',
            // Prefer learned shelf-life once enough samples accumulate;
            // seeded products.shelf_days is the fallback.
            shelfDays: shelfLifeLearner.effectiveShelfDays(product),
          });
          const next = repos.inventory.getByKey(item.productKey);
          repos.inventoryLog.insert({
            productKey: item.productKey,
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
    if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Ugyldig id');
    const parent = repos.shoppingLists.getItemWithList(itemId);
    if (!parent) throw errors.notFound(`Item ${itemId} ikke funnet`);
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
    if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Ugyldig id');
    const parent = repos.shoppingLists.getItemWithList(itemId);
    if (!parent) throw errors.notFound(`Item ${itemId} ikke funnet`);
    repos.shoppingLists.removeItem(itemId);
    invalidate('shopping', 'today');
    ctx.json({ ok: true });
  });

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
    if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Ugyldig id');

    const parent = repos.shoppingLists.getItemWithList(itemId);
    if (!parent) throw errors.notFound(`Item ${itemId} ikke funnet`);
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
      if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Ugyldig id');

      const parent = repos.shoppingLists.getItemWithList(itemId);
      if (!parent) throw errors.notFound(`Item ${itemId} ikke funnet`);
      const item = parent.item;
      const productKey = item.productKey;
      if (!productKey) throw errors.badRequest('Varen har ingen pantry-kobling');
      if (!item.boughtAt) {
        throw errors.badRequest('Varen må være markert som kjøpt før du kan sette utløpsdato');
      }

      const expiresAt = ctx.body.expiresAt;
      const purchasedAt = String(item.boughtAt).slice(0, 10); // bought_at = ISO datetime
      if (expiresAt < purchasedAt) {
        throw errors.badRequest('Utløpsdato kan ikke være før kjøpsdato');
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
        throw errors.badRequest('Mangler kjøpsdato — send purchasedAt eller sett last_purchased');
      }
      if (expiresAt < purchasedAt) {
        throw errors.badRequest('Utløpsdato kan ikke være før kjøpsdato');
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
   * to show "Lært: Nd (X kjøp)" badges and surface which value is in effect.
   */
  router.get('/api/products/:productKey/shelf-life', (ctx) => {
    const productKey = String(ctx.params.productKey || '').trim();
    if (!productKey) throw errors.badRequest('productKey mangler');
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
    if (!Number.isInteger(itemId) || itemId <= 0) throw errors.badRequest('Ugyldig id');
    const parent = repos.shoppingLists.getItemWithList(itemId);
    if (!parent) throw errors.notFound(`Item ${itemId} ikke funnet`);
    repos.shoppingLists.markItemUnpantry(itemId);
    invalidate('shopping');
    ctx.json({ ok: true });
  });

  /**
   * POST /api/shopping/list/:id/enrich — manuell retry av Kassal-berikelse.
   * Brukes når en tidligere kjøring stoppet på 'partial' (rate limit/circuit)
   * eller 'failed'. Returnerer 202 umiddelbart og kjører enricheren i bakgrunn.
   * For 'done'/'running' er dette no-op (idempotens håndteres av enrichList).
   */
  router.post('/api/shopping/list/:id/enrich', requireRole('adult'), (ctx) => {
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw errors.badRequest('Ugyldig id');
    const list = repos.shoppingLists.getById(id);
    if (!list) throw errors.notFound(`Handleliste ${id} ikke funnet`);
    // Hvis lista står på 'partial' eller 'failed' må vi resette til 'pending'
    // først slik at enrichList ikke bailer på 'already_done'-sjekk. 'pending'
    // og 'partial' slippes gjennom av enricheren allerede.
    if (list.enrichmentStatus === 'failed') {
      repos.shoppingLists.setEnrichmentStatus(id, 'pending', {});
    }
    enrichInBackground(repos, id);
    ctx.json({ ok: true, listId: id, enrichmentStatus: 'pending' }, 202);
  });

  /**
   * POST /api/shopping/list/:id/done — lukk handlelista manuelt.
   */
  router.post('/api/shopping/list/:id/done', requireRole('adult'), (ctx) => {
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw errors.badRequest('Ugyldig id');
    const list = repos.shoppingLists.getById(id);
    if (!list) throw errors.notFound(`Handleliste ${id} ikke funnet`);
    repos.shoppingLists.markDone(id);
    invalidate('shopping');
    ctx.json({ ok: true });
  });

  // ============================================================
  // CHORES
  // ============================================================
  router.get(
    '/api/chores/current',
    withCache(['chores'], (ctx) => {
      const wk = ensureCurrentWeek(repos);
      const schedule = repos.choreSchedules.getWeek(wk);
      const choresMap = new Map(seedChores.map((c) => [c.id, c]));
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
    repos.choreSchedules.markDone(wk, choreId);
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
  // PANTRY (Iterasjon 1 — manuell add + korrigering + log)
  // ============================================================

  /**
   * GET /api/pantry/suggest?q= — fase F, autocomplete for pantry-add.
   * Kombinerer katalog-søk (repos.products) + pantry-historikk.
   * Returnerer alltid en "ny"-rad nederst når ingen eksakt match finnes.
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
        // "Lært: Nd (X kjøp)" badge. shelfDaysLearned stays null until
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
        if (!productKey) throw errors.badRequest('productKey er påkrevd');
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
      throw errors.badRequest('key er påkrevd');
    }
    if (value === undefined || value === null) {
      throw errors.badRequest('value er påkrevd');
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
      throw errors.badRequest('url er påkrevd');
    }
    // Enkel URL-validering
    if (!/^https?:\/\//i.test(url)) {
      throw errors.badRequest('url må begynne med http:// eller https://');
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
        if (!repos.recipeSources) throw errors.notFound('ikke støttet');
        const id = requirePositiveInt(ctx.params.id);
        repos.recipeSources.delete(id);
        ctx.json({ ok: true });
      }
    )
  );

  router.post('/api/sources/:id/sync', requireRole('adult'), async (ctx) => {
    if (!repos.recipeSources) throw errors.notFound('ikke støttet');
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
    // Returner anbefalte filterforslag basert på familieprofil
    const profile = repos.familyProfile.get();
    const suggestions = [];

    // Allergi-basert: hvis laktose er i allergier → foreslå "Laktosefri"
    for (const allergy of profile.allergies || []) {
      const lower = String(allergy).toLowerCase();
      if (lower.includes('laktose')) suggestions.push('laktosefri');
      if (lower.includes('gluten')) suggestions.push('glutenfri');
      if (lower.includes('nøtt') || lower.includes('nott')) suggestions.push('nottefri');
    }

    // Preferanse-basert
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
      throw errors.badRequest('filterId er påkrevd');
    }
    if (!['enabled', 'disabled'].includes(action)) {
      throw errors.badRequest('action må være "enabled" eller "disabled"');
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
      throw errors.badRequest('productKey eller ean må oppgis');
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
    if (!q || q.length < 1) throw errors.badRequest('q er påkrevd');
    if (q.length > 500) throw errors.badRequest('q max 500 tegn');
    const results = repos.priceReferences.search(q, 20);
    ctx.json({ query: q, results });
  });

  router.get('/api/prices/stats', (ctx) => {
    ctx.json(repos.priceReferences.stats());
  });

  // ============================================================
  // RECEIPTS (Iterasjon 2 — kvittering-ingest)
  // ============================================================
  // Upload tar rå binær (image/*, application/pdf) via request body.
  // MIME må oppgis via Content-Type.
  router.post('/api/receipts/upload', requireRole('adult'), async (ctx) => {
    const contentType = ctx.req.headers['content-type'] || 'application/octet-stream';
    const mimeType = contentType.split(';')[0].trim();
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(mimeType)) {
      throw errors.badRequest(`Ugyldig MIME-type: ${mimeType}. Støttet: ${allowed.join(', ')}`);
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
      if (!receipt) throw errors.notFound(`Receipt ${receiptId} ikke funnet`);

      // Valgfritt: bruker har gjort redigeringer før confirm
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

      const choresMap = new Map(seedChores.map((c) => [c.id, c]));
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
  // TEMPORARY DIAGNOSTIC — shopping-bought-state (PR #53)
  //
  // Structural snapshot used to decide between hypotheses H1/H2/H3 in
  // docs/analyses/2026-04-20-shopping-bought-state.md. Scheduled for
  // removal at most 7 days after merge, or immediately after the fix
  // PR for #53 is merged (whichever comes first). Do not build
  // clients against this endpoint.
  //
  // The response deliberately omits every string that could identify
  // which products the family buys. Reviewed in
  // docs/analyses/2026-04-20-diagnostic-endpoint.md.
  // ============================================================
  router.get('/api/debug/shopping-state', (ctx) => {
    ctx.res.setHeader('Cache-Control', 'no-store');

    const generatedAt = new Date().toISOString();
    // Pull the DB path from server/db.js so we do not duplicate the
    // default in two places — keeps ops in sync with the real file.
    const { DB_PATH } = require('./db');

    const meta = { generated_at: generatedAt, db_path: DB_PATH };

    const migrations = (() => {
      try {
        const rows = repos._db
          .prepare(
            'SELECT version, applied_at FROM schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 10'
          )
          .all();
        const totalRow = repos._db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get();
        return {
          applied_total: totalRow?.c ?? 0,
          latest_10: rows.map((r) => ({
            version: String(r.version),
            applied_at: r.applied_at,
          })),
        };
      } catch (err) {
        return { applied_total: 0, latest_10: [], error: err.message };
      }
    })();

    const shoppingSnapshot = (() => {
      try {
        const snap = repos.shoppingLists.diagnosticSnapshot(5);
        return {
          total_rows: snap.totalRows,
          bought_rows: snap.boughtRows,
          bought_but_not_in_pantry: snap.boughtButNotInPantry,
          sample_bought: snap.sampleBought,
        };
      } catch (err) {
        return {
          total_rows: 0,
          bought_rows: 0,
          bought_but_not_in_pantry: 0,
          sample_bought: [],
          error: err.message,
        };
      }
    })();

    const pantry = (() => {
      try {
        return { total_rows: repos.inventory.countAll() };
      } catch (err) {
        return { total_rows: 0, error: err.message };
      }
    })();

    ctx.json({
      meta,
      migrations,
      shopping_list_items: shoppingSnapshot,
      pantry_entries: pantry,
    });
  });

  // ============================================================
  // SYSTEM STATUS (brukes av Settings → Om-panelet)
  // ============================================================
  router.get('/api/status', (ctx) => {
    let driver = 'ukjent';
    let migrationCount = 0;
    try {
      // Prøv å avgjøre backend ved å se etter better-sqlite3-spesifikk metode
      driver = repos._db && typeof repos._db.name === 'string' ? 'better-sqlite3' : 'sql.js';
    } catch {
      /* stille */
    }
    try {
      migrationCount = repos._db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c;
    } catch {
      /* tabellen finnes kanskje ikke ennå */
    }
    // M2.3: eksponer circuit-breaker-tilstand for observability
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
      throw errors.internal('LLM cache cleanup feilet: ' + err.message);
    }
    const stats = repos.llmCache.stats();
    ctx.json({
      ok: true,
      entriesBefore,
      pruned,
      entriesAfter: stats.entries,
      totalHits: stats.totalHits,
      note: 'Cleanup fjerner kun utløpte entries. Aktiv varming krever reell LLM-tilgang.',
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

      const choresMap = new Map(seedChores.map((c) => [c.id, c]));
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

      // Persistert LLM-cache: samme oppskrift-spørsmål returnerer samme svar i 7 dager.
      // Cache-key er bumpet til recipe-v2: slik at gamle hallusinerte URL-er
      // fra pre-fix-cache ikke lenger treffes.
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
          /* falle gjennom til regenerering */
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

  // Generer med LLM og lagre oppskriften i familiens bibliotek i ett kall.
  // Brukes av "Bytt middag" når brukeren aksepterer en AI-generert oppskrift:
  // meal_plans.recipe_id er FK til recipes, så vi må persistere før swap.
  router.post('/api/recipes/from-llm', requireRole('adult'), async (ctx) => {
    const query = String(ctx.body?.query || '').trim();
    if (!query) throw errors.badRequest('Missing query');

    // Hvis biblioteket allerede har en match, gjenbruk den.
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
      note: 'Append-only log. Hashes er sha256 av JSON-serialisert før/etter.',
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
