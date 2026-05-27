# Smart-coupling flow — Pantry · Meals · Shopping list

> Sprint 6 (2026-05-02). Documents the full journey that binds
> pantry, meal plan, and shopping list together. Every user action
> that pulls from or adds to inventory goes through the same three layers
> (route → service → repo) and lands in `inventory_log` with a
> `reason` that makes later audit possible.

---

## The journey end to end

```
┌───────────────┐  generate   ┌──────────────────┐  bought   ┌──────────────┐
│  Meal plan    │────────────▶│  Shopping list   │──────────▶│  Pantry       │
│  (planned)    │             │  (meal_ingredient)│           │  (inventory)  │
└──────┬────────┘             └──────────────────┘           └──────┬───────┘
       │ mark cooked                                                │
       ▼                                                            │
┌───────────────┐  apply      ┌──────────────────┐                  │
│  Meal plan    │────────────▶│  inventory_log   │                  │
│  (cooked)     │ deduction   │  (correction +   │                  │
│               │             │   meal_deduction)│                  │
└───────────────┘             └─────────┬────────┘                  │
                                        │ low-stock trigger         │
                                        ▼                           │
                              ┌──────────────────┐                  │
                              │  Shopping list   │◀─────────────────┘
                              │  (auto:low-stock)│
                              └──────────────────┘
```

Each step is one HTTP endpoint + one service function. The backend is
the source of truth; the UI is a pure projection.

## Endpoints (backend)

| Step | Method | Path | Service | Inventory_log reason |
|---|---|---|---|---|
| Generate from meals | `POST` | `/api/shopping/generate` | `shopping-list.service.computeShoppingListForWeek` | (n/a — pre-pantry) |
| Manual quick-add | `POST` | `/api/shopping/items` | `pantry-resolver.resolveOrCreate` | (n/a) |
| Mark bought | `PUT` | `/api/shopping/items/:id/bought` | `inventory.addPurchase` | `shopping_bought` |
| **Mark cooked** | `POST` | `/api/meals/:id/mark-eaten` | `pantry-deduction.buildSuggestions` | (n/a — read-only) |
| **Apply deduction** | `POST` | `/api/meals/:id/apply-deduction` | `pantry-deduction.applyDeduction` → `pantry.correctQty` per item | `correction` (with `notes='meal_deduction:<mealId>'`) |
| **Unmark cooked** | `POST` | `/api/meals/:id/unmark-eaten` | `mealPlans.setStatusById` | (n/a) |
| Manual pantry edit | `PUT` | `/api/pantry/correct` | `pantry.correctQty` | `correction` |
| Auto-restock (internal) | (called from `pantry.correctQty`) | — | `pantry.checkAndTriggerLowStock` | (writes `shopping_list_items.notes='auto:low-stock'`) |

## Frontend flow

1. **Meals screen** — `MealHero` shows a "Mark as cooked" button when
   slot.recipe is set and status is `'planned'`. When the button is pressed
   the [MarkCookedDialog](../client/src/app/components/meals/MarkCookedDialog.tsx) opens.
2. **MarkCookedDialog** calls `markMealEaten(mealId)` (sets status =
   `'cooked'`, returns suggestions). Per ingredient the dialog shows:
   - name + suggested deduction amount (recipe × portion factor, clamped
     to pantry remaining)
   - how much we have at home
   - skip checkbox + editable input field
3. Three terminal actions:
   - **Confirm** → `applyMealDeduction(mealId, items)`. The confirmed
     deduction lands as one `correction` row per ingredient in
     `inventory_log` with `notes='meal_deduction:<mealId>'`.
     Auto-restock runs naturally as part of `correctQty`.
   - **Skip** → closes the dialog. The meal stays `'cooked'`. Pantry
     unchanged.
   - **Cancel** → `unmarkMealEaten(mealId)` rolls the status back to
     `'planned'`.
4. **Shopping screen** — `ShoppingItemRow` shows a "Suggested from
   pantry" badge when `item.notes === 'auto:low-stock'`. The user
   then understands why an item appeared without them adding it
   themselves.

## Business rules (backfilled to DOMAIN_MODEL.md)

- **BR-001 Low-stock trigger**: `pantry.correctQty` calls
  `checkAndTriggerLowStock` after each mutation. If `qty / total <
  0.15` and the item is not present as an unbought row on the active
  shopping list, a new row is added with `source_type='manual'`,
  `notes='auto:low-stock'`. Bought rows from previous weeks
  do not block the trigger — historical state should not prevent
  pantry low-stock from auto-restocking.
- **BR-002 Meal-deduction reason**: deductions from
  the mark-cooked flow reuse the enum value `'correction'` in
  `inventory_log.reason`. The context is preserved in `notes` with the prefix
  `meal_deduction:<mealId>` so the audit log can reconstruct
  what actually consumed the inventory. If we later need a
  dedicated enum value (analytics, reporting), it is a separate
  migration that only adds a new enum value to the CHECK constraint.

## Pantry mapping (recipe → pantry)

`pantry-deduction.buildSuggestions` matches each recipe ingredient against
inventory via the `keyForIngredient` helper in
`pantry-coverage.service.js`. The rule is simple:

- `keyForIngredient(ing) = ing.productKey || ing.name.toLowerCase()`
- If multiple ingredients resolve to the same key (e.g. `salt` +
  `havsalt`), the recipe amounts are summed before the suggestion is built — so
  the user doesn't see two identical rows.
- The suggestion amount is clamped to pantry remaining so the UI never
  defaults to suggesting more than what is actually at home.

## Why reuse of `'correction'` (B2 in the analysis)

`inventory_log.reason` is a CHECK constraint enum. Adding
`'meal_deduction'` would require a migration that drops and
recreates the constraint, which triggers
the PORTAINER-RISK procedure. For the pilot we instead choose to:

1. Use the existing `'correction'`
2. Stamp `notes='meal_deduction:<mealId>'` so each row is
   machine-readable for audit reports
3. Document here that a post-pilot migration can clean this up if
   analytics starts distinguishing on sources

## Edge cases

| Scenario | Backend response |
|---|---|
| Slot without recipe → mark-eaten | `400 NO_RECIPE` |
| Slot with status `'away'`, `'skipped'`, or `'removed'` | `400 WRONG_STATUS` |
| Mark-eaten a second time | `200 alreadyCooked: true` |
| Apply-deduction when status ≠ `'cooked'` | `400 NOT_COOKED` |
| Apply-deduction with empty items list | `200 applied: []` |
| amountToDeduct > pantry remaining | clamped to `min(amount, remaining)` on the backend |
| Missing productKey in deduction | skips the row, returns it in the `skipped` list |
| Cancel after mark-eaten | `unmark-eaten` rolls the status back; pantry unchanged |
| Cancel when unmark fails | the dialog closes regardless; the backend is the source of truth on the next fetch |

## Tests

- `tests/sprint-6-meal-deduction.test.js` — endpoint + service unit + integration (18 tests)
- `tests/sprint-6-smart-coupling-chain.test.js` — full chain (1 comprehensive test)
- `client/src/app/components/meals/MarkCookedDialog.test.tsx` — UI presentation (10 tests)
- `client/src/app/meals/usePantryDeduction.test.tsx` — hook state machine (7 tests)
- `tests/fase-f2-units-pantry.test.js` — existing pre-Sprint-6 tests for low-stock; still passes after we tightened the "already-on-list" check

## Manual verification

See the PR description for a step-by-step test (plan → buy → cook → deduct
→ verify shopping row reappears). Quick sanity check:

```bash
curl -X POST http://localhost:7777/api/meals/<id>/mark-eaten -d '{}'
# → returns { mealId, recipeId, alreadyCooked, suggestions: [...] }

curl -X POST http://localhost:7777/api/meals/<id>/apply-deduction \
     -H 'Content-Type: application/json' \
     -d '{"items":[{"productKey":"butter","amountToDeduct":50}]}'
# → returns { ok, mealId, applied, skipped, lowStockTriggered }
```
