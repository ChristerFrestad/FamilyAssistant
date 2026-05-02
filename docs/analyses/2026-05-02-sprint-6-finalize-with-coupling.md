# Sprint 6 finalize — smart-coupling + cleanup (Mulighet A)

**Dato:** 2026-05-02
**Branch:** `feat/sprint-6-finalize-with-coupling`
**Type:** Feature (Mulighet A, full chain) + cleanup
**Driver:** Pre-pilot finalisering. Smart-kobling Pantry-Måltider-Handleliste
er kjerneverdi som Christer eksplisitt løftet inn i Sprint 6.

---

## Reisen (full kjede)

### 1. Plan dinner

1.1. User opens Meals screen (read-only state today).
1.2. User picks a day with a recipe (e.g. "Spaghetti Bolognese", 200 g
     mince).
1.3. Day-strip + MealHero render the recipe.
1.4. RecipeIngredients renders scaled ingredient amounts via
     `effectiveScale(family, recipe.servings)`.

### 2. Generate shopping list

2.1. User taps "Generer handleliste" on Shopping screen.
2.2. `POST /api/shopping/generate` creates active list with
     `source_type='meal_ingredient'` rows for each recipe ingredient
     missing from pantry.
2.3. Mince appears at 200 g (scaled).

### 3. Buy

3.1. User toggles mince row "kjøpt".
3.2. `PUT /api/shopping/items/:id/bought` marks bought, decrements 200 g
     into `inventory` via `addPurchase`, writes `inventory_log` row with
     `reason='shopping_bought'`.

### 4. Pantry view

4.1. User switches to Pantry sub-view.
4.2. `GET /api/pantry` returns mince row with qty=200 g.

### 5. Cook the meal (NEW)

5.1. User opens Meals screen, selects today's day.
5.2. **NEW** "Marker tilberedt"-button on MealHero (replaces placeholder).
5.3. User taps button → opens `MarkCookedDialog`.
5.4. Dialog opens via `POST /api/meals/:id/mark-eaten` returning
     suggestions for each recipe ingredient: productKey, display name,
     scaled recipe amount, current pantry qty, matched flag.
5.5. Backend has set `meal_plans.status = 'cooked'` BEFORE returning
     suggestions (cook is committed; deduction is the optional follow-up).
   5.5.1. If recipe has no matched ingredients (none with productKey OR
          none in pantry): suggestions array is empty.
   5.5.2. If recipe is null (slot.status='away'/'skipped'/empty): 400
          NO_RECIPE.
5.6. User reviews per-ingredient cards:
   5.6.1. Each card shows ingredient name + suggested deduction +
          "have N pantryUnit" remaining display.
   5.6.2. User can adjust the deduction value inline (number input).
   5.6.3. User can uncheck individual ingredients (skip from deduction).
   5.6.4. Validation per row: 0 <= deduction <= pantryRemaining.
5.7. User picks one of three terminal actions:
   5.7.1. **"Bekreft trekk"** → `POST /api/meals/:id/apply-deduction`
          with array of `{ productKey, amountToDeduct }`. Backend
          re-uses `pantry.service.correctQty` per item (writes
          `inventory_log` rows with `reason='correction'`,
          `notes='meal_deduction:<mealId>'`).
   5.7.2. **"Skip trekk"** → close dialog. Meal stays 'cooked'. Pantry
          untouched. Used when leftovers / out-of-pantry ingredients.
   5.7.3. **"Avbryt"** → STOP. Roll back the cook-status. Backend
          handles via `POST /api/meals/:id/mark-eaten?undo=1` or
          equivalent. Meal returns to 'planned'.
5.8. Dialog closes; pantry-view shows decremented qty.

### 6. Restock

6.1. If a deduction brings a tracked item below 15% of total
     (`isLowStock`), `pantry.service.checkAndTriggerLowStock` adds it to
     the active shopping list.
6.2. Shopping screen surfaces the auto-added item with a small
     "Suggested from pantry" badge so user knows it wasn't part of the
     plan-driven list.
6.3. Cycle repeats from step 2.

---

## Domenemodell-påvirkning

### New backend artefacts

- `server/services/pantry-deduction.service.js` — new service. Pure
  module orchestrating recipe → pantry mapping + deduction.
  - `buildSuggestions(repos, mealPlan)` — derives per-ingredient
    suggestion list using `keyForIngredient`, recipe ingredient qty
    scaled by `effectiveScale`, and `repos.inventory.getByKey`.
  - `applyDeduction(repos, mealId, items)` — wraps each item in
    `pantry.service.correctQty` so audit log + low-stock-trigger fire
    naturally.
- `server/routes.js` — three new endpoints:
  - `POST /api/meals/:id/mark-eaten` — set `status='cooked'`, return
    suggestions.
  - `POST /api/meals/:id/apply-deduction` — apply chosen deductions.
  - `POST /api/meals/:id/unmark-eaten` — undo cook-status (cancel
    flow).
- `server/schemas.js` — Zod schemas for new endpoint bodies.

### Modified backend artefacts

- `server/services/pantry.service.js`:
  - Fix `checkAndTriggerLowStock`'s broken `addItem` call (passes single
    object today; repo expects `(listId, opts)` positional). Use
    `notes='auto:low-stock'` as the stable UI marker.
- `server/repositories/shopping.repo.js`: no shape change. `enrichItemForFrontend`
  already exposes `notes` to the client.

### New frontend artefacts

- `client/src/app/components/meals/MarkCookedDialog.tsx` — modal with
  per-ingredient editable rows, "confirm/skip/cancel" actions.
- `client/src/app/meals/usePantryDeduction.ts` — hook wrapping
  apply-deduction call with optimistic-update semantics.

### Modified frontend artefacts

- `client/src/app/meals/mealsApi.ts`:
  - Add `MealStatus` value `'cooked'` (frontend currently has
    `'eaten'` which never matched backend — pre-existing
    inconsistency, fix as part of this PR).
  - Add `markEaten`, `applyDeduction`, `unmarkEaten` API helpers.
  - Add `MarkEatenSuggestion` and `MarkEatenResponse` types.
- `client/src/app/meals/useMealsData.ts`:
  - Add `markCooked(slotId)` action that sequences the dialog flow.
- `client/src/app/components/meals/MealHero.tsx`:
  - Add "Marker tilberedt" button (visible when `recipe !== null` and
    `status === 'planned'`).
  - Hide it for status='cooked' to avoid double-marking.
- `client/src/app/screens/Meals.tsx`:
  - Add dialog state + onMarkCooked handler.
- `client/src/app/i18n/locales/{no,en}/meals.json` — new keys for
  the dialog and the cooked-state label.
- `client/src/app/components/shopping/CategoryGroup.tsx` (or
  ShoppingItem) — render "Suggested from pantry" badge when
  `notes === 'auto:low-stock'`.
- `client/src/app/i18n/locales/{no,en}/shopping.json` — new key for
  the badge label.

### Database

**No migration.** Reuse existing `inventory_log.reason` enum value
`'correction'` for meal-driven deductions per Christer's decision. The
deduction context is preserved in `inventory_log.notes='meal_deduction:<mealId>'`
so audit-history can reconstruct what consumed the qty.

If post-pilot it becomes important to distinguish meal-deduction from
manual correction (for analytics/audit clarity), a follow-up
migration adding `'meal_deduction'` to the reason enum is straightforward
— flagged as `BR-XXX TODO` in `docs/smart-coupling-flow.md`.

---

## Edge-cases (15+, must reach 8 minimum)

1. **Recipe has zero ingredients** — backend returns empty
   suggestions; dialog opens to a "no items to deduct" empty-state and
   only shows Skip + Cancel.
2. **Ingredient missing productKey** — happens when ingredient was
   added free-text. Mark `matched=false` and show greyed row with
   "no pantry link" hint, no checkbox.
3. **Ingredient in recipe but not in pantry** — `matched=false`,
   display "have 0 pantryUnit", row is skipped from deduction by
   default.
4. **Ingredient qty exceeds pantry remaining** — UI clamps default
   to remaining, displays "more than what we have at home" in a meta
   line so user knows.
5. **Multiple ingredients share productKey** (e.g., recipe lists
   "salt" and "havsalt" both → 'salt') — sum the recipe amounts in
   suggestions to avoid double-deduction.
6. **Family scale = 0** (empty roster) — `effectiveScale` returns 1
   per `family.service.js`. Suggestions use unscaled amounts.
7. **Recipe has servings=null** — same as above; scale=1.
8. **Family override-target-servings** — UI scales display, but
   backend uses pure recipe.servings + family roster (no override
   support in pilot). Documented in pending-decisions.
9. **Concurrent mark-cooked from two clients** — second call sees
   status=='cooked' and returns 200 with `alreadyCooked=true` flag,
   suggestions reflect current pantry. UI re-uses dialog as before.
10. **User clicks Cancel after suggestions returned** — call
    `unmark-eaten` to roll status back. If that call fails (network),
    show a toast asking user to manually adjust on Pantry-view.
11. **Pantry deducted to 0** — qty_remaining=0 row stays in DB but is
    hidden by GET /api/pantry's qtyRemaining>0 filter. Already
    correct.
12. **Pantry deducted past 0** — backend `correctQty` validates
    `newQty >= 0` and throws; frontend prevents this via the same
    validation as `UseDialog`.
13. **Low-stock trigger fires on broken addItem call** — pre-existing
    BUG. Currently silently fails. Fix in this PR by aligning the
    `addItem` call with the actual repo signature.
14. **Meal slot with status='away'** — mark-cooked button hidden;
    even if frontend bug surfaces it, backend returns 400
    NO_RECIPE / WRONG_STATUS.
15. **No active shopping list at low-stock-trigger time** —
    `pantry.service.checkAndTriggerLowStock` returns
    `{triggered:false, reason:'no-active-list'}`. UI ignores. No
    crash.
16. **Optional ingredient deselected by user** — counts as
    `unchecked` in the dialog row, included in apply-deduction body
    with `skip:true` so backend ignores; pantry untouched for that
    item.
17. **Pantry productKey doesn't exist in products** (after manual
    quick-add hotfix #87) — display name comes from `products.product_name`
    which is now always populated. `name` field on suggestion uses
    that.
18. **Frontend offline** — fetch fails, dialog shows error state with
    Retry. Cook-status NOT set (we set it server-side AFTER body parse,
    return to client; if request never reaches server, no state change).
19. **Recipe ingredient with qty=0** — skip from deduction. Display
    as "(without quantity)" if name still useful.
20. **Family changes between dialog open and confirm** — suggestions
    were computed at open; UI uses the snapshot, doesn't recompute. If
    user wants fresh values they can cancel + reopen. Acceptable in
    pilot.

---

## Konsekvenser på tvers

| Område | Endring |
|---|---|
| Frontend Meals | MealHero + new dialog, status flow change |
| Frontend Shopping | new "Suggested from pantry" badge |
| Frontend i18n | meals + shopping namespaces extended |
| Backend routes | 3 new POST endpoints under /api/meals |
| Backend services | new pantry-deduction service, fix in pantry service |
| Backend schemas | 3 new Zod bodies |
| Tests backend | unit + integration for new service + endpoints |
| Tests client | MarkCookedDialog + usePantryDeduction + Meals.test |
| Tests E2E | new chain test (full reisen) |
| OpenAPI | 3 new endpoints documented |
| docs/DOMAIN_MODEL | first real entries: BR-001 low-stock-trigger, BR-002 meal-deduction-flow |
| docs/smart-coupling-flow.md | new flow doc |
| README | Sprint 1-6 status block |
| CHANGELOG | Sprint 6 finalization entry |

---

## Beslutninger (med anbefaling)

**BESLUTNING 1:** Two endpoints (mark-eaten + apply-deduction) or one?
- **ANBEFALING:** Two endpoints. Mark-eaten commits cook-status and
  returns suggestions. Apply-deduction is a separate atomic call.
- **HVORFOR:** Cook is a fact ("I cooked this") regardless of pantry
  truth. Pantry-deduction is a separate fact ("I removed these items
  from inventory"). User can mark cooked without deducting (leftovers,
  out-of-pantry meal). Coupling them in one call would force-skip
  semantics on every cook.
- **ALTERNATIVER:**
  - Single endpoint with `deduct: bool` flag — couples concerns.
  - 3-step flow (open dialog → preview → confirm) — overkill for the
    UX, adds latency.
- **KONSEKVENS HVIS ANNERLEDES:** Tighter coupling makes "Skip trekk"
  hard to express semantically.

**BESLUTNING 2:** REUSE `'correction'` reason or add new
`'meal_deduction'`?
- **ANBEFALING:** REUSE `'correction'` per Christer's instruction.
  Discriminate via `notes='meal_deduction:<mealId>'`.
- **HVORFOR:** No migration → lower Portainer-risk, tighter PR scope.
  Audit trail still reconstructable from notes prefix.
- **ALTERNATIVER:**
  - New enum value via migration — clean semantics but pulls in
    DB-schema change.
  - Free-text reason — break the CHECK constraint, breaking pre-deploy.
- **KONSEKVENS HVIS ANNERLEDES:** None functional. Logged in
  AGENT_LOG that we may reconsider post-pilot.

**BESLUTNING 3:** Mark-cooked button visible always, or only for
today / past days?
- **ANBEFALING:** Always visible when `slot.recipe !== null && status
  === 'planned'`.
- **HVORFOR:** Christer's family may cook ahead (Sunday-prep).
  Constraining to today blocks legitimate flow. Cancel/undo handles
  fat-fingered taps.
- **ALTERNATIVER:**
  - Today-only — too restrictive.
  - Future-blocked — confusing UX.
- **KONSEKVENS HVIS ANNERLEDES:** UX gripes within first week of pilot.

**BESLUTNING 4:** Surface "Suggested from pantry" badge on shopping?
- **ANBEFALING:** Yes, simple badge, label key `shopping.badge.fromPantry`
  (no: "Foreslått fra pantry", en: "Suggested from pantry").
- **HVORFOR:** Per OPPGAVE 14.3c. User needs to understand why an
  item appeared without them adding it.
- **ALTERNATIVER:**
  - No badge — user confused by "ghost" items.
  - Tooltip — desktop-only affordance.
- **KONSEKVENS HVIS ANNERLEDES:** UX surprise on auto-added items.

**BESLUTNING 5:** Frontend optimistic update for pantry-deduction?
- **ANBEFALING:** No optimistic update on pantry list itself.
  Apply-deduction returns the updated rows; refetch + redirect to
  pantry-view if user wants to see result.
- **HVORFOR:** Suggestion list is not the same shape as pantry list.
  Optimistic mapping invites bugs. Server response is fast (<100 ms
  typical).
- **ALTERNATIVER:**
  - Optimistic on dialog close — adds complexity for marginal UX win.
- **KONSEKVENS HVIS ANNERLEDES:** Slight delay before pantry refresh,
  acceptable.

**BESLUTNING 6:** Dead code audit scope.
- **ANBEFALING:** Conservative. Run `npx ts-prune` and `npx depcheck`
  for visibility, but only delete items meeting **all three**:
  (a) zero importers in code or tests; (b) not exported from a
  public-facing module barrel; (c) not used by a feature flag.
  Defer the rest to the dedicated cleanup-sprint per
  `docs/workflow/pre-deploy-cleanup-plan.md`.
- **HVORFOR:** Aggressive cleanup risks regressing tests. CLAUDE.md
  DEL 7.7 explicitly defers broad cleanup to its own sprint.
- **KONSEKVENS HVIS ANNERLEDES:** Larger scope, more review surface,
  more chance of regressions.

---

## Portainer-oppstartsrisiko-sjekk

- `Dockerfile` / `.dockerignore`: **nei**
- `docker-compose.yml`: **nei**
- `server/http/bootstrap.js`: **nei**
- `server/config.js`: **nei**
- `server/index.js`: **nei**
- `server/db.js`: **nei**
- `server/migrations/**`: **nei** (no migration this PR)
- `install.sh`: **nei**
- `bootstrap.json`-flyt: **nei**
- Miljøvariabel-krav: **nei**

**Konklusjon:** Ingen Portainer-risiko. Standard `feat/`-flyt per
DEL 5.3 (Christer-godkjenning kreves før merge).

---

## ISO 25010-påvirkning

- **Funksjonell egnethet:** 8.8 → 8.95 (+0.15) — closes the core
  pantry-coupling gap; smart-kobling explicit value-driver.
- **Brukervennlighet:** 8.6 → 8.7 (+0.1) — single dialog completes
  the cook→pantry flow; no separate trip to Pantry-view required.
- **Vedlikeholdbarhet:** 8.3 → 8.35 (+0.05) — DOMAIN_MODEL.md gets
  first real entries; smart-coupling-flow.md captures the cross-feature
  reisen.
- **Pålitelighet:** 8.4 → 8.45 (+0.05) — broken low-stock-trigger
  fixed; new endpoints have unit + integration coverage.
- **Sikkerhet:** ikke berørt — same `requireRole('adult')` middleware
  as existing pantry mutators, no new sensitive surface.
- **Performance:** ikke berørt målbart — bundle delta ~5-7 KB
  gzipped (single dialog + hook). Stays well under 130 KB target.

Snitt: ca 8.55 → 8.62 (+0.07).

---

## Plan (commits)

1. `docs(analysis)` — this document.
2. `feat(server/services)` — new `pantry-deduction.service.js`
   (pure orchestration: `buildSuggestions`, `applyDeduction`).
3. `fix(server/services)` — repair broken `checkAndTriggerLowStock`
   `addItem` invocation. Add `notes='auto:low-stock'` marker.
4. `feat(server)` — three new routes + Zod schemas.
5. `test(server)` — unit + integration for the new service +
   endpoints + low-stock-fix regression.
6. `feat(client/meals)` — `MarkCookedDialog` component, MealHero
   button, mealsApi extensions, useMealsData wiring,
   usePantryDeduction hook.
7. `feat(client/i18n)` — new keys (no + en) for meals + shopping
   namespaces.
8. `feat(client/shopping)` — "Suggested from pantry" badge.
9. `test(client)` — `MarkCookedDialog.test`, `usePantryDeduction.test`,
   `MealHero` updates, `Meals` updates.
10. `test(integration)` — full chain E2E test.
11. `refactor(cleanup)` — conservative dead-code drop based on
    ts-prune + depcheck.
12. `docs(domain)` — first DOMAIN_MODEL entries (BR-001 low-stock,
    BR-002 meal-deduction); `docs/smart-coupling-flow.md`; README
    Sprint 1-6 block; CHANGELOG entry.

Each commit independently green on lint + typecheck + scoped tests.

---

## Kompleksitet-vurdering

**Høy.** ~20-30 files touched, 2-4 days estimated. Christer
explicitly accepted this scope per Mulighet A. Analyse-fase grundig
fordi smart-kobling er kjerneverdi — å innføre brokenness her
påvirker hele pilot-opplevelsen.

Begrunnelse for å holde dette i én PR (ikke splitte):
- All ny kode hører funksjonelt sammen.
- Kombinert E2E-test krever begge sider for å være meningsfull.
- Pre-deploy cleanup er light scope (CLAUDE.md DEL 7.7) og hører
  hjemme her som en del av "Sprint 6 ferdig"-rapporten.
