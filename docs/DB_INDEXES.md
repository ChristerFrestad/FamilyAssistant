# Database indexes and query plans

**Last updated:** 2026-04-11 (week 5 of the ISO/IEC 25010 plan)

This document contains `EXPLAIN QUERY PLAN` output for all the heaviest
repository queries, which indexes they use, and documentation of
design choices around indexing.

---

## Summary

| Query | Plan | Index | Status |
|---|---|---|---|
| `recipes.getById` | SEARCH | INTEGER PRIMARY KEY | OK |
| `recipes.byCategory` | SEARCH | idx_recipes_category | OK |
| `recipes.getAll` | SCAN | (full scan OK <1000 rows) | OK |
| `mealPlans.getWeek` | SEARCH | idx_meal_plans_week | OK |
| `inventory.byKey` | SEARCH | sqlite_autoindex_inventory_1 | OK |
| `shoppingLists.active` | SEARCH | idx_shopping_lists_active_per_week | OK |
| `products.byKey` | SEARCH | sqlite_autoindex_products_1 | OK |
| `choreSchedules.week` | SEARCH | idx_chore_sched_week | OK |
| `auditLog.getRecent` | SEARCH | idx_audit_log_timestamp (after week 5 fix) | OK |
| `auditLog.getByEntity` | SEARCH | idx_audit_log_entity | OK |

**All read-path queries use an index. No hot-path query does a full scan
on tables larger than 1000 rows.**

---

## Week 5 PERF-3 findings and fix

### Before fix: `audit_log` uses SCAN

```sql
SELECT * FROM audit_log ORDER BY id DESC LIMIT 100;
-- plan: SCAN audit_log
```

The SQLite planner chooses a full scan because `ORDER BY id DESC` cannot be
ordered through the only available sort index (`idx_audit_log_timestamp`).
For a growing audit table (100+ entries after a few weeks of use), this
is a performance risk.

### After fix: `ORDER BY timestamp DESC, id DESC` uses index

```sql
SELECT * FROM audit_log ORDER BY timestamp DESC, id DESC LIMIT 100;
-- plan: SEARCH audit_log USING INDEX idx_audit_log_timestamp
```

Switching the sort column to `timestamp DESC, id DESC`:
- Uses the existing `idx_audit_log_timestamp (timestamp DESC)` index
- Falls back to `id DESC` for deterministic ordering within the same second
- No schema change required (only a query rewrite)

The same change was applied to `auditLog.getByEntity`.

---

## All indexes (from migrations/*.sql)

### products (migration 001)
- `sqlite_autoindex_products_1` — UNIQUE(key) automatic index

### recipes (migration 001)
- `sqlite_autoindex_recipes_1` — UNIQUE(name) automatic index
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
- `idx_llm_cache_created_at` — for TTL cleanup

### receipts (migration 005)
- `idx_receipts_created_at` — for `ORDER BY created_at DESC`

### product_resolutions (migration 006)
- `idx_product_resolutions_product_id` — for join
- `idx_product_resolutions_source` — for cache lookup

### family_profile (migration 009)
- Single row — no separate indexes required

### filter_usage (migration 010)
- `idx_filter_usage_created_at` — for aggregation

### recipe_sources (migration 011)
- `sqlite_autoindex_recipe_sources_1` — UNIQUE(url)

### audit_log (migration 012)
- `idx_audit_log_timestamp` — for `ORDER BY timestamp DESC`
- `idx_audit_log_entity` — for `WHERE entity_type = ?`
- `idx_audit_log_action` — for aggregation

---

## Developer task: adding a new index

1. New migration `server/migrations/NNN_description.sql`:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_tabell_kolonne ON tabell(kolonne);
   ```
2. Run `EXPLAIN QUERY PLAN` to verify that the new query uses the index
3. Run `npm run test:coverage:gate` — tests must still pass
4. Update `perf-baseline.json` if performance changes
5. Add a line to the table above in this document

---

## References

- SQLite query planner: https://www.sqlite.org/queryplanner.html
- EXPLAIN QUERY PLAN: https://www.sqlite.org/eqp.html
- better-sqlite3 docs: https://github.com/WiseLibs/better-sqlite3

---

## Note on `perf-baseline.json`

`perf-baseline.json` is **measured locally** (Windows dev machine) at p95=1.5ms.
The GitHub Actions ubuntu runner typically yields p95=1.8ms (about +20% offset).
`.github/workflows/performance.yml` therefore uses `--allowRegressionPct=50`
to account for runner variance without masking real regressions.

**Improvement (week 6):** Regenerate the baseline in GitHub Actions so that
the baseline and the CI environment match. Then `allowRegressionPct` can be lowered to 20.
Command (after manual approval):

```bash
# In an ubuntu CI job:
NODE_ENV=development RATE_LIMIT_MAX=999999 LOG_LEVEL=warn node server/index.js &
sleep 4
node scripts/load-baseline.js --concurrency=5 --duration=15 --warmupMs=1500 \
  --output=perf-baseline.json
# Commit the change and push
```

The SLO threshold (p95 < 200ms) is the main protection — the regression gate is
an "early warning" signal, not the final word.
