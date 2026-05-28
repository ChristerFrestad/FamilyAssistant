# Portainer Deploy Runbook

**Goal:** Deploy FamilyAssistant to Christer's RPi5 via Portainer + Cloudflare Tunnel for the pilot May 13-17, 2026.

---

## Prerequisites

- RPi5 8 GB with Raspberry Pi OS Lite (64-bit)
- Docker + Docker Compose installed
- Portainer CE installed (port 9000)
- Cloudflare account + tunnel configured to `app.familyassistant.com`
- Persistent volume mounted at `/srv/familyassistant-data/`

## Step 1 — Volume setup (one-time)

```bash
sudo mkdir -p /srv/familyassistant-data/data
sudo mkdir -p /srv/familyassistant-data/backups
sudo chown -R 65532:65532 /srv/familyassistant-data
```

UID 65532 = distroless `nonroot`. The container process must be able to write to the volume.

## Step 2 — Stack in Portainer

In Portainer: **Stacks → Add stack → Repository → Web editor**.

Paste `docker-compose.yml` from the repo. Change the volume mounts to absolute paths:

```yaml
volumes:
  - /srv/familyassistant-data/data:/app/data
  - /srv/familyassistant-data/backups:/app/backups
```

## Step 3 — Environment variables (Portainer → Stack → Environment)

### Pilot-specific (set before first deploy)

| Variable | Value | Rationale |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `7777` | Internal listen port |
| `APP_URL` | `https://app.familyassistant.com` | For magic-link absolute URLs |
| `APP_NAME` | `Husby` | White-label (AGENTS.md DEL 7.12) |
| `PILOT_MODE` | `true` | Enables pre-auth gate |
| `PILOT_PASSWORD` | `<chosen-string>` | Pilot user receives this separately |
| `APP_ADMIN_EMAIL` | `admin@example.com` | Admin-bootstrap target — first user matching this email becomes admin |
| `RESEND_API_KEY` | `<from Resend dashboard>` | Magic-link email |
| `RESEND_FROM` | `noreply@familyassistant.com` | Verified sender domain |
| `SESSION_SECRET` | `<openssl rand -hex 32>` | Or let the wizard generate |
| `AUTH_TOKEN` | (leave empty) | Bootstrap wizard generates |
| `BOOTSTRAP_ALLOWED` | `true` | (already set in compose) |
| `ALLOWED_ORIGINS` | `https://app.familyassistant.com` | CORS strict |
| `HTTPS_TERMINATED` | `true` (Cloudflare) / `false` (LAN) | See "HTTPS_TERMINATED Guidance" below |
| `TRUST_PROXY` | `true` | For real client IP |

### Optional / post-pilot

| Variable | Value | Rationale |
|---|---|---|
| `KASSAL_API_KEY` | (empty for pilot) | Enabled post-pilot |
| `SENTRY_DSN` | (empty for pilot) | Optional observability |
| `MAGIC_LINK_CONSOLE` | `false` | Only fallback if Resend goes down |

### Never set in pilot

| Variable | Rationale |
|---|---|
| `PILOT_BYPASS` | Disables auth — only for solo testing |
| `GOOGLE_CLIENT_ID` | Pilot is magic-link only |

## Step 4 — Cloudflare Tunnel

In the Cloudflare Zero Trust dashboard:
1. Create tunnel `familyassistant-pilot`
2. Public hostname: `app.familyassistant.com` → `http://<RPi-IP>:7777`
3. Copy the tunnel token (does not go in compose; runs as a separate service)

On the RPi:
```bash
cloudflared service install <TOKEN>
sudo systemctl enable --now cloudflared
```

## Step 5 — Deploy

In Portainer: **Update the stack** → the application is pulled from `ghcr.io/christerfrestad/familyassistant:main` and starts.

Wait for the healthcheck to turn green (~30 sec). Check the logs in Portainer.

## Step 6 — Verification

```bash
# Local LAN
curl http://<RPi-IP>:7777/health

# Via Cloudflare Tunnel
curl https://app.familyassistant.com/health
```

Should return `{"status":"ok",...}`.

Test the pilot gate:
```bash
curl -i https://app.familyassistant.com/api/pilot/status
# → { pilotMode: true, pilotAuthenticated: false }

curl -i -X POST https://app.familyassistant.com/api/auth/pilot-password \
  -H 'Content-Type: application/json' \
  -d '{"password":"WRONG"}'
# → 401 + { code: "wrong_password", attemptsRemaining: 4 }

curl -i -X POST https://app.familyassistant.com/api/auth/pilot-password \
  -H 'Content-Type: application/json' \
  -d '{"password":"<actual-password>"}'
# → 200 + Set-Cookie: fa_pilot=...
```

Open `https://app.familyassistant.com/v2/` in a browser → you see the PilotPasswordGate.

## Step 7 — Onboarding

After the pilot gate: the user receives a magic-link via Resend. Christer onboards first and becomes admin (APP_ADMIN_EMAIL match).

## Rollback

If a problem occurs after deploy:
1. **Disable pilot gate:** set `PILOT_MODE=false` in Portainer + restart stack
2. **Roll back to previous image:** set `TAG=sha-<prev>` in stack env, redeploy
3. **Full restart:** `docker compose down && docker compose up -d`

## Backup and Restore

A database backup is taken automatically every day at 03:00 UTC (cron in `server/cron.js`) to `/app/data/backups/`.

Manual backup:
```bash
docker exec familieassistenten node -e "require('./server/backup').backupNow().then(console.log)"
```

Restore (requires app to be down):
```bash
docker compose down
sudo cp /srv/familyassistant-data/backups/<file>.db \
        /srv/familyassistant-data/data/familieassistenten.db
docker compose up -d
```

## Pre-pilot Cleanup (one-time)

Christer runs this locally before the pilot deploy to clean up orphan family-1 data:

```bash
# Back up first
node -e "const Database = require('better-sqlite3'); \
  const src = require('better-sqlite3')('data/familieassistenten.db', {readonly:true}); \
  src.backup('data/familieassistenten-backup-pre-pilot.db').then(() => src.close());"

# Cleanup
node scripts/cleanup-orphan-family-1.js --dry-run  # preview
node scripts/cleanup-orphan-family-1.js            # execute
```

## Post-deploy Checklist

- [ ] /health returns 200
- [ ] /api/pilot/status returns `pilotMode: true`
- [ ] /v2/ shows the PilotPasswordGate
- [ ] The correct password sets the cookie and lets the user through
- [ ] Magic-link email arrives from `noreply@familyassistant.com`
- [ ] Christer becomes admin on the first onboarding
- [ ] Backup cron runs at 03:00 UTC (check the next day)

---

## HTTPS_TERMINATED Guidance

Cookie Secure-flag handling is driven by the `isSecureRequest()` helper in `server/auth/sessions.js`. It checks, in order:

1. `HTTPS_TERMINATED=true` env flag (explicit operator opt-in)
2. `X-Forwarded-Proto: https` request header (Cloudflare Tunnel and most reverse proxies set this automatically)
3. `socket.encrypted === true` (direct HTTPS without a proxy)

If none of these is true, the `Secure` flag is NOT set on cookies — correct for plain-HTTP deploys because browsers would otherwise drop the cookie silently.

### What value should `HTTPS_TERMINATED` have?

| Deploy type | Value | Rationale |
|---|---|---|
| Cloudflare Tunnel + custom domain | `true` | Insurance — the app can know that HTTPS is terminated somewhere before the request arrives (Cloudflare → tunnel → app over HTTP). `X-Forwarded-Proto` is also set, but the explicit env flag is more robust against proxy misconfiguration. |
| LAN pilot (`http://192.168.x.y:7777`) | `false` (or omitted) | Uses plain HTTP. The `Secure` flag would cause browsers to drop cookies. |
| Caddy/nginx proxy with TLS | `true` (recommended) or let `X-Forwarded-Proto` handle it | Both work; an explicit env flag is less fragile against proxy config errors. |
| Direct HTTPS without proxy | (either) | `socket.encrypted` is set automatically. No env flag required. |

### Common misconfig: HTTPS_TERMINATED=true on an HTTP deploy

If Christer sets `HTTPS_TERMINATED=true` on a LAN deploy that uses plain HTTP, cookies are sent with the `Secure` flag and browsers drop them silently. The pilot gate and session will not work. Symptom: `POST /api/auth/pilot-password` returns 200, but the next request gets 403 because the cookie was not persisted.

**Rule of thumb:** If the URL starts with `http://`, set `HTTPS_TERMINATED=false` (or omit it). If `https://`, set `true`.

## Troubleshooting

### Service worker from the v1 era serves cached content

**Symptom:** After the Sprint 8 v1 cleanup deploy, the user still sees
old v1 screens (Chat / Weekly menu / Shopping) even though the image is
updated. DevTools shows that a service worker from the v1 era still
intercepts requests.

**Verification:**

DevTools → Application → Service Workers:
- If an SW shows with "active" status and source `/sw.js`, check the
  script's content via the "Source" tab. If it is the tombstone version
  (Sprint 8) it is in the process of unregistering itself.
- After the first load + reload, the SW list should be empty.

**Root cause (by design — Sprint 8 tombstone):**
The v1 service worker pre-cached HTML/JS/CSS. A plain delete of
`public/sw.js` would have left existing browsers with a stale cache
for an unknown duration. Sprint 8 replaced sw.js with a tombstone that
unregisters + reloads clients on the first visit after deploy.

**Solution:**
1. Ask the user to hard-reload (Ctrl+Shift+R) — forces a fresh SW fetch
2. Or: the user waits a second after the next visit (the tombstone
   activate handler runs + reloads automatically)
3. Verify in DevTools that the SW is gone after reload

**Permanent cleanup (post-pilot):** after 3-6 months, the tombstone
can be deleted entirely. Tracked in `docs/workflow/post-pilot-code-debt-cleanup.md`.

### `GET /` shows the legacy v1 frontend or returns 401

**Symptom:**
- In browsers with a stale session cookie: `GET /` → 200 OK with legacy v1 (Chat / Weekly menu / Shopping / Chores / Control room)
- In browsers without cookies: `GET /` → 401 "Authentication required"
- Expected: 302 redirect to `/v2/` to land on the pilot frontend

**Verification:**

```bash
# Anonymous
curl -i http://<deploy>:7777/ | head -3
# Expected: HTTP/1.1 302 Found, Location: /v2/

# With session cookie
curl -i -H 'Cookie: fa_session=...' http://<deploy>:7777/ | head -3
# Expected: HTTP/1.1 302 Found, Location: /v2/
```

**Root cause (fixed 2026-05-04 in fix/root-redirect-to-v2):**
Earlier versions had no early intercept for `GET /`. Authenticated visitors fell through to `tryServeSpaFallback()` which serves `public/index.html` (legacy v1). Anonymous visitors with AUTH_TOKEN set got 401 from auth middleware.

**Fix:** `server/http/server.js` now catches `GET /` right after CORS headers and emits `302 Location: /v2/` before rate-limit, auth, or routing runs. Cookie-independent.

**If you still see the symptom:**
1. Verify that the image is built after commit `<post-redirect-fix-sha>`
2. `docker compose pull && docker compose up -d --force-recreate familieassistenten`
3. Hard-reload the browser (cached redirects often linger) or test with `curl`

**Legacy v1 still available at explicit paths:**
- `http://<deploy>:7777/index.html` — legacy SPA shell (requires auth)
- `http://<deploy>:7777/login.html` — legacy login
- `http://<deploy>:7777/js/*`, `/css/*` — legacy assets
- Not used in pilot, but kept for backwards compatibility and diagnostics

### Cookies (fa_pilot, fa_session) are not set in the browser after login

**Symptom:**
- `POST /api/auth/pilot-password` returns 200, but later requests get 403
- Browser `Application → Cookies → http://<deploy>` shows NO `fa_pilot` cookie
- Magic-link onboarding fails in the same way (no `fa_session`)

**Verification:**

```bash
# Check the Set-Cookie header in the response
curl -i -X POST http://<deploy>/api/auth/pilot-password \
  -H 'Content-Type: application/json' \
  -d '{"password":"<actual-password>"}'
```

In the response headers, look for `Set-Cookie: fa_pilot=...; ...`:

- If the cookie has `; Secure;` on an HTTP deploy → mismatch, the browser drops the cookie
- If the cookie does NOT have `; Secure;` on an HTTPS deploy → less secure, but works. Set `HTTPS_TERMINATED=true`

**Root cause (fixed 2026-05-04 in fix/cookie-secure-flag-http-deploy):**
Earlier versions set `Secure` on all cookies when `NODE_ENV=production`, regardless of whether the connection was HTTP or HTTPS. Plain-HTTP deploys (LAN pilot, dev-staging) had cookies dropped by the browser.

**Fix:** The `Secure` flag is now set based on the `isSecureRequest()` helper that reads the `HTTPS_TERMINATED` env flag, the `X-Forwarded-Proto` header, and `socket.encrypted`. See "HTTPS_TERMINATED Guidance" above.

**If you still see the symptom:**
1. Verify the image is built after commit `<post-cookie-fix-sha>`
2. Check env config — `HTTPS_TERMINATED` matches the actual deployment (HTTP/HTTPS)
3. `docker compose pull && docker compose up -d --force-recreate familieassistenten`
4. Test with the curl command above to see the actual Set-Cookie header

### `/v2/` shows the legacy v1 frontend (Chat / Weekly menu / Shopping)

**Symptom:** The user goes to `/v2/` and expects `PilotPasswordGate`,
but instead sees the legacy frontend with the "FamilyAssistant" logo and
sidebar (Chat, Weekly menu, Today, Shopping, Chores, Control room).

**Verification:**
```bash
docker exec familieassistenten ls -la /app/public/v2/
```
If output is `No such file or directory` → bundle missing in the image.

**Root cause (fixed 2026-05-04 in fix/dockerfile-build-v2-frontend):**
The v2 React bundle (`public/v2/`) is `.gitignored` in source, and earlier
Dockerfile versions did not run `npm run build:client`. The image shipped
to GHCR had an empty `public/v2/` directory; `tryServeV2App()` fell back
to the legacy SPA handler which serves `public/index.html` (v1).

**Fix:** `Dockerfile` now has a `frontend-builder` stage that runs
`npm run build:client` during image build. The backend-builder copies
the bundle in via `COPY --from=frontend-builder /build/public/v2`.

**If you still see the symptom:**
1. Verify that the image is built after commit `<post-fix-sha>` —
   check `docker inspect familieassistenten | grep org.opencontainers.image.revision`
2. `docker compose pull` to fetch a fresh image from `:main`
3. `docker compose up -d --force-recreate familieassistenten`
4. Verify: `docker exec familieassistenten ls /app/public/v2/`
   should show `index.html` + `assets/`
5. Test: `curl -s http://localhost:7777/v2/ | grep 'main-.*\.js'`
   should return a `<script>` tag pointing to a hashed bundle file

### "401 Unauthorized" in an endless loop on first deploy

**Symptom:** Container starts (healthcheck green, all migrations run), but:
- `GET /` → 302 redirect to `/v2/`
- `GET /v2/` → 401 `{"title":"Unauthorized","instance":"/v2/"}`
- `GET /login.html` → 302 to `/v2/` → 401
- The user is stuck in a loop and never reaches the pilot password form

**Root cause (fixed 2026-05-04 in fix/pilot-gate-lockout):**
Earlier versions had an auth middleware design where the `/v2/` bundle was in the pilot-gate bypass list BUT not in the public-paths list. With `AUTH_TOKEN` set (all prod deploys), the authentication chain blocked the bundle with 401 before the React app could load and render PilotPasswordGate.

**Fix:**
`server/auth/middleware.js` `isPublicPath()` now returns `true` for:
- `/v2`, `/v2/`, `/v2/index.html`
- `/v2/assets/*`
- `/api/pilot/status` and `/api/auth/pilot-password`

Frontend guards (PilotGuard → AuthGuard → OnboardingGuard) handle auth state after the bundle is loaded.

**If you still see the symptom:**
1. Verify that the image is on `:main` or newer than commit `<post-fix-sha>`
2. `docker compose pull` to fetch a fresh image
3. `docker compose up -d --force-recreate familieassistenten`
4. Test: `curl https://<deploy>/v2/` → must return 200 and the HTML bundle

### Pilot password is not accepted

**Check:**
- `PILOT_PASSWORD` env var is exactly the same value (case-sensitive, no whitespace)
- Rate limit not triggered: 5 attempts per IP per 10 minutes. `docker logs familieassistenten | grep pilot_password_attempts`
- Check the pilot cookie: `document.cookie` in the browser console must show `fa_pilot=...`

**Reset rate limit:** Restart the container (`docker compose restart`). In-memory state is reset.

### Magic-link does not arrive

**If `MAGIC_LINK_CONSOLE=true`:** see `docker logs familieassistenten | grep "MAGIC LINK"` for the URL.

**If Resend should be active:** verify `RESEND_API_KEY` + `RESEND_FROM` are set and `MAGIC_LINK_CONSOLE` is NOT set (or is `false`).

### Magic-link fails with 403 in a new browser

**Confirmed design (not a bug):** `/api/auth/magic-link/verify` is NOT in the pilot-gate bypass. The user must first enter the pilot password in the same browser, then click the magic-link. This is a pragmatic pilot choice — it preserves the purpose of the pilot gate.

If the user tries to click the magic-link in a new browser without a pilot cookie: 403. Ask the user to first open the app domain, enter the pilot password, then click the link.
