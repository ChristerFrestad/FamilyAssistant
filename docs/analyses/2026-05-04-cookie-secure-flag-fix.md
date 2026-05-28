# Analysis: Cookie Secure flag blocks cookies on HTTP deploys

Date: 2026-05-04
Branch: `fix/cookie-secure-flag-http-deploy`
Severity: **CRITICAL — pilot-launch blocker**

## Symptom

After PR #114 (pilot-gate auth fix) and PR #115 (v2-bundle in image)
landed, Christer redeployed to RPi5 over LAN HTTP
(`http://&lt;rpi-lan-ip&gt;:7777`). The pilot-password gate now renders
correctly (`/v2/` serves the React shell, `PilotPasswordGate` mounts,
`/api/pilot/status` is reachable). The pilot password is accepted —
`POST /api/auth/pilot-password` returns 200.

But the very next request (`POST /api/auth/magic-link/start`) returns
**403 "Pilot password required."** The pilot-gate sees no `fa_pilot`
cookie on the incoming request and rejects.

Browser inspection (Application → Cookies → http://&lt;rpi-lan-ip&gt;:7777)
shows that **`fa_pilot` is not in the cookie jar at all**. Only
unrelated Portainer cookies are present.

## Root cause

`server/auth/routes.js:510` (and four other call-sites) sets cookies
with:

```js
secure: config.NODE_ENV === 'production',
```

Christer's pilot-LAN deploy runs with `NODE_ENV=production` over plain
HTTP. The server emits

```
Set-Cookie: fa_pilot=...; Path=/; HttpOnly; Secure; SameSite=Lax
```

but browsers silently drop a cookie with the `Secure` attribute when
the connection is plain HTTP. The cookie never persists. Every
subsequent request lacks the cookie → pilot-gate 403 → loop.

The same antipattern exists on three cookies / four call-sites:

| Cookie | File | Line | Code |
|---|---|---|---|
| `fa_pilot` | `server/auth/routes.js` | 510 | `secure: config.NODE_ENV === 'production'` |
| `fa_session` (set) | `server/auth/sessions.js` | 41 | `secure: isSecureRequest(req) \|\| config.NODE_ENV === 'production'` |
| `fa_session` (clear) | `server/auth/sessions.js` | 52 | same as above |
| `fa_oauth_state` | `server/auth/routes.js` | 102 | `secure: config.NODE_ENV === 'production'` |

The session-cookie variant is particularly subtle: the helper
`isSecureRequest(req)` is *already* correct (it checks
`HTTPS_TERMINATED`, `x-forwarded-proto`, and `socket.encrypted`), but
the `|| config.NODE_ENV === 'production'` short-circuit forces
`Secure: true` in any production deploy — overriding the helper's
careful detection.

## Why it never showed up in tests

Existing tests run with `NODE_ENV=test`, so the `=== 'production'`
short-circuit returns `false` and cookies are emitted without
`Secure`. The bug only manifests when `NODE_ENV=production` AND the
connection is plain HTTP — exactly the pilot-LAN deploy that wasn't
covered by an integration test.

## The journey

1. Visitor opens app on LAN
   1.1. Cloudflare not in path (LAN-only deploy)
   1.2. Plain HTTP to `&lt;rpi-lan-ip&gt;:7777`
2. PilotPasswordGate renders (PR #114 + #115 working)
   2.1. `GET /v2/` serves the React bundle
   2.2. React fetches `/api/pilot/status` → `pilotMode: true`
3. User submits pilot password
   3.1. `POST /api/auth/pilot-password` body `{password}`
   3.2. Server validates → 200 + `Set-Cookie: fa_pilot=...; Secure; ...`
   3.3. **Browser silently drops the cookie because connection is HTTP**
4. User attempts to enter email for magic-link
   4.1. `POST /api/auth/magic-link/start` no `fa_pilot` cookie
   4.2. `enforcePilotGate` → `isPilotAuthenticated(req)` returns false
   4.3. `errors.forbidden('Pilot password required.')` → 403
5. User stuck

## Domain model impact

No domain entity changes. Pure auth-cookie-flag fix. Files touched:

- `server/auth/sessions.js` — drop NODE_ENV-override on session-cookie
- `server/auth/routes.js` — use `isSecureRequest` for pilot + OAuth cookies
- `tests/cookie-secure-flag.test.js` — NEW regression coverage
- `CHANGELOG.md`, `docs/runbooks/deploy-portainer.md` — docs

DEL 6.1b: explicit Christer approval logged 2026-05-04.

## Edge-cases

1. **HTTPS deploy without HTTPS_TERMINATED set, but X-Forwarded-Proto
   present (Cloudflare default)** — `isSecureRequest` returns `true`
   from header. Cookie gets `Secure`. Correct.
2. **Direct HTTPS without proxy** — `req.socket.encrypted === true`.
   Cookie gets `Secure`. Correct.
3. **HTTP deploy on localhost (developer dev)** — `isSecureRequest`
   returns `false`. Cookie does NOT get `Secure`. Browser accepts
   on `localhost` (Chrome/Firefox treat localhost as secure context
   even without HTTPS, so cookies persist regardless).
4. **HTTP deploy on LAN IP (Christer's pilot)** — `isSecureRequest`
   returns `false`. Cookie does NOT get `Secure`. Browser accepts.
   Fixed.
5. **Cloudflare Tunnel deploy** — operator sets
   `HTTPS_TERMINATED=true` per runbook, OR Cloudflare sets
   `x-forwarded-proto: https`. Either way `isSecureRequest`
   returns `true`. Correct.
6. **Test environment** — `NODE_ENV=test`. The old override returned
   `false` here. New code: `isSecureRequest(req)` also returns
   `false` for the test helper's plain-HTTP connection. Same
   observable behaviour. Existing tests unaffected.
7. **Mixed-mode deploy (HTTPS reverse proxy → HTTP app, but no
   `X-Forwarded-Proto` header)** — `isSecureRequest` returns `false`
   unless operator sets `HTTPS_TERMINATED=true`. Documented in
   runbook. If operator forgets, cookies fail in browsers that
   require Secure on cross-site requests — caught at integration
   test or browser smoke test. Acceptable; operator-correctable.
8. **OAuth state cookie on HTTP deploy** — Google OAuth is disabled
   in pilot, but the cookie path `/api/auth/google/` would drop the
   `Secure` attribute. Same fix applies. Future-safe.

## ISO 25010 impact

- Reliability: 8.5 → 8.6 (+0.1) — fixes pilot-launch blocker, single
  helper handles all cookie security decisions consistently
- Security: 8.2 → 8.2 (uendret) — no change in HTTPS-deploy security
  posture (Secure still set when `isSecureRequest` returns true). HTTP
  deploys are no less secure than before (an attacker on the same LAN
  could already MITM a plain-HTTP connection regardless of the cookie
  flag).
- Maintainability: 8.5 → 8.6 (+0.1) — single helper used everywhere,
  fewer special-cases
- Functional Suitability: 8.7 → 8.7 (unchanged)

## Decisions

### BESLUTNING 1: Use `isSecureRequest()` everywhere
ANBEFALING: yes (already covered in this fix)
HVORFOR: helper already correct, single source of truth

### BESLUTNING 2: Fix all 3 cookies in same PR
ANBEFALING: yes (Christer approved)
HVORFOR: same antipattern → consistent fix prevents next surprise

### BESLUTNING 3: Add integration test reproducing prod-env
ANBEFALING: yes
HVORFOR: bug slipped through because tests never set
`NODE_ENV=production` AND simulate HTTP. New tests cover both
matrix axes (`HTTPS_TERMINATED` true/false × header proxy on/off).

## Plan

1. `server/auth/sessions.js` — drop `|| config.NODE_ENV === 'production'`
   from setSessionCookie + clearSessionCookie
2. `server/auth/routes.js` — import `isSecureRequest` from sessions.js
3. `server/auth/routes.js` — OAuth state cookie: use `isSecureRequest(ctx.req)`
4. `server/auth/routes.js` — `setPilotCookie` gains `req` parameter, uses
   `isSecureRequest(req)`. Caller updated.
5. `tests/cookie-secure-flag.test.js` — new test file, full matrix
6. CHANGELOG entry, runbook update, code-debt entry 11

## Code-debt to log post-pilot

- `HTTPS_TERMINATED` is read directly via `process.env` instead of
  going through Zod-validated `config`. Inconsistent with the rest
  of the codebase. Migrate to `config.HTTPS_TERMINATED` with a
  proper Zod schema entry. Tracked in
  `docs/workflow/post-pilot-code-debt-cleanup.md` Entry 11.

- Pre-deploy smoke-test that exercises the cookie flow end-to-end
  with a production-like env (`NODE_ENV=production`, `AUTH_TOKEN`
  set, `HTTPS_TERMINATED` toggled both ways) is missing. Tracked
  for CLAUDE.md DEL 16 expansion (post-pilot).

## Portainer-oppstartsrisiko (DEL 3 Steg 3b)

NO. Pure auth-flag change. No Dockerfile, no migrations, no startup
sequence change. Server boots identically.
