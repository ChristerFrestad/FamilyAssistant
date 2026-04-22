# Familieassistenten — Runbook

**Sist oppdatert:** 2026-04-10
**Målgruppe:** Operatør. Dette dokumentet er for feilsøking og
daglig drift av Familieassistenten på Raspberry Pi 5.

> **Stier:** `$APP_ROOT` = installasjonssti (standard: `$APP_ROOT`)

> For førstegangs-installasjon, se [DEPLOY.md](./DEPLOY.md).

---

## 1. Daglige kommandoer

| Hva | Kommando |
|---|---|
| Sjekk status | `sudo systemctl status familieassistenten` |
| Start | `sudo systemctl start familieassistenten` |
| Stopp | `sudo systemctl stop familieassistenten` |
| Restart | `sudo systemctl restart familieassistenten` |
| Følg logger | `journalctl -u familieassistenten -f` |
| Siste 200 linjer | `journalctl -u familieassistenten -n 200 --no-pager` |
| Kun feil | `journalctl -u familieassistenten -p err -n 100 --no-pager` |
| Vis nåværende miljø | `systemctl show familieassistenten --property=Environment` |

### Helsesjekker

```bash
# Lokal helsesjekk
curl -s http://localhost:3000/health | jq
# { "status": "ok", "uptimeSec": 1234, "pid": 567, "memMB": 128 }

# Ready-sjekk (viser DB-driver + KB-størrelse)
curl -s http://localhost:3000/ready | jq

# Full status (versjon, breakers, migrasjoner)
curl -s http://localhost:3000/api/status | jq

# Bak Caddy med AUTH_TOKEN
curl -s -H "Authorization: Bearer $AUTH_TOKEN" https://familieassistenten.local/api/status | jq
```

---

## 2. Backup + Restore

### 2.1 Backup-lokasjoner

- **Lokal:** `$APP_ROOT/data/backups/familieassistenten-YYYY-MM-DD.db`
- **Off-site:** avhenger av `BACKUP_REMOTE_PATH` i service-env (NAS-mount, SSH-host, rsync-daemon)
- **Schedule:** daglig kl. 03:00, beholder 14 dager
- **På shutdown:** en siste backup tas automatisk før DB stenger

### 2.2 Ta backup manuelt

```bash
# Enkleste — kaller samme backupNow() som cron
sudo systemctl stop familieassistenten
cp $APP_ROOT/data/familieassistenten.db \
   $APP_ROOT/data/backups/manual-$(date +%F).db
sudo systemctl start familieassistenten
```

Eller via en SQL-konsoll mot live DB (trygt på better-sqlite3):

```bash
sqlite3 $APP_ROOT/data/familieassistenten.db \
  "VACUUM INTO '$APP_ROOT/data/backups/manual-$(date +%F).db'"
```

### 2.3 Restore fra backup

```bash
# 1. Stopp serveren
sudo systemctl stop familieassistenten

# 2. Lag en safety-kopi av nåværende DB (før du skriver over)
cp $APP_ROOT/data/familieassistenten.db \
   $APP_ROOT/data/familieassistenten.db.pre-restore

# 3. Kopier backupen inn
cp $APP_ROOT/data/backups/familieassistenten-YYYY-MM-DD.db \
   $APP_ROOT/data/familieassistenten.db
chown pi:pi $APP_ROOT/data/familieassistenten.db

# 4. Start serveren
sudo systemctl start familieassistenten

# 5. Verifiser
curl -s http://localhost:3000/ready | jq
journalctl -u familieassistenten -n 20 --no-pager | grep -i 'migrasjon\|ready\|error'
```

**Hvis restore feiler:** flytt tilbake safety-kopien:
```bash
mv $APP_ROOT/data/familieassistenten.db.pre-restore \
   $APP_ROOT/data/familieassistenten.db
sudo systemctl start familieassistenten
```

### 2.4 Verifiser off-site backup

```bash
# Hvis BACKUP_REMOTE_PATH er en NAS-mount:
ls -lh /mnt/nas/familieassistenten/ | tail

# Hvis SSH:
ssh user@backup-host 'ls -lh /remote/path/familieassistenten/'

# Se om siste lokale backup lyktes
journalctl -u familieassistenten --since "24 hours ago" | grep -i backup
```

---

## 3. Circuit breakers

LLM/Kassal/Anthropic går gjennom en circuit breaker som åpnes etter
flere påfølgende feil og serverer 503 til cooldown er ferdig.

### 3.1 Sjekk breaker-status

```bash
curl -s http://localhost:3000/api/status | jq '.breakers'
```

Eksempel-output:
```json
{
  "kassal":   { "state": "CLOSED",   "failures": 0, "totalCalls": 42 },
  "ollama":   { "state": "OPEN",     "failures": 3, "openedAt": 1712734400 },
  "anthropic":{ "state": "HALF_OPEN","failures": 0, "totalCalls": 5  }
}
```

- `CLOSED` = normal
- `OPEN` = kortslutter requests til cooldown (30s–60s)
- `HALF_OPEN` = prober neste request, en suksess = CLOSED igjen

### 3.2 Hvorfor er breakeren OPEN?

| Breaker | Typisk årsak |
|---|---|
| `ollama` | Ollama-prosess hengt, modell ikke lastet, eller `systemctl status ollama` viser feil |
| `kassal` | API-nøkkel utløpt, rate limit truffet, eller kassal.app nede |
| `anthropic` | API-nøkkel ugyldig, kvote brukt opp, eller nett nede |

### 3.3 Reset manuell

En restart av serveren resetter alle breakers:
```bash
sudo systemctl restart familieassistenten
```

---

## 4. Vanlige problemer

### 4.1 "Serveren starter ikke i produksjon"

Se etter en av disse i loggen:
- `AUTH_TOKEN er påkrevd når NODE_ENV=production` → sett token i systemd-env
- `ALLOWED_ORIGINS=* er ikke tillatt i production` → erstatt med konkrete origins
- `Ugyldig miljø-konfigurasjon` → Zod har validert feil, les feltet

```bash
# Rediger service-env
sudo systemctl edit familieassistenten
# Legg til i [Service]:
#   Environment=AUTH_TOKEN=<32-hex>
#   Environment=ALLOWED_ORIGINS=https://familieassistenten.local

sudo systemctl daemon-reload
sudo systemctl restart familieassistenten
```

### 4.2 "Serveren blir killet av systemd"

Se etter `watchdog` i logg:
```bash
journalctl -u familieassistenten | grep -i 'watchdog\|killed'
```

Mulige årsaker:
1. **Event loop blokkert** — Ollama-kall uten timeout. Sjekk LLM-timeouts.
2. **sd-notify sender ikke WATCHDOG=1** — sjekk at `systemd-notify` binary er
   installert: `which systemd-notify`
3. **WatchdogSec for kort** — øk i service-filen til 120s hvis RPi er under last

Midlertidig løsning:
```bash
# Kommenter ut WatchdogSec i /etc/systemd/system/familieassistenten.service
sudo systemctl daemon-reload
sudo systemctl restart familieassistenten
```

### 4.3 "Kan ikke legge til vare — 401 Unauthorized"

Frontend har ikke AUTH_TOKEN. Sjekk at token er satt i et sted som frontend
bruker (localStorage eller proxy-injection). For familiebruk på LAN: sett en
fast token i localStorage via DevTools eller bruk Caddy til å injisere header.

Temporært: deaktiver auth ved å fjerne AUTH_TOKEN (bare på isolert LAN!):
```bash
sudo systemctl edit familieassistenten
# Kommenter Environment=AUTH_TOKEN=...
sudo systemctl restart familieassistenten
```

### 4.4 "LLM svarer ikke"

```bash
# Sjekk ollama-service
sudo systemctl status ollama

# Sjekk at modellen er lastet
curl -s http://localhost:11434/api/tags | jq '.models[].name'

# Sjekk breaker
curl -s http://localhost:3000/api/status | jq '.breakers.ollama'
```

Hvis breakeren er OPEN: restart Ollama først, så Familieassistenten:
```bash
sudo systemctl restart ollama
sleep 5
sudo systemctl restart familieassistenten
```

### 4.5 "Disk full"

Familieassistenten bruker typisk <100 MB DB + backups. Hvis disken fylles opp:

```bash
# Mest sannsynlig journald — begrens
sudo journalctl --vacuum-size=200M

# Gamle backups (automatisk cleanup skulle beholde 14)
ls -lh $APP_ROOT/data/backups/

# Ollama-modeller
du -sh ~/.ollama/models/
# Slett ubrukte: ollama rm <navn>
```

### 4.6 "CSP-feil i nettleser"

Åpne DevTools → Console. Hvis du ser `Refused to execute inline script`,
betyr det at CSP er for streng for ny inline-kode. Familieassistenten
tillater `'unsafe-inline'` for script og style, så dette burde ikke skje
før M5 modulariserer frontend.

Midlertidig: endre `CSP_POLICY` i `server/http/security.js`, restart.

---

## 5. Oppgradering

### 5.1 Standard upgrade-flow

```bash
cd $APP_ROOT

# 1. Ta en safety-backup
sqlite3 data/familieassistenten.db \
  "VACUUM INTO 'data/backups/pre-upgrade-$(date +%F).db'"

# 2. Hent endringer
git fetch origin
git log --oneline HEAD..origin/main    # se hva som kommer

# 3. Stopp, pull, installer, start
sudo systemctl stop familieassistenten
git pull
npm ci --omit=dev
sudo systemctl start familieassistenten

# 4. Verifiser
curl -s http://localhost:3000/ready | jq
journalctl -u familieassistenten -n 50 --no-pager
```

### 5.2 Rollback

```bash
sudo systemctl stop familieassistenten
git reset --hard <commit-før-upgrade>
npm ci --omit=dev
# Restore DB hvis migrasjoner ble kjørt:
cp data/backups/pre-upgrade-2026-04-10.db data/familieassistenten.db
sudo systemctl start familieassistenten
```

### 5.3 API-nøkkel-rotasjon

API-nøkler lagres i `.env` via Settings-UI eller manuelt:

```bash
# Les uten å vise (bare finnes/ikke)
grep -E '^(KASSAL|OPENAI|ANTHROPIC|XAI)_API_KEY=' $APP_ROOT/.env | cut -d= -f1

# Rediger trygt
sudo nano $APP_ROOT/.env
# Permissions skal være 600 og eier pi:pi
ls -l $APP_ROOT/.env

sudo systemctl restart familieassistenten
```

---

## 6. Observability

### 6.1 Prometheus-metrics

```bash
curl -s http://localhost:3000/metrics
# request totals, latency histograms, cache hits/misses, etc.
```

### 6.2 Cache-statistikk

```bash
curl -s http://localhost:3000/api/cache/stats | jq
# { "size": 42, "hits": 1234, "misses": 56 }
```

### 6.3 Request-logger

```bash
journalctl -u familieassistenten -f | grep -v '"level":10\|"level":20'
# Hver linje er strukturert JSON fra pino — bruk jq:
journalctl -u familieassistenten -o cat | jq -r 'select(.msg) | "\(.time) \(.level) \(.msg) \(.path // "")"'
```

---

## 7. Katastrofe-scenarier

### 7.1 "Hele RPi5 er død (SD-kort feilet)"

1. Hent siste off-site-backup fra NAS/SSH-host
2. Flash ny SD med Raspberry Pi OS
3. Kjør installasjonen (se DEPLOY.md §1–§7)
4. Stopp serveren: `sudo systemctl stop familieassistenten`
5. Kopier backup inn: `cp backup.db $APP_ROOT/data/familieassistenten.db`
6. Gjenopprett `.env`, `AUTH_TOKEN` og Caddy-config
7. Start: `sudo systemctl start familieassistenten`

### 7.2 "DB er korrupt"

```bash
# Sjekk integritet
sqlite3 $APP_ROOT/data/familieassistenten.db "PRAGMA integrity_check;"

# Hvis feil: restore fra siste backup (se §2.3)
# Eller forsøk reparasjon:
sqlite3 corrupt.db ".recover" | sqlite3 recovered.db
```

### 7.3 "Glemt AUTH_TOKEN"

```bash
sudo systemctl cat familieassistenten | grep AUTH_TOKEN
# Hvis satt via `systemctl edit`:
sudo cat /etc/systemd/system/familieassistenten.service.d/override.conf
```

---

## 8. Load-baseline på RPi5 (M3.4)

Belastningstest med null eksterne avhengigheter — `scripts/load-baseline.js`
bruker kun `node:http`, så det kjører på en ren RPi5-installasjon.

### 8.1 Kjør baseline

```bash
# Høy rate-limit så vi måler handler-tid i stedet for 429:
RATE_LIMIT_MAX=100000 sudo systemctl restart familieassistenten
sleep 2

# Fra en annen maskin på LAN:
node scripts/load-baseline.js \
  --url=https://familieassistenten.local \
  --token=$AUTH_TOKEN \
  --concurrency=10 \
  --duration=60 \
  --profile=read
```

Tilgjengelige profiler:
- `smoke` — små sample of 5 endpoints, rask
- `read` — realistisk lesemønster (today/meals/chores/recipes/calendar/status)
- `mixed` — read + én write (meals/status)

### 8.2 Forventede resultater på RPi5 8 GB (uten last fra HA/Ollama)

| Metrikk | Mål | Kommentar |
|---|---|---|
| p95 latency (read) | < 200 ms | sql.js fallback kan være 2× bedre enn dette |
| p95 latency (write) | < 800 ms | inkluderer DB commit |
| RPS (read, 10 workers) | > 150 | bottleneck er JSON serialisering |
| Error rate | < 0.1 % | alle 5xx er bugs å undersøke |
| RSS etter 60s | < 250 MB | inkl. sql.js buffer + cache |

### 8.3 Tolkning av rapporten

```
=== GRADE ===
  ✓ p95 < 200ms
  ✓ error rate < 0.1%
  ✓ no 5xx

🟢 BASELINE OK
```

Hvis grade feiler: se per-endepunkt-tabellen for å finne treg rute, og sjekk
`curl /api/status | jq '.breakers'` for å se om en ekstern backend er i OPEN-tilstand.

### 8.4 Reset rate-limit etter baseline

```bash
sudo systemctl edit --full familieassistenten
# Fjern evt. RATE_LIMIT_MAX-override
sudo systemctl restart familieassistenten
```

### 8.5 Perf-regresjonstest

Lagre baseline-resultatet i `docs/perf-baseline-YYYY-MM-DD.md` etter hver større
endring. Sammenlign p50/p95/p99 før du merger ny kode som skal i prod.

---

## 9. Test før du sover rolig

Etter en endring bør disse alltid sjekkes:

```bash
# 1. Tester grønne
cd $APP_ROOT && npm test

# 2. Server starter
sudo systemctl restart familieassistenten
sleep 3
curl -sf http://localhost:3000/ready || echo "READY FEILET"

# 3. En faktisk endepoint svarer
curl -sf -H "Authorization: Bearer $AUTH_TOKEN" http://localhost:3000/api/today > /dev/null \
  && echo "API OK" || echo "API FEILET"

# 4. Backup er fersk
ls -lh data/backups/ | tail -5

# 5. Breakers er CLOSED
curl -s http://localhost:3000/api/status | jq '.breakers | to_entries | .[] | "\(.key): \(.value.state)"'
```

Hvis alt er grønt: god natt.

---

## §10 Service Level Objectives (SLO) — uke 5 PERF-7

Formelle ytelses-targets for Familieassistenten. SLO-ene brukes som
grunnlag for alerting (uke 6) og regression-gate i CI-en
(`.github/workflows/performance.yml`).

### Latency-mål

| Operasjon | Mål p95 | Mål p99 | Kilde |
|---|---|---|---|
| `/health` | <5 ms | <10 ms | Proof-of-life, ingen DB |
| `/ready` | <50 ms | <100 ms | DB-stat + fs.statfs |
| `/api/today` | <50 ms | <100 ms | Cached 5s (response-cache) |
| `/api/meals/current` | <50 ms | <100 ms | Cached |
| `/api/meals/swap` (PUT) | <300 ms | <800 ms | Skrive-endpoint |
| `/api/shopping/list/current` | <100 ms | <200 ms | JOIN meal_plans + inventory |
| `/api/chores/current` | <50 ms | <100 ms | Cached |
| `/api/recipes` | <100 ms | <200 ms | Full-scan over ~50 rader |
| `/api/recipes/:id` | <20 ms | <50 ms | PRIMARY KEY lookup |
| `/api/audit` | <100 ms | <200 ms | idx_audit_log_timestamp |
| `/api/llm/chat` | — | — | Bundet til Ollama, ikke server-SLO |
| `/api/llm/warm` | <20 ms | <50 ms | SQL DELETE med index |

### Resource-mål

| Ressurs | Mål | Terskel (warn) | Terskel (fail) |
|---|---|---|---|
| RSS (Node-prosess) | <150 MB | >460 MB | >512 MB (`MEMORY_BUDGET_MB`) |
| Disk fri | >5 GB | <500 MB | <100 MB (blokker `/ready`) |
| DB-fil størrelse | <100 MB | >500 MB | — |
| Backup-alder | <24 h | >30 h | — |
| Error-rate 5xx | <0.1% | >1% | >5% |

### Gjeldende baseline (2026-04-11)

Kjørt med `scripts/load-baseline.js --concurrency=5 --duration=15`:

| Metrikk | Verdi |
|---|---|
| Total requests | 96 759 |
| RPS | 6 450 |
| Global p50 | 0.6 ms |
| Global p95 | **1.5 ms** |
| Global p99 | 2.1 ms |
| Errors | 0 |
| RSS etter 15s | 129 MB |

**Konklusjon:** Alle read-endepunkter kjører langt under SLO-ene. Det er
rikelig headroom for reell familie-bruk (typisk 10-50 requests/minutt).
Regressions-gaten tillater p95 opp til +20% før CI feiler.

### Runtime-overvåkning

- **Live RSS i `/ready`-respons:** `rssMB`, `memoryBudgetMB`-feltene
- **Warnings-array:**
  - `rss_near_budget_<N>mb` når RSS >90% av budget
  - `rss_over_budget_<N>mb` når RSS >100% av budget
  - `disk_under_100mb` (blokker ready → 503)
  - `db_size_over_500mb`
  - `backup_stale_over_30h`
  - `breakers_open_<N>`
- **Prometheus-metrics:** `/metrics` eksponerer histogrammer per endpoint
  med p50/p95/p99 (custom implementering, ikke prom-client).

### Hvis SLO brytes

1. **Latency-regresjon i CI:** performance.yml feiler med liste over endepunkter
   som overskrider +20%. Debug-kommando:
   ```bash
   cat perf-current.json | node -e "
     const d = JSON.parse(require('fs').readFileSync('/dev/stdin'));
     Object.entries(d.perEndpoint).sort((a,b)=>b[1].p95-a[1].p95).forEach(
       ([k,v]) => console.log(k, v.p95+'ms')
     );
   "
   ```

2. **RSS over budget i prod:**
   - Sjekk `/ready` og se `rssMB`
   - `systemctl status familieassistenten` for memory
   - Nødfallback: `systemctl restart familieassistenten` — DB persisterer
   - Gjenopprett med `backupNow()` hvis state er rart
   - Root-cause: sannsynlig memory leak i nyere kode

3. **Breaker OPEN i >5 min:**
   - Sjekk relevant ekstern tjeneste (Ollama, Kassal, etc.)
   - Breaker lukker automatisk etter cooldown (30-60s)
   - Ved persistent OPEN: deaktiver midlertidig via env-store-innstillinger

---

## §11 Alert runbooks — uke 6 OBS-7

Matcher `docs/monitoring/alert-rules.yml`. Hver alert viser til
`RUNBOOK.md §11.N`. Alle prosedyrer antar at operatør har SSH-tilgang
til RPi5 og sudo-rettigheter.

### §11.1 ServerDown

**Alert:** `up{job="familieassistenten"} == 0` i 1+ minutt.

**Impact:** Full tjenestebortfall. Ingen family-member kan bruke
Familieassistenten (ikke lese, ikke skrive).

**First-response (≤5 min):**
```bash
# Sjekk systemd-status
sudo systemctl status familieassistenten

# Om prosessen er down, start den
sudo systemctl start familieassistenten

# Sjekk at den fortsatt lever etter 10s
sleep 10 && curl -sf http://localhost:3000/health
```

**Root-cause analyse:**
```bash
# Siste 100 linjer fra journalctl
sudo journalctl -u familieassistenten -n 100 --no-pager

# Se etter uncaughtException/unhandledRejection
sudo journalctl -u familieassistenten --since "1 hour ago" | grep -i "fatal\|uncaught\|unhandled"

# Verifiser DB-integritet
sqlite3 $APP_ROOT/data/familieassistenten.db "PRAGMA integrity_check"
```

**Escalation:** Hvis restart ikke hjelper → restore fra siste backup
(se §4 DR-scenarier).

---

### §11.2 WatchdogMiss

**Alert:** systemd-watchdog har restartet servicen 2+ ganger på 5 min.

**Impact:** Tjenesten er i restart-loop. Familiemedlemmer får sporadisk
tjeneste, potensielt korrupt state.

**First-response:**
```bash
# Sjekk hvor mange ganger prosessen har restartet
sudo journalctl -u familieassistenten --since "15 min ago" | grep -c "Started Familieassistenten"

# Kjør i foreground for å se hele feilmeldingen
sudo systemctl stop familieassistenten
cd $APP_ROOT
sudo -u pi NODE_ENV=production node server/index.js
# (Ctrl-C når du har sett feilen)

# Restart når root-cause er identifisert
sudo systemctl start familieassistenten
```

**Kontroller:** Siste deploy, ny avhengighet, DB-lock, minne-leak.

**Escalation:** Rulle tilbake siste release (`git checkout v1.2.0`
og restart), eller switch til sql.js fallback hvis better-sqlite3
segfaulter.

---

### §11.3 High5xxRate / Critical5xxRate

**Alert:** 5xx-rate >1% (warning) eller >5% (critical).

**Impact:** En del av brukerflyten er brutt. Avhengig av hvilken
endpoint som feiler — for eksempel kan chat være nede mens meal-planner
fungerer.

**First-response:**
```bash
# Finn hvilken route som feiler
curl -s http://localhost:3000/metrics | grep _requests_total

# Siste uncaughtException fra alerting-webhook?
# Sjekk journalctl for mønster
sudo journalctl -u familieassistenten --since "15 min ago" | grep -E "level.*:.*50" | tail -20
```

**Kontroller:**
- Breaker open for Ollama/Kassal (se §11.4)?
- DB-lock pga. stort backup-restore?
- Diskplass full (se §11.7)?

**Escalation:** Restart servicen + overvåk 5 min etter restart.

---

### §11.4 CircuitBreakerOpen

**Alert:** En breaker er `OPEN` i 5+ minutter.

**Impact:** En ekstern integrasjon er nede. Appen fungerer fortsatt,
men funksjonen som bruker den integrasjonen returnerer graceful
fallback-melding.

**First-response:**
```bash
# Hvilken breaker?
curl -s http://localhost:3000/api/status | jq '.breakers'

# Test integrasjonen manuelt
# Ollama:
curl -sf http://localhost:11434/api/tags

# Kassal (hvis API-nøkkel er satt):
curl -sf -H "Authorization: Bearer $KASSAL_API_KEY" https://kassal.app/api/v1/products?search=melk

# Anthropic/OpenAI/xAI — sjekk /api/integrations/:name/test
curl -sf http://localhost:3000/api/integrations/anthropic/test
```

**Recovery:** Breaker lukker automatisk etter cooldown (30s-60s)
ved én vellykket probe. Hvis backend fortsatt feiler → dokumentert
brudd, ikke prosess-feil.

**Escalation:** Midlertidig deaktiver integrasjon via Kontrollrommet
→ LLM-motor → bytt til annen backend.

---

### §11.5 HighMemoryUsage / CriticalMemoryUsage

**Alert:** RSS >460 MB (warn) eller >512 MB (critical).

**Impact:** Critical → systemd/OOM-killer vil kutte prosessen
sannsynligvis innen minutter. Warning → enda ikke kritisk men du har
mulig lekkasje.

**First-response:**
```bash
# Sjekk nåværende RSS
curl -s http://localhost:3000/ready | jq '{rssMB, memoryBudgetMB, warnings}'

# Hvor mange GC-sykluser?
sudo cat /proc/$(pidof -s node)/status | grep VmRSS

# Takk Node: sjekk heap med --inspect (krever restart)
```

**Recovery:**
```bash
# Nødrestart (DB persistert, state-snapshot hydrerer metrics)
sudo systemctl restart familieassistenten
```

**Root-cause (etter restart):** Kjør load-baseline mot produksjon og
se om RSS vokser monotont. Hvis ja → leak-analyse påkrevet. Sjekk
siste deploy for suspect endringer.

**Escalation:** Hvis leak er i en spesifikk feature → deaktiver den
midlertidig via env-variabel (f.eks. `LLM_BACKEND=none`).

---

### §11.6 BackupStale / BackupCriticallyStale

**Alert:** Siste backup er >26h (warn) eller >48h (critical) gammel.

**Impact:** DR-scenario har vokst `RPO` (recovery point objective)
over akseptabelt. Ved datatap mister du opp til 26/48 timer.

**First-response:**
```bash
# Manuell backup nå
curl -s -X POST http://localhost:3000/api/backup/now | jq

# Eller via node-cli
node -e "
  const { backupNow } = require('./server/backup');
  const { initDB } = require('./server/db');
  (async () => {
    const h = await initDB();
    console.log(backupNow(h.db));
  })();
"

# Sjekk cron-jobben
sudo systemctl list-timers | grep familieassistenten
```

**Root-cause:** Systemd timer disabled? Cron-tab slettet? Disk full?

**Escalation:** Hvis off-site backup (`BACKUP_REMOTE_PATH`) ikke
fungerer → verifiser SSH-nøkler og mount-tilgjengelighet til remote.

---

### §11.7 DiskLow / DiskCritical

**Alert:** Disk fri <500 MB (warn) eller <100 MB (critical).

**Impact:** Critical → SQLite-skriving vil feile umiddelbart. `/ready`
returnerer 503 ved <100 MB.

**First-response:**
```bash
# Hvor går plassen?
sudo du -sh $APP_ROOT/data/*
df -h

# Prune gamle backups hvis >14 dager
find $APP_ROOT/data/backups -name "*.db" -mtime +14 -print -delete

# Prune journalctl hvis stort
sudo journalctl --vacuum-time=7d

# Rens npm-cache og gamle logs
npm cache clean --force 2>&1 || true
sudo rm -rf /var/log/*.gz
```

**Escalation:** Hvis disken er <1% → vurder å flytte data/ til SD
eller ekstern USB.

---

### §11.8 HighP95Latency

**Alert:** p95-latens >500 ms for en route i 10+ min.

**Impact:** Brukeropplevelse er tregere enn SLO. Ikke kritisk, men
merkbart for familie.

**First-response:**
```bash
# Hvilken route?
curl -s http://localhost:3000/metrics | grep -A1 "quantile=\"0.95\"" | grep -B1 -E "[0-9]{3}"

# EXPLAIN QUERY PLAN for hot spørringer
# Se docs/DB_INDEXES.md

# Er DB full?
ls -lh $APP_ROOT/data/familieassistenten.db
```

**Root-cause kandidater:**
- N+1-queries i ny kode
- Manglende index etter ny migration
- DB-lock fra backup-kjøring
- CPU-konkurranse fra LLM (Ollama-inferens)

**Escalation:** Rulle tilbake siste deploy hvis regresjon etter
release. Kjør `scripts/load-baseline.js --compare=perf-baseline.json`
for å kvantifisere.

---

## §12 Multi-tenant drift (uke 2 B1, 2026-04-20)

Multi-tenant-auth er aktiv fra og med commit `feat(auth): aktiver
multi-tenant session-flyt`. Dette avsnittet dekker de vanligste
drifts-oppgavene.

### §12.1 SESSION_SECRET — rotasjon

`SESSION_SECRET` signerer OAuth-state-cookies og magic-link-
tokener. Rotering invaliderer alle aktive sessions og alle
pågående innlogginger.

**Når rotere:**
- Hemmeligheten har lekket (logget til Sentry, committet i feil
  fil, delt i chat)
- Rutine-rotering (årlig anbefalt; ingen pålagt frekvens ennå)

**Rotere uten å rive hele appen:**

```bash
# 1. Generer ny hemmelighet
NEW=$(openssl rand -hex 32)

# 2. Oppdater bootstrap.json (beholder alle andre felt)
cd /var/lib/familyassistant/data   # eller der bootstrap.json ligger
jq --arg s "$NEW" '.sessionSecret = $s | .sessionSecretGeneratedAt = now | todate' bootstrap.json > bootstrap.json.new
chmod 600 bootstrap.json.new
mv bootstrap.json.new bootstrap.json

# 3. Restart container. Alle eksisterende sessions invalideres;
#    brukere må logge inn på nytt.
docker compose restart app
```

**Verifikasjon:** `GET /api/auth/me` fra en gammel browser-session
skal returnere `{authenticated: false}`.

### §12.2 Invitere en ny familie

Nye familier onboardes via invitasjon fra en eksisterende
familie-eier (owner-role).

```bash
# Som owner i family A:
curl -X POST http://<rpi>:7777/api/family/invitations \
  -H "Cookie: fa_session=<owner-session-id>" \
  -H "Content-Type: application/json" \
  -d '{"email": "ny-bruker@example", "role": "adult"}'

# Responsen inneholder { token }. Send lenken:
#   http://<rpi>:7777/invite/<token>
# til brukeren. De åpner den, logger inn (magic-link eller
# Google OAuth), og blir automatisk lagt til family A.
```

**Edge-case:** Hvis brukeren allerede er i en annen familie,
returnerer `POST /api/onboarding/create-family` 409 Conflict.
Brukeren må forlate sin gamle familie først (eller eieren
sletter den).

### §12.3 Debug "tenant-mismatch" — bruker ser feil familie

Symptom: Bruker B logger inn, ser data fra familie A.

Mulige årsaker i rekkefølge av sannsynlighet:

1. **Gammel service-worker-cache.** Bruker har ikke lastet
   nettleseren etter deploy. Be om hard-refresh (Ctrl+F5) eller
   inkognito-test.
2. **Feil session-cookie.** Sjekk DevTools → Application →
   Cookies → `fa_session`. Sammenlign med
   `SELECT user_id, family_id FROM sessions WHERE id='<sid>'`
   i DB.
3. **AsyncLocalStorage-lekkasje.** Hvis middleware ikke wrapper
   handler i `runWithFamily(familyId, ...)`, kan forrige
   requests family_id "lekke" inn. Se `server/auth/family-context.js`
   og søk etter ruter som ikke går gjennom authenticate().

### §12.4 Slette en familie

Kun owner kan slette. Alle data kaskade-slettes via
`repos.family.deleteFamily(id)` — inkludert shopping_lists,
pantry, meal_plans, chores, etc.

```bash
# Som owner:
curl -X DELETE http://<rpi>:7777/api/family \
  -H "Cookie: fa_session=<owner-session-id>"
```

**Advarsel:** irreversibelt. Ingen soft-delete. Hvis en familie
inneholder verdifulle oppskrifter (`source='family-modified'`),
vurder å eksportere dem via `GET /api/gdpr/export` først.

### §12.5 Når session er utløpt midt i bruk

User A sitter på UI, session utløper bakgrunnen. Neste request
bør returnere 401 og `public/js/auth.js` skal da dirigere
brukeren tilbake til `/login.html`. Verifiser at service-worker
evicter API-cachen ved 401 (se `public/sw.js:149`) slik at
forrige users data ikke lekker over.

### §12.6 Verifisere empirisk tenant-isolation

Etter hver auth-endring (C3 eller senere): gjennomfør
end-to-end-testen:

1. Åpne Chrome i normal modus, logg inn som User A, opprett
   Family A, legg til `banana` i pantry.
2. Åpne Firefox (eller Chrome inkognito med fresh cookies), logg
   inn som User B, opprett Family B, legg til `apple` i pantry.
3. Bytt tilbake til Chrome: `GET /api/pantry` skal kun vise
   banana, ikke apple.
4. Bytt til Firefox: `GET /api/pantry` skal kun vise apple, ikke
   banana.
5. Via SQLite:
   ```sql
   SELECT family_id, product_key, qty FROM inventory ORDER BY family_id;
   ```
   Skal vise to rader med forskjellige `family_id`.

Hvis 1-4 viser kryss-kontaminasjon: STOPP og rapporter. Det er
et regresjon i auth-middleware eller AsyncLocalStorage-wrapping.

