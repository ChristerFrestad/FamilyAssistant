# FamilyAssistant — Runbook

**Last updated:** 2026-04-10
**Audience:** Operator. This document is for troubleshooting and
day-to-day operation of FamilyAssistant on Raspberry Pi 5.

> **Paths:** `$APP_ROOT` = install path (default: `$APP_ROOT`)

> For first-time installation, see [DEPLOY.md](./DEPLOY.md).

---

## 1. Daily Commands

| What | Command |
|---|---|
| Check status | `sudo systemctl status familieassistenten` |
| Start | `sudo systemctl start familieassistenten` |
| Stop | `sudo systemctl stop familieassistenten` |
| Restart | `sudo systemctl restart familieassistenten` |
| Follow logs | `journalctl -u familieassistenten -f` |
| Last 200 lines | `journalctl -u familieassistenten -n 200 --no-pager` |
| Errors only | `journalctl -u familieassistenten -p err -n 100 --no-pager` |
| Show current environment | `systemctl show familieassistenten --property=Environment` |

### Health Checks

```bash
# Local health check
curl -s http://localhost:7777/health | jq
# { "status": "ok", "uptimeSec": 1234, "pid": 567, "memMB": 128 }

# Ready check (shows DB driver + KB size)
curl -s http://localhost:7777/ready | jq

# Full status (version, breakers, migrations)
curl -s http://localhost:7777/api/status | jq

# Behind Caddy with AUTH_TOKEN
curl -s -H "Authorization: Bearer $AUTH_TOKEN" https://familieassistenten.local/api/status | jq
```

---

## 2. Backup + Restore

### 2.1 Backup Locations

- **Local:** `$APP_ROOT/data/backups/familieassistenten-YYYY-MM-DD.db`
- **Off-site:** depends on `BACKUP_REMOTE_PATH` in service env (NAS mount, SSH host, rsync daemon)
- **Schedule:** daily at 03:00, retains 14 days
- **On shutdown:** a final backup is taken automatically before the DB closes

### 2.2 Take a Manual Backup

```bash
# Simplest — calls the same backupNow() as cron
sudo systemctl stop familieassistenten
cp $APP_ROOT/data/familieassistenten.db \
   $APP_ROOT/data/backups/manual-$(date +%F).db
sudo systemctl start familieassistenten
```

Or via a SQL console against the live DB (safe on better-sqlite3):

```bash
sqlite3 $APP_ROOT/data/familieassistenten.db \
  "VACUUM INTO '$APP_ROOT/data/backups/manual-$(date +%F).db'"
```

### 2.3 Restore From Backup

```bash
# 1. Stop the server
sudo systemctl stop familieassistenten

# 2. Make a safety copy of the current DB (before you overwrite)
cp $APP_ROOT/data/familieassistenten.db \
   $APP_ROOT/data/familieassistenten.db.pre-restore

# 3. Copy the backup in
cp $APP_ROOT/data/backups/familieassistenten-YYYY-MM-DD.db \
   $APP_ROOT/data/familieassistenten.db
chown pi:pi $APP_ROOT/data/familieassistenten.db

# 4. Start the server
sudo systemctl start familieassistenten

# 5. Verify
curl -s http://localhost:7777/ready | jq
journalctl -u familieassistenten -n 20 --no-pager | grep -i 'migration\|ready\|error'
```

**If restore fails:** move the safety copy back:
```bash
mv $APP_ROOT/data/familieassistenten.db.pre-restore \
   $APP_ROOT/data/familieassistenten.db
sudo systemctl start familieassistenten
```

### 2.4 Verify Off-site Backup

```bash
# If BACKUP_REMOTE_PATH is a NAS mount:
ls -lh /mnt/nas/familieassistenten/ | tail

# If SSH:
ssh user@backup-host 'ls -lh /remote/path/familieassistenten/'

# Check whether the latest local backup succeeded
journalctl -u familieassistenten --since "24 hours ago" | grep -i backup
```

---

## 3. Circuit Breakers

LLM/Kassal/Anthropic go through a circuit breaker that opens after
several consecutive failures and serves 503 until cooldown is done.

### 3.1 Check Breaker Status

```bash
curl -s http://localhost:7777/api/status | jq '.breakers'
```

Example output:
```json
{
  "kassal":   { "state": "CLOSED",   "failures": 0, "totalCalls": 42 },
  "ollama":   { "state": "OPEN",     "failures": 3, "openedAt": 1712734400 },
  "anthropic":{ "state": "HALF_OPEN","failures": 0, "totalCalls": 5  }
}
```

- `CLOSED` = normal
- `OPEN` = short-circuits requests until cooldown (30s–60s)
- `HALF_OPEN` = probes the next request; one success = CLOSED again

### 3.2 Why Is the Breaker OPEN?

| Breaker | Typical cause |
|---|---|
| `ollama` | Ollama process hung, model not loaded, or `systemctl status ollama` shows an error |
| `kassal` | API key expired, rate limit hit, or kassal.app is down |
| `anthropic` | API key invalid, quota used up, or network is down |

### 3.3 Manual Reset

Restarting the server resets all breakers:
```bash
sudo systemctl restart familieassistenten
```

---

## 4. Common Problems

### 4.1 "Server Won't Start in Production"

Look for one of these in the log:
- `AUTH_TOKEN er påkrevd når NODE_ENV=production` → set the token in the systemd env
- `ALLOWED_ORIGINS=* er ikke tillatt i production` → replace with concrete origins
- `Ugyldig miljø-konfigurasjon` → Zod has flagged an invalid field; read it

```bash
# Edit service env
sudo systemctl edit familieassistenten
# Add to [Service]:
#   Environment=AUTH_TOKEN=<32-hex>
#   Environment=ALLOWED_ORIGINS=https://familieassistenten.local

sudo systemctl daemon-reload
sudo systemctl restart familieassistenten
```

### 4.2 "Server Gets Killed by systemd"

Look for `watchdog` in the log:
```bash
journalctl -u familieassistenten | grep -i 'watchdog\|killed'
```

Possible causes:
1. **Event loop blocked** — Ollama call without timeout. Check LLM timeouts.
2. **sd-notify not sending WATCHDOG=1** — confirm the `systemd-notify`
   binary is installed: `which systemd-notify`
3. **WatchdogSec too short** — increase in the service file to 120s if the RPi is under load

Temporary workaround:
```bash
# Comment out WatchdogSec in /etc/systemd/system/familieassistenten.service
sudo systemctl daemon-reload
sudo systemctl restart familieassistenten
```

### 4.3 "Can't Add Item — 401 Unauthorized"

Frontend doesn't have AUTH_TOKEN. Confirm the token is set somewhere
the frontend can use (localStorage or proxy injection). For family use
on a LAN: set a fixed token in localStorage via DevTools or use Caddy
to inject the header.

Temporary: disable auth by removing AUTH_TOKEN (only on an isolated LAN!):
```bash
sudo systemctl edit familieassistenten
# Comment out Environment=AUTH_TOKEN=...
sudo systemctl restart familieassistenten
```

### 4.4 "LLM Not Responding"

```bash
# Check ollama service
sudo systemctl status ollama

# Check that the model is loaded
curl -s http://localhost:11434/api/tags | jq '.models[].name'

# Check breaker
curl -s http://localhost:7777/api/status | jq '.breakers.ollama'
```

If the breaker is OPEN: restart Ollama first, then FamilyAssistant:
```bash
sudo systemctl restart ollama
sleep 5
sudo systemctl restart familieassistenten
```

### 4.5 "Disk Full"

FamilyAssistant typically uses <100 MB DB + backups. If the disk fills up:

```bash
# Most likely journald — cap it
sudo journalctl --vacuum-size=200M

# Old backups (automatic cleanup should retain 14)
ls -lh $APP_ROOT/data/backups/

# Ollama models
du -sh ~/.ollama/models/
# Remove unused: ollama rm <name>
```

### 4.6 "CSP Error in Browser"

Open DevTools → Console. If you see `Refused to execute inline script`,
it means CSP is too strict for new inline code. FamilyAssistant
allows `'unsafe-inline'` for script and style, so this shouldn't happen
until M5 modularizes the frontend.

Temporary: change `CSP_POLICY` in `server/http/security.js`, then restart.

---

## 5. Upgrade

### 5.1 Standard Upgrade Flow

```bash
cd $APP_ROOT

# 1. Take a safety backup
sqlite3 data/familieassistenten.db \
  "VACUUM INTO 'data/backups/pre-upgrade-$(date +%F).db'"

# 2. Fetch changes
git fetch origin
git log --oneline HEAD..origin/main    # see what's coming

# 3. Stop, pull, install, start
sudo systemctl stop familieassistenten
git pull
npm ci --omit=dev
sudo systemctl start familieassistenten

# 4. Verify
curl -s http://localhost:7777/ready | jq
journalctl -u familieassistenten -n 50 --no-pager
```

### 5.2 Rollback

```bash
sudo systemctl stop familieassistenten
git reset --hard <commit-before-upgrade>
npm ci --omit=dev
# Restore DB if migrations were applied:
cp data/backups/pre-upgrade-2026-04-10.db data/familieassistenten.db
sudo systemctl start familieassistenten
```

### 5.3 API Key Rotation

API keys are stored in `.env` via the Settings UI or manually:

```bash
# Read without revealing (only whether present)
grep -E '^(KASSAL|OPENAI|ANTHROPIC|XAI)_API_KEY=' $APP_ROOT/.env | cut -d= -f1

# Edit safely
sudo nano $APP_ROOT/.env
# Permissions should be 600 and owner pi:pi
ls -l $APP_ROOT/.env

sudo systemctl restart familieassistenten
```

---

## 6. Observability

### 6.1 Prometheus Metrics

```bash
curl -s http://localhost:7777/metrics
# request totals, latency histograms, cache hits/misses, etc.
```

### 6.2 Cache Statistics

```bash
curl -s http://localhost:7777/api/cache/stats | jq
# { "size": 42, "hits": 1234, "misses": 56 }
```

### 6.3 Request Logger

```bash
journalctl -u familieassistenten -f | grep -v '"level":10\|"level":20'
# Each line is structured JSON from pino — use jq:
journalctl -u familieassistenten -o cat | jq -r 'select(.msg) | "\(.time) \(.level) \(.msg) \(.path // "")"'
```

---

## 7. Disaster Scenarios

### 7.1 "The Whole RPi5 Is Dead (SD Card Failed)"

1. Fetch the latest off-site backup from NAS/SSH host
2. Flash a new SD with Raspberry Pi OS
3. Run the install (see DEPLOY.md §1–§7)
4. Stop the server: `sudo systemctl stop familieassistenten`
5. Copy the backup in: `cp backup.db $APP_ROOT/data/familieassistenten.db`
6. Restore `.env`, `AUTH_TOKEN`, and Caddy config
7. Start: `sudo systemctl start familieassistenten`

### 7.2 "DB Is Corrupt"

```bash
# Check integrity
sqlite3 $APP_ROOT/data/familieassistenten.db "PRAGMA integrity_check;"

# If errors: restore from latest backup (see §2.3)
# Or attempt repair:
sqlite3 corrupt.db ".recover" | sqlite3 recovered.db
```

### 7.3 "Forgot AUTH_TOKEN"

```bash
sudo systemctl cat familieassistenten | grep AUTH_TOKEN
# If set via `systemctl edit`:
sudo cat /etc/systemd/system/familieassistenten.service.d/override.conf
```

---

## 8. Load Baseline on RPi5 (M3.4)

Load test with zero external dependencies — `scripts/load-baseline.js`
uses only `node:http`, so it runs on a clean RPi5 install.

### 8.1 Run the Baseline

```bash
# High rate limit so we measure handler time instead of 429:
RATE_LIMIT_MAX=100000 sudo systemctl restart familieassistenten
sleep 2

# From another machine on the LAN:
node scripts/load-baseline.js \
  --url=https://familieassistenten.local \
  --token=$AUTH_TOKEN \
  --concurrency=10 \
  --duration=60 \
  --profile=read
```

Available profiles:
- `smoke` — small sample of 5 endpoints, fast
- `read` — realistic read pattern (today/meals/chores/recipes/calendar/status)
- `mixed` — read + one write (meals/status)

### 8.2 Expected Results on RPi5 8 GB (without load from HA/Ollama)

| Metric | Target | Comment |
|---|---|---|
| p95 latency (read) | < 200 ms | sql.js fallback may be 2× better than this |
| p95 latency (write) | < 800 ms | includes DB commit |
| RPS (read, 10 workers) | > 150 | bottleneck is JSON serialization |
| Error rate | < 0.1 % | every 5xx is a bug worth investigating |
| RSS after 60s | < 250 MB | incl. sql.js buffer + cache |

### 8.3 Interpreting the Report

```
=== GRADE ===
  ✓ p95 < 200ms
  ✓ error rate < 0.1%
  ✓ no 5xx

🟢 BASELINE OK
```

If the grade fails: check the per-endpoint table to find the slow route,
and inspect `curl /api/status | jq '.breakers'` to see whether an external
backend is in the OPEN state.

### 8.4 Reset Rate Limit After Baseline

```bash
sudo systemctl edit --full familieassistenten
# Remove any RATE_LIMIT_MAX override
sudo systemctl restart familieassistenten
```

### 8.5 Perf Regression Test

Save the baseline result in `docs/perf-baseline-YYYY-MM-DD.md` after every
major change. Compare p50/p95/p99 before merging new code destined for prod.

### 8.6 One Pi, tens of families (SQLITE_BUSY gate)

SQLite on a single Raspberry Pi can serve tens of families if writers
wait (`PRAGMA busy_timeout=5000`) and retry once on `SQLITE_BUSY`. The
regression gate is four concurrent families, not a synthetic RPS
number:

```bash
# CI / local — embeds startTestServer, no running process needed
node --test tests/load-four-families.test.js

# Against a live instance (open register must be on)
BASE_URL=http://127.0.0.1:7777 node scripts/load-four-families.js
```

Each family registers, finishes onboarding, then fires 20 parallel
batches of `GET /api/today`, `POST` pantry or shopping add, and
`PUT /api/chores/complete` when a chore id exists. The process prints
`{ families, requests, errors }` and exits 1 on any 5xx or a body
containing `SQLITE_BUSY`. Raise `RATE_LIMIT_MAX` on the live unit if
the global 300/min bucket trips first.

---

## 9. Test Before You Sleep Soundly

After a change, these should always be checked:

```bash
# 1. Tests green
cd $APP_ROOT && npm test

# 2. Server starts
sudo systemctl restart familieassistenten
sleep 3
curl -sf http://localhost:7777/ready || echo "READY FAILED"

# 3. An actual endpoint responds
curl -sf -H "Authorization: Bearer $AUTH_TOKEN" http://localhost:7777/api/today > /dev/null \
  && echo "API OK" || echo "API FAILED"

# 4. Backup is fresh
ls -lh data/backups/ | tail -5

# 5. Breakers are CLOSED
curl -s http://localhost:7777/api/status | jq '.breakers | to_entries | .[] | "\(.key): \(.value.state)"'
```

If everything is green: good night.

---

## §10 Service Level Objectives (SLO) — week 5 PERF-7

Formal performance targets for FamilyAssistant. The SLOs are used as
the basis for alerting (week 6) and as the regression gate in CI
(`.github/workflows/performance.yml`).

### Latency Targets

| Operation | Target p95 | Target p99 | Source |
|---|---|---|---|
| `/health` | <5 ms | <10 ms | Proof-of-life, no DB |
| `/ready` | <50 ms | <100 ms | DB stat + fs.statfs |
| `/api/today` | <50 ms | <100 ms | Cached 5s (response-cache) |
| `/api/meals/current` | <50 ms | <100 ms | Cached |
| `/api/meals/swap` (PUT) | <300 ms | <800 ms | Write endpoint |
| `/api/shopping/list/current` | <100 ms | <200 ms | JOIN meal_plans + inventory |
| `/api/chores/current` | <50 ms | <100 ms | Cached |
| `/api/recipes` | <100 ms | <200 ms | Full scan over ~50 rows |
| `/api/recipes/:id` | <20 ms | <50 ms | PRIMARY KEY lookup |
| `/api/audit` | <100 ms | <200 ms | idx_audit_log_timestamp |
| `/api/llm/chat` | — | — | Bound to Ollama, not a server SLO |
| `/api/llm/warm` | <20 ms | <50 ms | SQL DELETE with index |

### Resource Targets

| Resource | Target | Threshold (warn) | Threshold (fail) |
|---|---|---|---|
| RSS (Node process) | <150 MB | >460 MB | >512 MB (`MEMORY_BUDGET_MB`) |
| Disk free | >5 GB | <500 MB | <100 MB (block `/ready`) |
| DB file size | <100 MB | >500 MB | — |
| Backup age | <24 h | >30 h | — |
| Error rate 5xx | <0.1% | >1% | >5% |

### Current Baseline (2026-04-11)

Run with `scripts/load-baseline.js --concurrency=5 --duration=15`:

| Metric | Value |
|---|---|
| Total requests | 96,759 |
| RPS | 6,450 |
| Global p50 | 0.6 ms |
| Global p95 | **1.5 ms** |
| Global p99 | 2.1 ms |
| Errors | 0 |
| RSS after 15s | 129 MB |

**Conclusion:** All read endpoints run far below the SLOs. There is
plenty of headroom for real family usage (typically 10–50 requests/minute).
The regression gate allows p95 up to +20% before CI fails.

### Runtime Monitoring

- **Live RSS in the `/ready` response:** `rssMB`, `memoryBudgetMB` fields
- **Warnings array:**
  - `rss_near_budget_<N>mb` when RSS >90% of budget
  - `rss_over_budget_<N>mb` when RSS >100% of budget
  - `disk_under_100mb` (blocks ready → 503)
  - `db_size_over_500mb`
  - `backup_stale_over_30h`
  - `breakers_open_<N>`
- **Prometheus metrics:** `/metrics` exposes histograms per endpoint
  with p50/p95/p99 (custom implementation, not prom-client).

### If an SLO Is Breached

1. **Latency regression in CI:** performance.yml fails with a list of endpoints
   that exceed +20%. Debug command:
   ```bash
   cat perf-current.json | node -e "
     const d = JSON.parse(require('fs').readFileSync('/dev/stdin'));
     Object.entries(d.perEndpoint).sort((a,b)=>b[1].p95-a[1].p95).forEach(
       ([k,v]) => console.log(k, v.p95+'ms')
     );
   "
   ```

2. **RSS over budget in prod:**
   - Check `/ready` and look at `rssMB`
   - `systemctl status familieassistenten` for memory
   - Emergency fallback: `systemctl restart familieassistenten` — DB persists
   - Recover with `backupNow()` if state is off
   - Root cause: likely memory leak in newer code

3. **Breaker OPEN for >5 min:**
   - Check the relevant external service (Ollama, Kassal, etc.)
   - Breaker closes automatically after cooldown (30–60s)
   - On persistent OPEN: temporarily disable via env-store settings

---

## §11 Alert Runbooks — week 6 OBS-7

Matches `docs/monitoring/alert-rules.yml`. Each alert points to
`RUNBOOK.md §11.N`. All procedures assume the operator has SSH access
to the RPi5 and sudo rights.

### §11.1 ServerDown

**Alert:** `up{job="familieassistenten"} == 0` for 1+ minute.

**Impact:** Full service outage. No family member can use
FamilyAssistant (no reads, no writes).

**First-response (≤5 min):**
```bash
# Check systemd status
sudo systemctl status familieassistenten

# If the process is down, start it
sudo systemctl start familieassistenten

# Verify it's still alive after 10s
sleep 10 && curl -sf http://localhost:7777/health
```

**Root-cause Analysis:**
```bash
# Last 100 lines from journalctl
sudo journalctl -u familieassistenten -n 100 --no-pager

# Look for uncaughtException/unhandledRejection
sudo journalctl -u familieassistenten --since "1 hour ago" | grep -i "fatal\|uncaught\|unhandled"

# Verify DB integrity
sqlite3 $APP_ROOT/data/familieassistenten.db "PRAGMA integrity_check"
```

**Escalation:** If restart doesn't help → restore from the latest backup
(see §4 disaster recovery).

---

### §11.2 WatchdogMiss

**Alert:** systemd watchdog has restarted the service 2+ times in 5 min.

**Impact:** The service is in a restart loop. Family members get sporadic
service, potentially corrupt state.

**First-response:**
```bash
# Check how many times the process has restarted
sudo journalctl -u familieassistenten --since "15 min ago" | grep -cE "^.*Started.*\.service"

# Run in foreground to see the full error message
sudo systemctl stop familieassistenten
cd $APP_ROOT
sudo -u pi NODE_ENV=production node server/index.js
# (Ctrl-C once you've seen the error)

# Restart when root cause is identified
sudo systemctl start familieassistenten
```

**Check:** Latest deploy, new dependency, DB lock, memory leak.

**Escalation:** Roll back the latest release (`git checkout v1.2.0`
and restart), or switch to the sql.js fallback if better-sqlite3
segfaults.

---

### §11.3 High5xxRate / Critical5xxRate

**Alert:** 5xx rate >1% (warning) or >5% (critical).

**Impact:** Part of the user flow is broken. Depends on which
endpoint is failing — for example, chat may be down while the meal
planner works.

**First-response:**
```bash
# Find which route is failing
curl -s http://localhost:7777/metrics | grep _requests_total

# Last uncaughtException from the alerting webhook?
# Check journalctl for the pattern
sudo journalctl -u familieassistenten --since "15 min ago" | grep -E "level.*:.*50" | tail -20
```

**Check:**
- Breaker open for Ollama/Kassal (see §11.4)?
- DB lock from a large backup restore?
- Disk space full (see §11.7)?

**Escalation:** Restart the service + monitor for 5 min after restart.

---

### §11.4 CircuitBreakerOpen

**Alert:** A breaker is `OPEN` for 5+ minutes.

**Impact:** An external integration is down. The app still works,
but the feature that uses the integration returns a graceful
fallback message.

**First-response:**
```bash
# Which breaker?
curl -s http://localhost:7777/api/status | jq '.breakers'

# Test the integration manually
# Ollama:
curl -sf http://localhost:11434/api/tags

# Kassal (if API key is set):
curl -sf -H "Authorization: Bearer $KASSAL_API_KEY" https://kassal.app/api/v1/products?search=melk

# Anthropic/OpenAI/xAI — check /api/integrations/:name/test
curl -sf http://localhost:7777/api/integrations/anthropic/test
```

**Recovery:** Breaker closes automatically after cooldown (30s–60s)
on one successful probe. If the backend is still failing → documented
outage, not a process error.

**Escalation:** Temporarily disable the integration via the Control
Room → LLM engine → switch to another backend.

---

### §11.5 HighMemoryUsage / CriticalMemoryUsage

**Alert:** RSS >460 MB (warn) or >512 MB (critical).

**Impact:** Critical → systemd/OOM killer will likely cut the process
within minutes. Warning → not yet critical but a possible leak exists.

**First-response:**
```bash
# Check current RSS
curl -s http://localhost:7777/ready | jq '{rssMB, memoryBudgetMB, warnings}'

# How many GC cycles?
sudo cat /proc/$(pidof -s node)/status | grep VmRSS

# Thanks Node: inspect heap with --inspect (requires restart)
```

**Recovery:**
```bash
# Emergency restart (DB persisted, state snapshot rehydrates metrics)
sudo systemctl restart familieassistenten
```

**Root cause (after restart):** Run load-baseline against production and
see whether RSS grows monotonically. If yes → leak analysis required. Check
the latest deploy for suspect changes.

**Escalation:** If the leak is in a specific feature → disable it
temporarily via env variable (e.g. `LLM_BACKEND=none`).

---

### §11.6 BackupStale / BackupCriticallyStale

**Alert:** Latest backup is >26h (warn) or >48h (critical) old.

**Impact:** The disaster-recovery scenario has grown `RPO` (recovery
point objective) above the acceptable bar. On data loss, you lose up
to 26/48 hours.

**First-response:**
```bash
# Manual backup now
curl -s -X POST http://localhost:7777/api/backup/now | jq

# Or via node CLI
node -e "
  const { backupNow } = require('./server/backup');
  const { initDB } = require('./server/db');
  (async () => {
    const h = await initDB();
    console.log(backupNow(h.db));
  })();
"

# Check the cron job
sudo systemctl list-timers | grep familieassistenten
```

**Root cause:** Systemd timer disabled? Crontab deleted? Disk full?

**Escalation:** If off-site backup (`BACKUP_REMOTE_PATH`) isn't
working → verify SSH keys and mount availability against the remote.

---

### §11.7 DiskLow / DiskCritical

**Alert:** Disk free <500 MB (warn) or <100 MB (critical).

**Impact:** Critical → SQLite writes will fail immediately. `/ready`
returns 503 at <100 MB.

**First-response:**
```bash
# Where is space going?
sudo du -sh $APP_ROOT/data/*
df -h

# Prune old backups if >14 days
find $APP_ROOT/data/backups -name "*.db" -mtime +14 -print -delete

# Prune journalctl if large
sudo journalctl --vacuum-time=7d

# Clean npm cache and old logs
npm cache clean --force 2>&1 || true
sudo rm -rf /var/log/*.gz
```

**Escalation:** If disk is <1% → consider moving data/ to SD or
external USB.

---

### §11.8 HighP95Latency

**Alert:** p95 latency >500 ms for a route in 10+ min.

**Impact:** User experience is slower than the SLO. Not critical, but
noticeable for the family.

**First-response:**
```bash
# Which route?
curl -s http://localhost:7777/metrics | grep -A1 "quantile=\"0.95\"" | grep -B1 -E "[0-9]{3}"

# EXPLAIN QUERY PLAN for hot queries
# See docs/DB_INDEXES.md

# Is the DB full?
ls -lh $APP_ROOT/data/familieassistenten.db
```

**Root-cause candidates:**
- N+1 queries in new code
- Missing index after a new migration
- DB lock from a backup run
- CPU contention from LLM (Ollama inference)

**Escalation:** Roll back the latest deploy if the regression appeared
after a release. Run `scripts/load-baseline.js --compare=perf-baseline.json`
to quantify.

---

## §12 Multi-tenant Operations (week 2 B1, 2026-04-20)

Multi-tenant auth is active from commit `feat(auth): aktiver
multi-tenant session-flyt`. This section covers the most common
operations tasks.

### §12.1 SESSION_SECRET — Rotation

`SESSION_SECRET` signs OAuth state cookies and magic-link
tokens. Rotating invalidates all active sessions and all
in-progress sign-ins.

**When to rotate:**
- The secret has leaked (logged to Sentry, committed in the wrong
  file, shared in chat)
- Routine rotation (annually recommended; no mandated cadence yet)

**Rotate without tearing the whole app down:**

```bash
# 1. Generate a new secret
NEW=$(openssl rand -hex 32)

# 2. Update bootstrap.json (preserves all other fields)
cd /var/lib/familyassistant/data   # or wherever bootstrap.json lives
jq --arg s "$NEW" '.sessionSecret = $s | .sessionSecretGeneratedAt = now | todate' bootstrap.json > bootstrap.json.new
chmod 600 bootstrap.json.new
mv bootstrap.json.new bootstrap.json

# 3. Restart container. All existing sessions are invalidated;
#    users must log in again.
docker compose restart app
```

**Verification:** `GET /api/auth/me` from an old browser session
should return `{authenticated: false}`.

### §12.2 Invite a New Family

New families are onboarded via an invitation from an existing
family owner (owner role).

```bash
# As owner in family A:
curl -X POST http://<rpi>:7777/api/family/invitations \
  -H "Cookie: fa_session=<owner-session-id>" \
  -H "Content-Type: application/json" \
  -d '{"email": "new-user@example", "role": "adult"}'

# The response contains { token }. Send the link:
#   http://<rpi>:7777/invite/<token>
# to the user. They open it, sign in (magic link or
# Google OAuth), and are automatically added to family A.
```

**Edge case:** If the user is already in another family,
`POST /api/auth/onboarding/complete` returns 409 Conflict.
The user must leave their old family first (or the owner
deletes it).

### §12.3 Debug "tenant-mismatch" — User Sees the Wrong Family

Symptom: User B logs in, sees data from family A.

Possible causes, in order of likelihood:

1. **Stale service-worker cache.** User hasn't reloaded the
   browser after a deploy. Ask for a hard refresh (Ctrl+F5) or
   incognito test.
2. **Wrong session cookie.** Check DevTools → Application →
   Cookies → `fa_session`. Compare against
   `SELECT user_id, family_id FROM sessions WHERE id='<sid>'`
   in the DB.
3. **AsyncLocalStorage leak.** If middleware doesn't wrap the
   handler in `runWithFamily(familyId, ...)`, the previous
   request's family_id can "leak" through. See
   `server/auth/family-context.js` and search for routes that
   don't go through authenticate().

### §12.4 Delete a Family

Only the owner can delete. All data cascades via
`repos.family.deleteFamily(id)` — including shopping_lists,
pantry, meal_plans, chores, etc.

```bash
# As owner:
curl -X DELETE http://<rpi>:7777/api/family \
  -H "Cookie: fa_session=<owner-session-id>"
```

**Warning:** irreversible. No soft delete. If a family
contains valuable recipes (`source='family-modified'`),
consider exporting them via `GET /api/gdpr/export` first.

### §12.5 When a Session Expires Mid-use

User A is sitting on the UI, session expires in the background. The next
request should return 401 and `public/js/auth.js` should redirect the
user back to `/login.html`. Verify that the service worker evicts the
API cache on 401 (see `public/sw.js:149`) so that the previous user's
data doesn't leak over.

### §12.6 Verify Empirical Tenant Isolation

After every auth change (C3 or later): run the
end-to-end test:

1. Open Chrome in normal mode, sign in as User A, create
   Family A, add `banana` to pantry.
2. Open Firefox (or Chrome incognito with fresh cookies), sign
   in as User B, create Family B, add `apple` to pantry.
3. Switch back to Chrome: `GET /api/pantry` should show only
   banana, not apple.
4. Switch to Firefox: `GET /api/pantry` should show only apple,
   not banana.
5. Via SQLite:
   ```sql
   SELECT family_id, product_key, qty FROM inventory ORDER BY family_id;
   ```
   Should show two rows with different `family_id`.

If 1–4 show cross-contamination: STOP and report. That is
a regression in auth middleware or AsyncLocalStorage wrapping.

---

## §13 LLM-backend — shared Ollama + per-family override (week 2 B2, 2026-04-22)

Christer's decision B2 (Issue #62): one shared Ollama on the RPi for
all pilot families. This mirrors current code behavior, and the
section covers the operations aspects the operator needs to be aware of.

> **Note:** No empirical cross-family verification has been done as of
> 2026-04-22 — the pilot container is down due to the
> SESSION_SECRET deploy gate
> ([`docs/known-issues/portainer-session-secret-deploy-gate.md`](known-issues/portainer-session-secret-deploy-gate.md)).
> Verification will run when the container is back up (expected week 4).
> See **§13.7** for the test procedure.

### §13.1 Current Code Behavior

Chat and meal-suggestion in `POST /api/llm/chat` ([routes.js:2011](../server/routes.js#L2011))
call `chat()` in [`server/llm.js`](../server/llm.js) which uses the
**global** `OLLAMA_HOST` from `config.js`. All families hit the
same Ollama instance regardless of any per-family config.

Per-family config is stored in the `llm_configs` table
(migration 014, `server/repositories/llm-config.repo.js`) and
exposed via the `/api/family/llm` endpoints
([`server/auth/llm-routes.js`](../server/auth/llm-routes.js)), but
is **only** used by the test endpoint `POST /api/family/llm/test` —
not by the actual chat flow yet.

**Pilot consequence:** All 5 families use Christer's Ollama
directly. No isolation at the LLM layer; no family-specific
model choice or API keys in practice (even though the DB appears
to support it).

### §13.2 Operator Flow: Configure LLM Per Family

> **Scope warning:** This covers the UI flow the operator can use,
> but per §13.1 the chat flow does not take the result into account yet.
> That is, setting family-specific config today only gives you the
> test capability + storage in the DB; no runtime effect on chat.

**As owner of a family:**

```bash
# Get current config (always safe — never reveals the API key)
curl -s -H "Cookie: fa_session=<owner-sid>" \
  http://<host>:7777/api/family/llm

# Example response:
# { "config": { "backend": "ollama", "model": "qwen2.5:3b",
#               "baseUrl": "http://host.docker.internal:11434",
#               "hasKey": false } }

# Set family-specific config (owner-only)
curl -X PUT -H "Cookie: fa_session=<owner-sid>" \
  -H "Content-Type: application/json" \
  -d '{"backend":"anthropic","model":"claude-sonnet-4-5","apiKey":"<anthropic-key>"}' \
  http://<host>:7777/api/family/llm

# Test that the config works (any authed member)
curl -X POST -H "Cookie: fa_session=<member-sid>" \
  http://<host>:7777/api/family/llm/test
# { "ok": true, "backend": "anthropic", "model": "...", "result": "..." }
```

**Available backends** (from `SUPPORTED_BACKENDS` in
`llm-config.repo.js:21`):

- `ollama` — default; `baseUrl` points to the Ollama instance
- `llamacpp` — alternative local runtime
- `anthropic` — Claude API (requires `apiKey`)
- `openai` — GPT-4/5 (requires `apiKey`)
- `xai` — Grok (requires `apiKey`)

**Key handling:**

- API keys are AES-256-GCM encrypted with `ENCRYPTION_KEY` before being stored
  in `llm_configs.api_key_ciphertext`.
- `apiKey: undefined` → keep existing.
- `apiKey: ''` → delete existing.
- `apiKey: '<string>'` → encrypt and store.
- Ciphertext is never read back to the client — `/api/family/llm`
  returns only `hasKey: boolean`.

### §13.3 Fallback When Ollama Is Down

**Symptom:** Chat returns 503 or "LLM unavailable".

**Check:**

```bash
# From the app container:
curl -sf http://host.docker.internal:11434/api/tags
# Empty response = Ollama down. JSON with a model list = OK.

# App status:
curl -s http://localhost:7777/api/status | jq '.breakers.ollama,.llm'
```

**Circuit breaker state:** If Ollama keeps failing, the breaker
opens and serves 503 during the cooldown period (see §3).

**Root causes for Ollama being down:**

1. Ollama service not started on the RPi host:
   `sudo systemctl status ollama`
2. Model not loaded: `ollama list` doesn't show `qwen2.5:3b`.
   Fix: `ollama pull qwen2.5:3b`
3. Port 11434 blocked between container and host —
   `host.docker.internal:host-gateway` must be set in
   docker-compose.yml (already set, lines 117-118).
4. RAM exhaustion: qwen2.5:3b needs ~2 GB. If the RPi
   is concurrently running other ML services, the OOM killer
   can take Ollama. Check `free -m` and `journalctl -u ollama -n 50`.

**No automatic fallback** to other backends in current code.
Chat returns 503 to the family until Ollama is back up.

### §13.4 Resource Considerations Under Concurrent Use From Multiple Families

Ollama on RPi5 8 GB handles serial chat well, but parallel use
from 5 families can become a bottleneck.

**Resource budget (rough estimate):**

| Component | RAM |
|---|---|
| qwen2.5:3b model loaded | ~2.0 GB |
| Ollama process overhead | ~0.3 GB |
| FamilyAssistant container | ~0.5 GB (cap 512 MB per docker-compose) |
| HomeAssistant (if co-located) | ~0.8 GB |
| OS + other | ~1.0 GB |
| **Total** | ~4.6 GB |

Remaining ~3.4 GB is used for inference context caching and
concurrent requests.

**Theoretical latency** (not measured for the 5-family scenario;
based on general Ollama behavior + the existing load-baseline):

- Serial chat (one family): p95 < 2 seconds for a 200-word response
- 2 in parallel: p95 typically rises to ~4 seconds (Ollama queue)
- 3+ in parallel: p95 > 6 seconds expected

**Measurements have not been taken for 5 concurrent families** —
to be verified by the §13.7 procedure once the container is up.

**Mitigation if capacity becomes an issue:**

- Switch to a smaller model: `qwen2.5:1.5b` (half the RAM, ~3x faster)
- Enable per-family cloud backend via `/api/family/llm` (paid
  by the family itself) — first requires a code change per the §13.1 gap
- Buy a more powerful RPi / NUC (RAM-bound, not CPU)

### §13.5 LLM Cache as a Buffer Against Repeated Questions

[server/services/llm-cache.service.js](../server/services/llm-cache.service.js)
stores the same (user-query + context) → same answer for 7 days.
Saves round trips to Ollama on repeated questions. Hit rate
is checked via the `GET /api/status` breakers field.

### §13.6 Change the Global LLM Backend

In the current pilot setup the default is controlled via the Portainer stack env
(docker-compose.yml lines 73-75):

```
LLM_BACKEND: ${LLM_BACKEND:-ollama}
OLLAMA_HOST: ${OLLAMA_HOST:-http://host.docker.internal:11434}
OLLAMA_MODEL: ${OLLAMA_MODEL:-qwen2.5:3b}
```

Change requires:

1. Update the Portainer stack env vars.
2. Redeploy (Portainer → "Update the stack")
3. Verify via `GET /api/status` → `backend: 'ollama'` and
   `backend-health: up`.

### §13.7 Empirical Verification Procedure (TODO — deferred until post-deploy-gate)

**TODO:** run when `portainer-session-secret-deploy-gate`
is resolved (expected week 4).

1. Container up + 2 families invited and signed in.
2. Both families send `POST /api/llm/chat` with different
   messages concurrently (two separate cookie jars).
3. Verify:
   - Both get a response within reasonable time (< 10 sec p95).
   - The families do not see each other's chat history
     (`repos.kb` should be family-scoped).
   - The Ollama host log shows two separate requests (not one).
4. Document actual latency and RAM usage in §13.4 and in the next
   week-baseline.

**If the pilot shows unacceptable latency:** enable the per-family
config by wiring `getClientForFamily()` into the chat handler —
requires a code change in `server/routes.js:2011-2042` and a new
analysis PR per AGENTS.md DEL 3.

