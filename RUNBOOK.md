# Familieassistenten — Runbook

**Sist oppdatert:** 2026-04-10
**Målgruppe:** Christer (operatør). Dette dokumentet er for feilsøking og
daglig drift av Familieassistenten på Raspberry Pi 5.

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

- **Lokal:** `/home/pi/Familieassistenten/data/backups/familieassistenten-YYYY-MM-DD.db`
- **Off-site:** avhenger av `BACKUP_REMOTE_PATH` i service-env (NAS-mount, SSH-host, rsync-daemon)
- **Schedule:** daglig kl. 03:00, beholder 14 dager
- **På shutdown:** en siste backup tas automatisk før DB stenger

### 2.2 Ta backup manuelt

```bash
# Enkleste — kaller samme backupNow() som cron
sudo systemctl stop familieassistenten
cp /home/pi/Familieassistenten/data/familieassistenten.db \
   /home/pi/Familieassistenten/data/backups/manual-$(date +%F).db
sudo systemctl start familieassistenten
```

Eller via en SQL-konsoll mot live DB (trygt på better-sqlite3):

```bash
sqlite3 /home/pi/Familieassistenten/data/familieassistenten.db \
  "VACUUM INTO '/home/pi/Familieassistenten/data/backups/manual-$(date +%F).db'"
```

### 2.3 Restore fra backup

```bash
# 1. Stopp serveren
sudo systemctl stop familieassistenten

# 2. Lag en safety-kopi av nåværende DB (før du skriver over)
cp /home/pi/Familieassistenten/data/familieassistenten.db \
   /home/pi/Familieassistenten/data/familieassistenten.db.pre-restore

# 3. Kopier backupen inn
cp /home/pi/Familieassistenten/data/backups/familieassistenten-2026-04-09.db \
   /home/pi/Familieassistenten/data/familieassistenten.db
chown pi:pi /home/pi/Familieassistenten/data/familieassistenten.db

# 4. Start serveren
sudo systemctl start familieassistenten

# 5. Verifiser
curl -s http://localhost:3000/ready | jq
journalctl -u familieassistenten -n 20 --no-pager | grep -i 'migrasjon\|ready\|error'
```

**Hvis restore feiler:** flytt tilbake safety-kopien:
```bash
mv /home/pi/Familieassistenten/data/familieassistenten.db.pre-restore \
   /home/pi/Familieassistenten/data/familieassistenten.db
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
ls -lh /home/pi/Familieassistenten/data/backups/

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
cd /home/pi/Familieassistenten

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
grep -E '^(KASSAL|OPENAI|ANTHROPIC|XAI)_API_KEY=' /home/pi/Familieassistenten/.env | cut -d= -f1

# Rediger trygt
sudo nano /home/pi/Familieassistenten/.env
# Permissions skal være 600 og eier pi:pi
ls -l /home/pi/Familieassistenten/.env

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
5. Kopier backup inn: `cp backup.db /home/pi/Familieassistenten/data/familieassistenten.db`
6. Gjenopprett `.env`, `AUTH_TOKEN` og Caddy-config
7. Start: `sudo systemctl start familieassistenten`

### 7.2 "DB er korrupt"

```bash
# Sjekk integritet
sqlite3 /home/pi/Familieassistenten/data/familieassistenten.db "PRAGMA integrity_check;"

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
cd /home/pi/Familieassistenten && npm test

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
