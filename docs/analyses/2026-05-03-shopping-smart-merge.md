# Shopping list smart-merge auto-generation + manual regenerate CTA

**Date:** 2026-05-03
**Branch:** `feat/shopping-smart-merge`
**Pilot blocker:** Christer planned dinners via the picker, but ingredients
never appeared on the shopping list. Diagnosis confirmed the auto-trigger
in `routes.js:71-86` (`maybeAutogenerateShoppingList`) bails when an active
list already exists — even when the list is stale relative to the current
meal plan.

## Reisen

1. Christer logs in (family_id=3).
2. Christer goes to **Måltider** and clicks "Planlegg middag" for each day
   of the week.
   2.1. Picker opens with category-filtered recipes.
   2.2. Christer picks one for each day.
   2.3. Each pick fires `PUT /api/meals/swap`.
3. Per swap, the backend:
   3.1. Persists the slot via `repos.mealPlans.setRecipe`.
   3.2. Invalidates `meals`, `today`, `shopping` cache tags.
   3.3. Calls `maybeAutogenerateShoppingList(repos, weekYear)`.
        3.3.1. Checks `isWeekComplete(weekYear)` → true after the 7th pick.
        3.3.2. Checks `getActive(weekYear) !== null` → **true**, because
               an old shopping_lists row from 2026-04-30 still exists.
        3.3.3. **Returns null.** No shopping items are added.
4. Christer navigates to **Shopping**.
   4.1. The list shows the old manual items only (5 already-bought rows).
   4.2. EmptyState `no-list` is not rendered (list is non-empty).
   4.3. EmptyState `no-items` is not rendered (list has items).
   4.4. **No "Generer fra ukens middager" CTA is anywhere on the screen.**
5. Christer is stuck — there is no way to regenerate the list from the new
   meal plan via the UI.

## Domenemodell-påvirkning

No new entities. Existing entities involved:

- `server/services/shopping-list.service.js` — extend `generateForWeek` to
  support a merge-mode that preserves bought + manual items
- `server/routes.js` — `maybeAutogenerateShoppingList` calls merge-mode;
  `POST /api/shopping/generate` accepts the same mode
- `server/repositories/shopping.repo.js` — may need a helper to enumerate
  preserved items from an existing active list (read-only)
- `client/src/app/screens/Shopping.tsx` — add a regenerate CTA (always
  visible when an active list exists)
- New component `client/src/app/components/shopping/RegenerateDialog.tsx`
- `client/src/app/i18n/locales/{no,en}/shopping.json` — new keys
- `docs/DOMAIN_MODEL.md` — add BR-003 (smart-merge preservation contract)

## Edge-cases

1. **No existing active list.** Merge-mode reduces to a fresh generate —
   same outcome as `mode: 'replace'` (today's behavior).
2. **Existing list with only bought items.** Bought items preserved; new
   meal-ingredients added. Total count grows.
3. **Existing list with only unbought meal-ingredient items.** All
   meal-ingredient items get replaced by the freshly computed ones; bought
   items (none) stay. Net effect: list reflects current meal plan.
4. **Existing list with manual items mixed in.** Manual items (sourceType
   `manual` or `extra`) preserved regardless of bought-status; new
   meal-ingredients computed.
5. **Same ingredient appears in multiple meals.** Aggregate qty across
   meals (existing behavior of `computeShoppingListForWeek` already does
   this).
6. **Ingredient appears in old list AND new meal plan.** Two cases:
   - **Bought already:** keep the bought row, do NOT add a duplicate
     unbought row. Christer doesn't want to be told he needs to buy mel
     when he already bought mel.
   - **Not bought yet:** new computation wins (qty may have changed if
     a recipe was added/swapped).
7. **Auto-trigger fires repeatedly during multi-day picker session.**
   First swap may not yield a complete week → no-op. Final swap
   triggers merge. Idempotent — running merge twice in a row produces
   the same final state.
8. **User has tons of manual items, then regenerates.** All manual items
   preserved. New meal-ingredients added. List grows but nothing is
   lost.
9. **Frozen DB-content in CI.** Merge-mode with empty meal-plan (no
   recipes) produces the same list as before. No regression on the
   existing fresh-week test path.
10. **Race: two browser tabs swap meals simultaneously.** Both invoke
    auto-trigger. SQLite serializes via the transaction in
    `createActive`. The second one sees the first's result and merges
    on top. Final list is consistent.

## Konsekvenser på tvers

- **Frontend:** new `RegenerateDialog` component + button in
  `ShoppingHeader`. Existing `EmptyState` "no-list" CTA stays as-is —
  the new always-visible CTA covers the gap. Existing tests for
  `EmptyState` continue to pass.
- **API:** `POST /api/shopping/generate` accepts `{ weekYear?, mode?,
  force? }`. `mode='merge'` is the new default; `mode='replace'`
  preserves the previous force-replace behavior. `force` semantics
  remain (allow even when week is incomplete).
- **DB-migrasjoner:** none needed. Smart-merge operates entirely on
  existing `shopping_list_items`.
- **OpenAPI:** update `openapi.yaml` if it documents the generate
  endpoint body.
- **Tester:** new backend integration suite + frontend dialog tests.

## Beslutninger

### BESLUTNING 1: API shape for the new mode

**ANBEFALING:** Add a `mode: 'merge' | 'replace'` field to the
generate-body schema, defaulting to `'merge'`. Backwards-compatible
because the previous body only had `{ weekYear, force }` — adding an
optional field does not break existing clients.

**HVORFOR:** A boolean flag like `preserveBought` would mix concerns.
A named mode lets us add a third mode later (e.g., `'preview'`)
without API churn.

**ALTERNATIVER:**
- New field `preserveBought: boolean` — too granular; doesn't extend.
- Separate endpoint `/api/shopping/regenerate` — duplicates routing
  logic for marginal benefit.

**KONSEKVENS HVIS ANNERLEDES:** Future modes need new flags; API
surface grows organically, harder to test combinations.

### BESLUTNING 2: Default mode for auto-trigger

**ANBEFALING:** Auto-trigger calls merge-mode (preserves bought +
manual). A user who has built up shopping state should never see it
wiped by the system without consent.

**HVORFOR:** Replace-mode is destructive and requires explicit user
intent. The user typing "regenerate" via the new CTA gets a
confirmation dialog; the system silently calling generate has no
such handshake.

**ALTERNATIVER:**
- Auto-trigger uses replace — too aggressive, may delete bought items.
- Auto-trigger only fires on first complete-week event — we already
  have that gate; it's what's failing now.

**KONSEKVENS HVIS ANNERLEDES:** Users lose bought-state when system
auto-regenerates. Pilot blocker just becomes a different blocker.

### BESLUTNING 3: Should the CTA confirmation dialog be skipped when no list exists?

**ANBEFALING:** Skip the dialog when `hasActiveList === false` — the
EmptyState CTA is the existing "fresh start" path and doesn't need
confirmation. Show the dialog only when an active list exists, since
that's the case where merge could have visible effects (preserved
items, possibly different qty).

**HVORFOR:** Keeps the empty-list flow snappy. Adds friction only
when friction is informative.

**ALTERNATIVER:**
- Always show dialog — adds friction for first-time users.
- Never show dialog — risks confusion when the user clicks
  "Regenerate" on a partly-bought list and sees their bought-state
  preserved without explanation.

**KONSEKVENS HVIS ANNERLEDES:** First-time users see an unnecessary
dialog, OR existing-list users have no warning about merge effects.

## Portainer-oppstartsrisiko-sjekk

| Område | Berørt? |
|---|---|
| `Dockerfile` / `.dockerignore` | Nei |
| `docker-compose.yml` | Nei |
| `server/http/bootstrap.js` | Nei |
| `server/config.js` | Nei |
| `server/index.js` | Nei |
| `server/db.js` | Nei |
| `server/migrations/**` | Nei |
| `install.sh` | Nei |
| Bootstrap-handling | Nei |
| Env-vars | Nei |

**Nei.** Pure feature change in shopping service + frontend. No startup
path touched.

## ISO 25010-påvirkning

- **Funksjonell egnethet 8.5 → 8.7 (+0.2):** the meals → shopping value
  chain works automatically; the manual escape hatch is also
  available. Both halves of the user-visible flow that the pilot
  needs.
- **Pålitelighet 8.7 → 8.8 (+0.1):** smart-merge prevents data loss
  when the system auto-regenerates. Idempotent re-runs converge to
  the same state.
- **Vedlikeholdbarhet 8.4 → 8.4:** small additions to a well-bounded
  service module. No churn elsewhere.
- **Sikkerhet 8.2 → 8.2:** unchanged.

## Plan

1. **`feat(backend)`** — extend `generateForWeek` with `mode` parameter
   and the merge logic.
2. **`feat(backend)`** — `maybeAutogenerateShoppingList` calls merge-mode
   (drop the `getActive() !== null` early-return).
3. **`feat(backend)`** — update `POST /api/shopping/generate` body schema
   to accept `mode`; default to `'merge'`.
4. **`test(backend)`** — new `tests/shopping-smart-merge.test.js`.
5. **`feat(frontend)`** — `RegenerateDialog` component.
6. **`feat(frontend)`** — `ShoppingHeader` gets a regenerate button (or
   inline CTA above the list).
7. **`feat(i18n)`** — keys for both languages.
8. **`test(frontend)`** — dialog + button tests.
9. **`docs`** — `docs/DOMAIN_MODEL.md` BR-003; `docs/post-pilot-roadmap.md`.
10. **`chore`** — CHANGELOG entry.

## Kompleksitets-vurdering

Christer flagged this as a pilot blocker and chose the full-scope option
(C+B+tests). The smart-merge logic is the largest piece — it's a
state-machine over (existing item state × computed item state) that
needs deliberate edge-case handling. Full analysis (this document) is
warranted.
