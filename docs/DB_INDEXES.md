# Database-indekser og query-planer

**Sist oppdatert:** 2026-04-11 (uke 5 av ISO/IEC 25010-planen)

Dette dokumentet inneholder `EXPLAIN QUERY PLAN`-output for alle tyngste
repository-spørringer, hvilke indekser de bruker, og dokumentasjon av
design-valg rundt indexing.

---

## Sammendrag

| Query | Plan | Index | Status |
|---|---|---|---|
| `recipes.getById` | SEARCH | INTEGER PRIMARY KEY | ✅ |
| `recipes.byCategory` | SEARCH | idx_recipes_category | ✅ |
| `recipes.getAll` | SCAN | (full scan OK <1000 rader) | ✅ |
| `mealPlans.getWeek` | SEARCH | idx_meal_plans_week | ✅ |
| `inventory.byKey` | SEARCH | sqlite_autoindex_inventory_1 | ✅ |
| `shoppingLists.active` | SEARCH | idx_shopping_lists_active_per_week | ✅ |
| `products.byKey` | SEARCH | sqlite_autoindex_products_1 | ✅ |
| `choreSchedules.week` | SEARCH | idx_chore_sched_week | ✅ |
| `auditLog.getRecent` | SEARCH | idx_audit_log_timestamp (etter uke 5 fix) | ✅ |
| `auditLog.getByEntity` | SEARCH | idx_audit_log_entity | ✅ |

**Alle read-path-spørringer bruker index. Ingen hot-path gjør full scan
på tabeller >1000 rader.**

---

## Uke 5 PERF-3 funn og fix

### Før fix: `audit_log` bruker SCAN

```sql
SELECT * FROM audit_log ORDER BY id DESC LIMIT 100;
-- plan: SCAN audit_log
```

SQLite planner velger full scan fordi `ORDER BY id DESC` ikke kan ordnes
via den eneste tilgjengelige sortering-indexen (`idx_audit_log_timestamp`).
For en voksende audit-tabell (100+ entries etter noen ukers bruk) er
dette en ytelses-risiko.

### Etter fix: `ORDER BY timestamp DESC, id DESC` bruker index

```sql
SELECT * FROM audit_log ORDER BY timestamp DESC, id DESC LIMIT 100;
-- plan: SEARCH audit_log USING INDEX idx_audit_log_timestamp
```

Bytte av sort-kolonnen til `timestamp DESC, id DESC`:
- Bruker eksisterende `idx_audit_log_timestamp (timestamp DESC)` index
- Fallback på `id DESC` for deterministisk rekkefølge innen samme sekund
- Ingen schema-endring nødvendig (bare query-rewrite)

Samme endring applikert på `auditLog.getByEntity`.

---

## Alle indekser (fra migrations/*.sql)

### products (migration 001)
- `sqlite_autoindex_products_1` — UNIQUE(key) automatisk index

### recipes (migration 001)
- `sqlite_autoindex_recipes_1` — UNIQUE(name) automatisk index
- `idx_recipes_category` — for `WHERE category = ?`
- `idx_recipes_source_type` — for `WHERE source_type = ?` (migration 011)

### meal_plans (migration 001)
- `idx_meal_plans_week` — UNIQUE(week_year, day_of_week)
- `idx_meal_plans_recipe` — for cascade delete

### inventory (migration 001 + 008)
- `sqlite_autoindex_inventory_1` — UNIQUE(product_key)
- `idx_inventory_updated_at` — for `ORDER BY updated_at DESC`

### chore_schedules (migration 001)
- `idx_chore_sched_week` — for `WHERE week_year = ?`

### shopping_lists (migration 007)
- `idx_shopping_lists_active_per_week` — partial index WHERE status='active'

### shopping_items (migration 007)
- `idx_shopping_items_list_id` — for `WHERE list_id = ?`

### consumables (migration 004)
- `idx_consumables_category` — for grouping

### llm_cache (migration 003)
- `idx_llm_cache_hash` — UNIQUE(cache_key)
- `idx_llm_cache_created_at` — for TTL-cleanup

### receipts (migration 005)
- `idx_receipts_created_at` — for `ORDER BY created_at DESC`

### product_resolutions (migration 006)
- `idx_product_resolutions_product_id` — for join
- `idx_product_resolutions_source` — for cache-lookup

### family_profile (migration 009)
- Enkel row — ingen separate indekser nødvendig

### filter_usage (migration 010)
- `idx_filter_usage_created_at` — for aggregering

### recipe_sources (migration 011)
- `sqlite_autoindex_recipe_sources_1` — UNIQUE(url)

### audit_log (migration 012)
- `idx_audit_log_timestamp` — for `ORDER BY timestamp DESC`
- `idx_audit_log_entity` — for `WHERE entity_type = ?`
- `idx_audit_log_action` — for aggregering

---

## Utvikleroppgave: legge til ny index

1. Ny migration `server/migrations/NNN_description.sql`:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_tabell_kolonne ON tabell(kolonne);
   ```
2. Kjør `EXPLAIN QUERY PLAN` for å verifisere at ny spørring bruker indexen
3. Kjør `npm run test:coverage:gate` — tester skal fortsatt passere
4. Kjør `perf-baseline.json`-oppdatering hvis ytelsen endrer seg
5. Legg til en linje i tabellen over i dette dokumentet

---

## Referanser

- SQLite query planner: https://www.sqlite.org/queryplanner.html
- EXPLAIN QUERY PLAN: https://www.sqlite.org/eqp.html
- better-sqlite3 docs: https://github.com/WiseLibs/better-sqlite3

---

## Note om `perf-baseline.json`

`perf-baseline.json` er **lokalt målt** (Windows dev-maskin) med p95=1.5ms.
GitHub Actions ubuntu-runner gir typisk p95=1.8ms (ca. +20% offset).
`.github/workflows/performance.yml` bruker derfor `--allowRegressionPct=50`
for å ta høyde for runner-variasjon uten å maskere reelle regresjoner.

**Forbedring (uke 6):** Regenerer baseline i GitHub Actions slik at
baselinen og CI-miljøet samsvarer. Da kan `allowRegressionPct` senkes til 20.
Kommando (etter manuell godkjenning):

```bash
# I en ubuntu CI-jobb:
NODE_ENV=development RATE_LIMIT_MAX=999999 LOG_LEVEL=warn node server/index.js &
sleep 4
node scripts/load-baseline.js --concurrency=5 --duration=15 --warmupMs=1500 \
  --output=perf-baseline.json
# Committ endring og push
```

SLO-terskelen (p95 < 200ms) er hovedbeskytteren — regression-gaten er
et "tidlig-varsel"-signal, ikke det siste ordet.
