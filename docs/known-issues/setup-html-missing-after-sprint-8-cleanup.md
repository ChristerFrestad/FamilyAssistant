# Known issue: `/setup.html` returns 404 after Sprint 8 v1 cleanup

**Discovered:** 2026-05-27 during the public-repo-prep PR 5
investigation.
**Severity:** HIGH for fresh Portainer deploys, none for upgrades.
**Affected versions:** every release after Sprint 8 v1 frontend
cleanup (PR #118, 2026-05-05) **until** the Portainer deploy-ready fix.
**Status:** **RESOLVED** — `public/setup.html` restored as a
self-contained wizard (inline JS, no `/js/setup.js`), allowlisted in
`server/http/server.js` and `server/auth/middleware.js`. Covered by
`tests/portainer-bootstrap.test.js` and `tests/static-pages.test.js`.

## Symptom

A first-time Docker/Portainer deploy following `DEPLOY.md` §16 hits
this sequence:

1. `docker compose up -d` starts the container in bootstrap mode
   because there is no persisted `AUTH_TOKEN` or `/app/data/bootstrap.json`.
2. The container log says:

   ```
   BOOTSTRAP MODE ACTIVE — open http://<host>:7777/setup.html to finish setup.
   ```

3. The operator opens `http://<host>:7777/setup.html` in a browser.
4. The server returns **404 Not Found**.

The setup wizard never renders, so the operator cannot generate the
`AUTH_TOKEN` through the documented zero-config flow.

## Root cause

Sprint 8 (PR #118) deleted the entire v1 frontend, including
`public/setup.html`. The cleanup focused on user-facing pages
(`/index.html`, `/login.html`, `/invite.html`) and missed the
setup-wizard page that the bootstrap-mode flow still depends on.

The bootstrap code itself was not touched and still references
`/setup.html` from multiple call sites:

- `server/http/bootstrap.js:52` — returns `setupUrl: '/setup.html'`
  from `GET /api/bootstrap/status`
- `server/routes.js:182-183` — returns
  `setupUrl: '/setup.html'` in 503 responses when the instance is
  not configured
- `DEPLOY.md` §16, README, `.env.example`, `docker-compose.yml` —
  all document `/setup.html` as the wizard URL

## Resolution

1. Restored `public/setup.html` as a self-contained page (inline CSS +
   JS). No dependency on the deleted `public/js/setup.js`.
2. Added `/setup.html` to `ALLOWED_PUBLIC_FILES` and `PUBLIC_PATHS`.
3. `GET /` in `BOOTSTRAP_MODE` now redirects to `/setup.html` so
   operators who open the host port without the path still land on
   the wizard.
4. Regression tests in `tests/portainer-bootstrap.test.js`.

## Related

- `docs/known-issues/portainer-session-secret-deploy-gate.md` —
  companion fix for the SESSION_SECRET crashloop on the same
  first-boot path.
