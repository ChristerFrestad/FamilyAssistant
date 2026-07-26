# Portainer deploy gate: `SESSION_SECRET` crashloops on fresh install

**Status:** **RESOLVED**
**Reported:** 2026-04-22, immediately after merging batch 1 (PR #64).
**Scope:** Infrastructure / deploy flow.
**Risk (pre-fix):** HIGH — pilot container down until this is resolved.

---

## Symptom

After pulling the image `ghcr.io/christerfrestad/familyassistant:main`
post-batch-1 merge, the container crashloops during startup with the
following in the log:

```
⚠️  SESSION_SECRET is required in production when Google OAuth,
    magic-link email, or MAGIC_LINK_CONSOLE is enabled.
   Either set SESSION_SECRET in env, or let the bootstrap wizard
   (/setup.html) generate one. Existing installs are self-healed on
   boot — see server/auth/bootstrap-session-secret.js.
```

The container exits with code 1. Portainer marks the stack as
"unhealthy" and restarts the container in a loop until the restart
policy gives up.

---

## Root cause

The C3 code change in PR #64 (`feat(auth): enable multi-tenant
session flow`) tightened `server/config.js` validation so that
`SESSION_SECRET` is required in `NODE_ENV=production` when any of
these are active:

- `GOOGLE_CLIENT_ID`
- `RESEND_API_KEY`
- `MAGIC_LINK_CONSOLE=true`

At the same time C1 introduced a **self-heal module**
(`server/auth/bootstrap-session-secret.js`) which fills in
`sessionSecret` in an **existing** `bootstrap.json` if the field
is missing.

The problem: self-heal assumes that `bootstrap.json` **already
exists** with a valid `authToken`. That code path covers upgrade
installations — but NOT fresh installs that need to go through the
wizard for the first time.

Fresh install sequence:

1. Container starts with `BOOTSTRAP_ALLOWED=true`, `AUTH_TOKEN=` (empty)
2. `loadBootstrapFile()` returns `null` (no file yet)
3. `BOOTSTRAP_MODE` activates because (a) empty DB + (b) no
   bootstrap.json + (c) no env AUTH_TOKEN
4. Validation runs **before** the wizard has been given a chance to run
5. If the operator has set `MAGIC_LINK_CONSOLE=true` (or Resend/Google)
   in the Portainer stack env, it hits the C3 gate and throws due to a
   missing SESSION_SECRET

---

## Resolution

In `server/config.js`, the HMAC-signing production gate now **skips
when `BOOTSTRAP_MODE` is active**:

```js
if (cfg.NODE_ENV === 'production' && hmacSigningEnabled && !cfg.BOOTSTRAP_MODE) {
  // require SESSION_SECRET
}
```

Rationale (option **b** from the original mitigation list):

- Bootstrap mode only serves `/setup.html` + `/api/bootstrap/*` +
  health endpoints. No session cookies, magic-links, or OAuth run
  until the wizard completes.
- `handleComplete()` already writes `sessionSecret` into
  `bootstrap.json`. The container exits and restarts into normal mode,
  where the gate re-runs with a real secret.

Covered by `tests/portainer-bootstrap.test.js`.

---

## Manual override (still valid)

Operators who prefer to skip the wizard can set both secrets as
Portainer stack env-vars before first deploy:

```
AUTH_TOKEN=<openssl rand -hex 32>
SESSION_SECRET=<openssl rand -hex 32>
ALLOWED_ORIGINS=http://<host>:7777
```

---

## References

- PR #64 (batch 1) — where C3 tightened validation and C1 added
  self-heal.
- `server/config.js` — production gate for HMAC-signing features.
- `server/auth/bootstrap-session-secret.js` — self-heal module.
- `server/http/bootstrap.js:handleComplete` — wizard which generates
  SESSION_SECRET on fresh install.
