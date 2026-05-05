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
| `HTTPS_TERMINATED` | `true` (Cloudflare) / `false` (LAN) | Se "HTTPS_TERMINATED-veiledning" under |
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

---

## HTTPS_TERMINATED-veiledning

Cookie-Secure-flag-håndtering er drevet av `isSecureRequest()`-helper i `server/auth/sessions.js`. Denne sjekker i rekkefølge:

1. `HTTPS_TERMINATED=true` env-flagg (eksplisitt operatør-opt-in)
2. `X-Forwarded-Proto: https` request-header (Cloudflare Tunnel + de fleste reverse-proxyer setter denne automatisk)
3. `socket.encrypted === true` (direkte HTTPS uten proxy)

Hvis ingen av disse er sant, settes IKKE `Secure`-flag på cookies — riktig for plain-HTTP-deploy fordi browsere ellers ville droppe cookien stille.

### Hvilken verdi skal `HTTPS_TERMINATED` ha?

| Deploy-type | Verdi | Begrunnelse |
|---|---|---|
| Cloudflare Tunnel + custom domain | `true` | Forsikring — appen kan vite at HTTPS termineres et eller annet sted før requesten kommer frem (Cloudflare → tunnel → app over HTTP). `X-Forwarded-Proto` settes også, men eksplisitt env-flag er mer robust ved misconfig av proxy. |
| LAN-pilot (`http://192.168.x.y:7777`) | `false` (eller utelatt) | Bruker plain HTTP. `Secure`-flag ville fått browsere til å droppe cookies. |
| Caddy/nginx-proxy med TLS | `true` (anbefalt) eller la `X-Forwarded-Proto` håndtere | Begge funksjoner; eksplisitt env-flag er mindre fragilt mot proxy-config-feil. |
| Direkte HTTPS uten proxy | (uansett) | `socket.encrypted` settes automatisk. Ingen env-flag nødvendig. |

### Vanlig feilkonfig: HTTPS_TERMINATED=true på HTTP-deploy

Hvis Christer setter `HTTPS_TERMINATED=true` på en LAN-deploy som bruker plain HTTP, vil cookies sendes med `Secure`-flag og browsere dropper dem stille. Pilot-gate og session vil ikke virke. Symptom: `POST /api/auth/pilot-password` returnerer 200, men neste request får 403 fordi cookien ikke persisterte.

**Tommelfingerregel:** Hvis URL-en starter med `http://`, sett `HTTPS_TERMINATED=false` (eller utelat). Hvis `https://`, sett `true`.

## Troubleshooting

### Service worker fra v1-æra serverer cached innhold

**Symptom:** Etter Sprint 8 v1-cleanup deploy ser bruker fortsatt
gamle v1-skjermer (Chat / Ukesmeny / Handletur) selv om imaget er
oppdatert. DevTools viser at en service worker fra v1-æra fortsatt
intercepter requests.

**Verifisering:**

DevTools → Application → Service Workers:
- Hvis det vises en SW med "active" status og kilde `/sw.js`, sjekk
  scriptens innhold via "Source"-tab. Hvis det er tombstone-versjonen
  (Sprint 8) er den i ferd med å unregistrere seg.
- Etter første load + reload skal SW-listen være tom.

**Rotårsak (by design — Sprint 8 tombstone):**
V1's service worker pre-cachet HTML/JS/CSS. Plain delete av
`public/sw.js` ville etterlatt eksisterende browsere med stale cache
i ukjent tidsrom. Sprint 8 erstattet sw.js med tombstone som
unregistrerer + reloader klienter ved første besøk etter deploy.

**Løsning:**
1. Be bruker hard-reloade (Ctrl+Shift+R) — tvinger ny SW-fetch
2. Eller: bruker venter ett sekund etter neste besøk (tombstone
   activate-handler kjører + reloader automatisk)
3. Verifiser i DevTools at SW er borte etter reload

**Permanent cleanup (post-pilot):** etter 3-6 måneder kan tombstone
slettes helt. Tracked i `docs/workflow/post-pilot-code-debt-cleanup.md`.

### `GET /` viser legacy v1-frontend eller returnerer 401

**Symptom:**
- I browsere med stale session-cookie: `GET /` → 200 OK med legacy v1 (Chat / Ukesmeny / Handletur / Husarbeid / Kontrollrommet)
- I browsere uten cookies: `GET /` → 401 "Authentication required"
- Forventet: 302 redirect til `/v2/` for å lande på pilot-frontend

**Verifisering:**

```bash
# Anonym
curl -i http://<deploy>:7777/ | head -3
# Forventet: HTTP/1.1 302 Found, Location: /v2/

# Med session-cookie
curl -i -H 'Cookie: fa_session=...' http://<deploy>:7777/ | head -3
# Forventet: HTTP/1.1 302 Found, Location: /v2/
```

**Rotårsak (fixed 2026-05-04 i fix/root-redirect-to-v2):**
Tidligere versjoner hadde ingen tidlig intercept for `GET /`. Authenticated visitors falt gjennom til `tryServeSpaFallback()` som serverer `public/index.html` (legacy v1). Anonymous visitors med AUTH_TOKEN satt fikk 401 fra auth-middleware.

**Fix:** `server/http/server.js` fanger nå `GET /` rett etter CORS-headere og emitter `302 Location: /v2/` før rate-limit, auth eller routing kjører. Cookie-uavhengig.

**Hvis du fortsatt ser symptomet:**
1. Verifiser at imaget er bygd etter commit `<post-redirect-fix-sha>`
2. `docker compose pull && docker compose up -d --force-recreate familieassistenten`
3. Hard-reload browseren (ofte cached redirects sitter igjen) eller test med `curl`

**Legacy v1 fortsatt tilgjengelig på eksplisitte stier:**
- `http://<deploy>:7777/index.html` — legacy SPA-shell (krever auth)
- `http://<deploy>:7777/login.html` — legacy login
- `http://<deploy>:7777/js/*`, `/css/*` — legacy assets
- Brukes ikke i pilot, men beholdes for backwards compatibility og diagnostikk

### Cookies (fa_pilot, fa_session) settes ikke i browser etter login

**Symptom:**
- `POST /api/auth/pilot-password` returnerer 200, men senere requests får 403
- Browser `Application → Cookies → http://<deploy>` viser INGEN `fa_pilot`-cookie
- Magic-link-onboarding feiler på tilsvarende måte (ingen `fa_session`)

**Verifisering:**

```bash
# Sjekk Set-Cookie-header i response
curl -i -X POST http://<deploy>/api/auth/pilot-password \
  -H 'Content-Type: application/json' \
  -d '{"password":"<ekte-passord>"}'
```

I respons-headere, se etter `Set-Cookie: fa_pilot=...; ...`:

- Hvis cookien har `; Secure;` på en HTTP-deploy → mismatch, browser dropper cookien
- Hvis cookien IKKE har `; Secure;` på en HTTPS-deploy → mindre sikker, men virker. Sett `HTTPS_TERMINATED=true`

**Rotårsak (fixed 2026-05-04 i fix/cookie-secure-flag-http-deploy):**
Tidligere versjoner satte `Secure` på alle cookies når `NODE_ENV=production`, uansett om connection var HTTP eller HTTPS. Plain-HTTP-deploys (LAN-pilot, dev-staging) fikk cookies droppet av browseren.

**Fix:** `Secure`-flag settes nå basert på `isSecureRequest()`-helper som leser `HTTPS_TERMINATED` env-flag, `X-Forwarded-Proto`-header, og `socket.encrypted`. Se "HTTPS_TERMINATED-veiledning" over.

**Hvis du fortsatt ser symptomet:**
1. Verifiser image er bygd etter commit `<post-cookie-fix-sha>`
2. Sjekk env-config — `HTTPS_TERMINATED` matcher faktisk deployment (HTTP/HTTPS)
3. `docker compose pull && docker compose up -d --force-recreate familieassistenten`
4. Test med curl over for å se faktisk Set-Cookie-header

### `/v2/` viser legacy v1-frontend (Chat / Ukesmeny / Handletur)

**Symptom:** Bruker går til `/v2/` og forventer `PilotPasswordGate`,
men ser i stedet legacy-frontend med "Familieassistenten"-logo og
sidebar (Chat, Ukesmeny, I dag, Handletur, Husarbeid, Kontrollrommet).

**Verifisering:**
```bash
docker exec familieassistenten ls -la /app/public/v2/
```
Hvis output er `No such file or directory` → bundle mangler i imaget.

**Rotårsak (fixed 2026-05-04 i fix/dockerfile-build-v2-frontend):**
v2 React-bundle (`public/v2/`) er `.gitignored` i kilde, og tidligere
Dockerfile-versjoner kjørte ikke `npm run build:client`. Image shipped
til GHCR hadde tom `public/v2/`-mappe; `tryServeV2App()` falt tilbake
til legacy SPA-handler som serverer `public/index.html` (v1).

**Fix:** `Dockerfile` har nå en `frontend-builder`-stage som kjører
`npm run build:client` under image-build. Backend-builder kopierer
bundle inn via `COPY --from=frontend-builder /build/public/v2`.

**Hvis du fortsatt ser symptomet:**
1. Verifiser at imaget er bygget etter commit `<post-fix-sha>` —
   sjekk `docker inspect familieassistenten | grep org.opencontainers.image.revision`
2. `docker compose pull` for å hente fersk image fra `:main`
3. `docker compose up -d --force-recreate familieassistenten`
4. Verifiser: `docker exec familieassistenten ls /app/public/v2/`
   skal vise `index.html` + `assets/`
5. Test: `curl -s http://localhost:7777/v2/ | grep 'main-.*\.js'`
   skal returnere en `<script>`-tag som peker på en hashet bundle-fil

### "401 Unauthorized" i endeløs loop på første deploy

**Symptom:** Container starter (healthcheck grønn, alle migrasjoner kjører), men:
- `GET /` → 302 redirect til `/v2/`
- `GET /v2/` → 401 `{"title":"Unauthorized","instance":"/v2/"}`
- `GET /login.html` → 302 til `/v2/` → 401
- Bruker fast i loop, kommer aldri til pilot-passord-form

**Rotårsak (fixed 2026-05-04 i fix/pilot-gate-lockout):**
Tidligere versjoner hadde et auth-middleware-design der `/v2/`-bundle var i pilot-gate-bypass-listen MEN ikke i public-paths-listen. Med `AUTH_TOKEN` satt (alle prod-deploys) blokkerte autentiserings-kjeden bundle-en med 401 før React-app kunne laste og rendre PilotPasswordGate.

**Fix:**
`server/auth/middleware.js` `isPublicPath()` returnerer nå `true` for:
- `/v2`, `/v2/`, `/v2/index.html`
- `/v2/assets/*`
- `/api/pilot/status` og `/api/auth/pilot-password`

Frontend-Guards (PilotGuard → AuthGuard → OnboardingGuard) håndterer auth-state etter at bundle er lastet.

**Hvis du fortsatt ser symptomet:**
1. Verifiser at image er på `:main` eller nyere enn commit `<post-fix-sha>`
2. `docker compose pull` for å hente fersk image
3. `docker compose up -d --force-recreate familieassistenten`
4. Test: `curl https://<deploy>/v2/` → må returnere 200 og HTML-bundle

### Pilot-passord aksepteres ikke

**Sjekk:**
- `PILOT_PASSWORD` env-var er nøyaktig samme verdi (case-sensitive, ingen whitespace)
- Rate-limit ikke trigget: 5 attempts per IP per 10 minutter. `docker logs familieassistenten | grep pilot_password_attempts`
- Sjekk pilot-cookie: `document.cookie` i browser console må vise `fa_pilot=...`

**Reset rate-limit:** Restart container (`docker compose restart`). In-memory state nullstilles.

### Magic-link kommer ikke

**Hvis `MAGIC_LINK_CONSOLE=true`:** se `docker logs familieassistenten | grep "MAGIC LINK"` for URL.

**Hvis Resend skal være aktiv:** verifiser `RESEND_API_KEY` + `RESEND_FROM` er satt og `MAGIC_LINK_CONSOLE` IKKE er satt (eller er `false`).

### Magic-link feiler med 403 i ny browser

**Bekreftet design (ikke bug):** `/api/auth/magic-link/verify` er IKKE i pilot-gate-bypass. Brukeren må først skrive pilot-passord i samme browser, deretter klikke magic-link. Dette er pragmatisk pilot-valg — bevarer pilot-gate-formålet.

Hvis brukeren forsøker å klikke magic-link i ny browser uten pilot-cookie: 403. Be brukeren først åpne app-domenet, skrive pilot-passord, deretter klikke link.
