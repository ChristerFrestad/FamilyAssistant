# Portainer Deploy Runbook

**Mål:** Deploy FamilyAssistant til Christers RPi5 via Portainer + Cloudflare Tunnel for pilot 13–17. mai 2026.

---

## Forutsetninger

- RPi5 8 GB med Raspberry Pi OS Lite (64-bit)
- Docker + Docker Compose installert
- Portainer CE installert (port 9000)
- Cloudflare-konto + tunnel konfigurert til `app.hverdagsplanleggeren.com`
- Persistent volume mounted på `/home/christer/familieassistenten-data/`

## Steg 1 — Volume-oppsett (én gang)

```bash
sudo mkdir -p /home/christer/familieassistenten-data/data
sudo mkdir -p /home/christer/familieassistenten-data/backups
sudo chown -R 65532:65532 /home/christer/familieassistenten-data
```

UID 65532 = distroless `nonroot`. Container-prosessen må kunne skrive til volumet.

## Steg 2 — Stack i Portainer

I Portainer: **Stacks → Add stack → Repository → Web editor**.

Lim inn `docker-compose.yml` fra repoet. Endre volume-mountene til absolute path:

```yaml
volumes:
  - /home/christer/familieassistenten-data/data:/app/data
  - /home/christer/familieassistenten-data/backups:/app/backups
```

## Steg 3 — Environment variables (Portainer → Stack → Environment)

### Pilot-spesifikt (sett før første deploy)

| Variable | Verdi | Begrunnelse |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `7777` | Internal listen-port |
| `APP_URL` | `https://app.hverdagsplanleggeren.com` | For magic-link absolute URLs |
| `APP_NAME` | `Hverdagsplanleggeren` | White-label (CLAUDE.md DEL 7.12) |
| `PILOT_MODE` | `true` | Aktiverer pre-auth gate |
| `PILOT_PASSWORD` | `<chosen-string>` | Pilot-bruker får denne separat |
| `APP_ADMIN_EMAIL` | `christer@frestad.com` | Admin-bootstrap target |
| `RESEND_API_KEY` | `<from Resend dashboard>` | Magic-link email |
| `RESEND_FROM` | `noreply@hverdagsplanleggeren.com` | Verified sender domain |
| `SESSION_SECRET` | `<openssl rand -hex 32>` | Eller la wizard generere |
| `AUTH_TOKEN` | (la stå tom) | Bootstrap wizard genererer |
| `BOOTSTRAP_ALLOWED` | `true` | (allerede satt i compose) |
| `ALLOWED_ORIGINS` | `https://app.hverdagsplanleggeren.com` | CORS strict |
| `HTTPS_TERMINATED` | `true` | Bak Cloudflare Tunnel |
| `TRUST_PROXY` | `true` | For ekte client-IP |

### Optional / post-pilot

| Variable | Verdi | Begrunnelse |
|---|---|---|
| `KASSAL_API_KEY` | (tom for pilot) | Aktiveres post-pilot |
| `SENTRY_DSN` | (tom for pilot) | Optional observability |
| `MAGIC_LINK_CONSOLE` | `false` | Kun fallback hvis Resend faller |

### Aldri sett i pilot

| Variable | Begrunnelse |
|---|---|
| `PILOT_BYPASS` | Deaktiverer auth — kun for solo-test |
| `GOOGLE_CLIENT_ID` | Pilot er kun magic-link |

## Steg 4 — Cloudflare Tunnel

I Cloudflare Zero Trust dashboard:
1. Lag tunnel `familyassistant-pilot`
2. Public hostname: `app.hverdagsplanleggeren.com` → `http://<RPi-IP>:7777`
3. Kopier tunnel-token (kommer ikke i compose; kjøres som separat tjeneste)

På RPi:
```bash
cloudflared service install <TOKEN>
sudo systemctl enable --now cloudflared
```

## Steg 5 — Deploy

I Portainer: **Update the stack** → applikasjonen pulles fra `ghcr.io/christerfrestad/familyassistant:main` og starter.

Vent på healthcheck grønn (~30 sek). Sjekk logs i Portainer.

## Steg 6 — Verifisering

```bash
# Lokal LAN
curl http://<RPi-IP>:7777/health

# Via Cloudflare Tunnel
curl https://app.hverdagsplanleggeren.com/health
```

Skal returnere `{"status":"ok",...}`.

Test pilot-gate:
```bash
curl -i https://app.hverdagsplanleggeren.com/api/pilot/status
# → { pilotMode: true, pilotAuthenticated: false }

curl -i -X POST https://app.hverdagsplanleggeren.com/api/auth/pilot-password \
  -H 'Content-Type: application/json' \
  -d '{"password":"WRONG"}'
# → 401 + { code: "wrong_password", attemptsRemaining: 4 }

curl -i -X POST https://app.hverdagsplanleggeren.com/api/auth/pilot-password \
  -H 'Content-Type: application/json' \
  -d '{"password":"<ekte-passord>"}'
# → 200 + Set-Cookie: fa_pilot=...
```

Åpne `https://app.hverdagsplanleggeren.com/v2/` i nettleser → ser PilotPasswordGate.

## Steg 7 — Onboarding

Etter pilot-gate: bruker får magic-link via Resend. Christer onboarder først, blir admin (APP_ADMIN_EMAIL match).

## Rollback

Hvis problem etter deploy:
1. **Disable pilot gate:** sett `PILOT_MODE=false` i Portainer + restart stack
2. **Rollback til forrige image:** sett `TAG=sha-<prev>` i stack env, redeploy
3. **Komplett restart:** `docker compose down && docker compose up -d`

## Backup-restore

Database backup tas automatisk daglig kl 03:00 UTC (cron i `server/cron.js`) til `/app/data/backups/`.

Manuell backup:
```bash
docker exec familieassistenten node -e "require('./server/backup').backupNow().then(console.log)"
```

Restore (krever app-down):
```bash
docker compose down
sudo cp /home/christer/familieassistenten-data/backups/<file>.db \
        /home/christer/familieassistenten-data/data/familieassistenten.db
docker compose up -d
```

## Pre-pilot-cleanup (engangs)

Christer kjører lokalt før pilot-deploy for å rydde orphan family-1 data:

```bash
# Backup først
node -e "const Database = require('better-sqlite3'); \
  const src = require('better-sqlite3')('data/familieassistenten.db', {readonly:true}); \
  src.backup('data/familieassistenten-backup-pre-pilot.db').then(() => src.close());"

# Cleanup
node scripts/cleanup-orphan-family-1.js --dry-run  # preview
node scripts/cleanup-orphan-family-1.js            # execute
```

## Post-deploy sjekkliste

- [ ] /health returnerer 200
- [ ] /api/pilot/status returnerer `pilotMode: true`
- [ ] /v2/ viser PilotPasswordGate
- [ ] Riktig passord setter cookie og slipper inn
- [ ] Magic-link email kommer fra `noreply@hverdagsplanleggeren.com`
- [ ] Christer blir admin på første onboarding
- [ ] Backup-cron kjører kl 03:00 UTC (sjekk dag etter)
