# Smart-coupling flow — Pantry · Måltider · Handleliste

> Sprint 6 (2026-05-02). Dokumenterer den fulle reisen som binder
> pantry, måltidsplan og handleliste sammen. Hver brukerhandling som
> trekker eller tilfører inventory går gjennom de samme tre lagene
> (route → service → repo) og lander i `inventory_log` med en
> `reason` som gjør senere audit mulig.

---

## Reisen ende til ende

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

Hvert steg er ett HTTP-endepunkt + én service-funksjon. Backend er
sannheten; UI er en ren projeksjon.

## Endepunkter (backend)

| Steg | Method | Path | Service | Inventory_log reason |
|---|---|---|---|---|
| Generate from meals | `POST` | `/api/shopping/generate` | `shopping-list.service.computeShoppingListForWeek` | (n/a — pre-pantry) |
| Manual quick-add | `POST` | `/api/shopping/items` | `pantry-resolver.resolveOrCreate` | (n/a) |
| Mark bought | `PUT` | `/api/shopping/items/:id/bought` | `inventory.addPurchase` | `shopping_bought` |
| **Mark cooked** | `POST` | `/api/meals/:id/mark-eaten` | `pantry-deduction.buildSuggestions` | (n/a — read-only) |
| **Apply deduction** | `POST` | `/api/meals/:id/apply-deduction` | `pantry-deduction.applyDeduction` → `pantry.correctQty` per item | `correction` (with `notes='meal_deduction:<mealId>'`) |
| **Unmark cooked** | `POST` | `/api/meals/:id/unmark-eaten` | `mealPlans.setStatusById` | (n/a) |
| Manual pantry edit | `PUT` | `/api/pantry/correct` | `pantry.correctQty` | `correction` |
| Auto-restock (internal) | (called from `pantry.correctQty`) | — | `pantry.checkAndTriggerLowStock` | (writes `shopping_list_items.notes='auto:low-stock'`) |

## Frontend-flyt

1. **Meals screen** — `MealHero` viser "Marker tilberedt"-knapp når
   slot.recipe er satt og status er `'planned'`. Når knappen trykkes
   åpner [MarkCookedDialog](../client/src/app/components/meals/MarkCookedDialog.tsx).
2. **MarkCookedDialog** kaller `markMealEaten(mealId)` (set status =
   `'cooked'`, return suggestions). Per ingrediens viser dialogen:
   - navn + foreslått trekk-mengde (recipe × portion factor, klampet
     til pantry remaining)
   - hvor mye vi har hjemme
   - skip-checkbox + redigerbart input-felt
3. Tre terminale handlinger:
   - **Confirm** → `applyMealDeduction(mealId, items)`. Bekreftet
     trekk lander som én `correction`-rad per ingrediens i
     `inventory_log` med `notes='meal_deduction:<mealId>'`.
     Auto-restock kjører naturlig som del av `correctQty`.
   - **Skip** → lukker dialog. Måltid forblir `'cooked'`. Pantry
     uendret.
   - **Cancel** → `unmarkMealEaten(mealId)` ruller status tilbake til
     `'planned'`.
4. **Shopping screen** — `ShoppingItemRow` viser et "Foreslått fra
   pantry"-badge når `item.notes === 'auto:low-stock'`. Brukeren
   forstår dermed hvorfor en vare dukket opp uten at de la den til
   selv.

## Forretningsregler (backfilled to DOMAIN_MODEL.md)

- **BR-001 Low-stock trigger**: `pantry.correctQty` kaller
  `checkAndTriggerLowStock` etter hver mutasjon. Hvis `qty / total <
  0.15` og varen ikke står som unbought rad på den aktive
  handlelisten, legges en ny rad til med `source_type='manual'`,
  `notes='auto:low-stock'`. Bought rader fra tidligere uker
  blokkerer ikke trigger — historisk tilstand skal ikke hindre at
  pantry-lavt-stock auto-restocker.
- **BR-002 Meal-deduction reason**: deductions fra
  mark-cooked-flyten gjenbruker enum-verdien `'correction'` i
  `inventory_log.reason`. Konteksten bevares i `notes` med prefiks
  `meal_deduction:<mealId>` slik at audit-loggen kan rekonstruere
  hva som faktisk forbrukte beholdningen. Om vi senere trenger en
  egen enum-verdi (analytics, rapportering), er det en separat
  migration som bare legger en ny enum-verdi til CHECK-constraint.

## Pantry-mapping (recipe → pantry)

`pantry-deduction.buildSuggestions` matcher hver recipe-ingrediens mot
inventory via `keyForIngredient`-helperen i
`pantry-coverage.service.js`. Regelen er enkel:

- `keyForIngredient(ing) = ing.productKey || ing.name.toLowerCase()`
- Hvis flere ingredienser løser til samme key (f.eks. `salt` +
  `havsalt`), summeres recipe-mengdene før suggestion bygges — slik
  at brukeren ikke ser to like rader.
- Suggestion-mengde klampet til pantry-remaining slik at UI aldri
  default-foreslår mer enn det som faktisk finnes hjemme.

## Hvorfor reuse av `'correction'` (B2 i analyse)

`inventory_log.reason` er en CHECK-constraint enum. Å legge til
`'meal_deduction'` ville kreve en migration som dropper og
gjenoppretter constraint, hvilket utløser
PORTAINER-RISIKO-prosedyren. For pilot velger vi i stedet å:

1. Bruke eksisterende `'correction'`
2. Stamp `notes='meal_deduction:<mealId>'` slik at hver rad er
   maskinleselig for audit-rapporter
3. Dokumentere her at en post-pilot migration kan rydde dette hvis
   analytics begynner å skille på sources

## Edge-cases

| Scenario | Backend-respons |
|---|---|
| Slot uten recipe → mark-eaten | `400 NO_RECIPE` |
| Slot med status `'away'`, `'skipped'` eller `'removed'` | `400 WRONG_STATUS` |
| Mark-eaten andre gang | `200 alreadyCooked: true` |
| Apply-deduction når status ≠ `'cooked'` | `400 NOT_COOKED` |
| Apply-deduction med tom items-liste | `200 applied: []` |
| amountToDeduct > pantry remaining | klampet til `min(amount, remaining)` på backend |
| Manglende productKey i deduction | hopper over rad, returnerer i `skipped`-listen |
| Cancel etter mark-eaten | `unmark-eaten` ruller status tilbake; pantry uendret |
| Cancel når unmark feiler | dialogen lukker uansett; backend er sannheten ved neste fetch |

## Tester

- `tests/sprint-6-meal-deduction.test.js` — endpoint + service unit + integration (18 tester)
- `tests/sprint-6-smart-coupling-chain.test.js` — full chain (1 omfattende test)
- `client/src/app/components/meals/MarkCookedDialog.test.tsx` — UI presentation (10 tester)
- `client/src/app/meals/usePantryDeduction.test.tsx` — hook state machine (7 tester)
- `tests/fase-f2-units-pantry.test.js` — eksisterende pre-Sprint-6 tester for low-stock; fortsetter å passere etter at vi tightnet "already-on-list"-sjekken

## Manuell verifikasjon

Se PR-beskrivelse for trinn-for-trinn-test (plan → buy → cook → deduct
→ verify shopping-rad gjenkommer). Rask sanity-sjekk:

```bash
curl -X POST http://localhost:7777/api/meals/<id>/mark-eaten -d '{}'
# → returnerer { mealId, recipeId, alreadyCooked, suggestions: [...] }

curl -X POST http://localhost:7777/api/meals/<id>/apply-deduction \
     -H 'Content-Type: application/json' \
     -d '{"items":[{"productKey":"butter","amountToDeduct":50}]}'
# → returnerer { ok, mealId, applied, skipped, lowStockTriggered }
```
