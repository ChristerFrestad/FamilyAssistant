# Portainer deploy gate: `SESSION_SECRET` crashloops on fresh install

**Status:** OPEN — deferred to estimated week 4.
**Reported:** 2026-04-22, immediately after merging batch 1 (PR #64).
**Scope:** Infrastructure / deploy flow.
**Risk:** HIGH — pilot container down until this is resolved.

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
installations (a pilot RPi that had the phase 22 wizard run
previously) — but NOT fresh installs that need to go through the
wizard for the first time.

Fresh install sequence:

1. Container starts with `BOOTSTRAP_ALLOWED=true`, `AUTH_TOKEN=` (empty)
2. `loadBootstrapFile()` returns `null` (no file yet)
3. `BOOTSTRAP_MODE` activates because (a) empty DB + (b) no
   bootstrap.json + (c) no env AUTH_TOKEN
4. Validation runs **before** the wizard has been given a chance to run
5. If the operator has set `MAGIC_LINK_CONSOLE=true` in the
   Portainer stack env (as documented in the docs example), it hits
   the C3 gate and throws due to a missing SESSION_SECRET

Pilot-specific: Christer's deploy has `MAGIC_LINK_CONSOLE=true`
(per `.env.example` and docker-compose.yml) which **would have been
safe** before C3 but now requires SESSION_SECRET.

### Why self-heal does not rescue fresh install

`ensureSessionSecretInBootstrapFile()` reads from disk. It returns
`{ generated: false, secret: null }` if the file does not exist.
Nothing to heal — there is no hole to fill. The file is only
created when the wizard completes, but the wizard never gets going
because `config.js` validation throws before the HTTP server starts.

---

## Why we are NOT solving this with a manual workaround

Christer could immediately set `SESSION_SECRET` in the Portainer
stack env as an environment variable. That would fix the container,
but:

1. **It is not a representative deploy flow for external families.**
   The next 4 pilot families will install the app themselves. If we
   bypass this step manually now, we miss out on testing that the
   fresh-install flow actually works end-to-end.
2. **It is a temporary-in-name-only-forever workaround.** A single
   environment variable that "just has to be there" is easily
   forgotten on the next deploy or by the next operator.
3. **It hides the symptom, not the cause.** The problem lies in the
   sequence config validation → bootstrap wizard. The fix needs to
   address that sequence.

Therefore: **the container is down until we solve this properly.**
The pilot flow tests itself by being realistic.

---

## Temporary workflow

While the fix waits:

- **Test environment:** local Node run (`npm start` with `NODE_ENV=
  development` and optionally `MAGIC_LINK_CONSOLE=true`). SESSION_SECRET
  is auto-generated in dev mode (see `server/config.js:299-303`).
- **CI:** full local pyramid per AGENTS.md PART 5.2.2 + GitHub
  Actions as before.
- **Empirical verification** (e.g. B1 end-to-end tenant
  isolation test, B2 cross-family LLM flow) is **deferred** until
  the container is back up. B5 data model + repo tests can be
  run locally.

---

## When this gets fixed

Estimated week 4 per the B4 timeline (Cloudflare Tunnel week 4-5 →
external families can be invited → fresh-install flow has to work).

The first family invited will also be the first real
fresh-install test.

---

## Mitigation options (not chosen yet)

### (a) Extend self-heal to create `bootstrap.json` if it does not exist

Change `ensureSessionSecretInBootstrapFile()` to return an empty
object with a generated `sessionSecret` if the file is missing,
without writing to disk. Then `config.js` has a valid value in env
while `BOOTSTRAP_MODE` takes over and the wizard runs normally.
The wizard's `handleComplete()` (which already generates
`sessionSecret` via `generateSessionSecret()` in C1) writes the
final file when setup completes.

**Pro:** Minimal code change. Fresh-install flow works
without manual env config.

**Con:** Temporary (pre-wizard) SESSION_SECRET is in memory
at runtime, but not written down. If the wizard is not completed
and the container restarts, a new one is generated — any
in-flight OAuth state cookies become invalid. Acceptable for a
fresh install meant to complete the wizard in one sitting.

### (b) First-boot wizard generates everything before `config.js` validates

Restructure the startup flow so that `BOOTSTRAP_MODE` is checked
BEFORE the strict validation gate. If bootstrap mode is active,
the production requirements for SESSION_SECRET (and others) are
skipped because the wizard will populate them before the next
restart.

**Pro:** Seamless setup — the operator never sees startup errors
before they have completed the wizard.

**Con:** Slightly more invasive change in the `config.js` flow.
Also requires that wizard output writes SESSION_SECRET, which is
already done in PR #64 `handleComplete`.

### (c) Document manual SESSION_SECRET step in the installation guide

No code change. DEPLOY.md explains that a fresh install must set
SESSION_SECRET in the Portainer stack env before the first start,
OR run a dedicated "generate-secrets" container first.

**Pro:** Zero code risk.

**Con:** Contradicts the "zero-config Docker deploy" intent of
phase 22. Extra manual step for each new family. Easy to
forget.

---

## Preliminary recommendation

When we return to this: **(b) is the right architectural choice**,
but **(a) is the fastest path to a working fresh install without
restructuring the startup flow**. Combination: (a) as the first
fix to get the container up, (b) as part of a larger refactor
if we scale to more tenants with their own deploys.

The final decision is made when the fix is written — estimated
within the scope of week 4 B4 work.

---

## References

- PR #64 (batch 1) — where C3 tightened validation and C1 added
  self-heal. Merged as `d238bf2`.
- `server/config.js:279-310` — tightened production gate for
  HMAC-signing features.
- `server/auth/bootstrap-session-secret.js` — self-heal module.
- `server/http/bootstrap.js:handleComplete` — wizard v2 which
  generates SESSION_SECRET on fresh install.
- `docs/runbooks/b1-deploy-checklist.md` — deploy checklist
  that also needs to be updated when the fix lands.
