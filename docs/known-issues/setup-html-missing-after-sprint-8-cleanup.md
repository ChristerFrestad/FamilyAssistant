# Known issue: `/setup.html` returns 404 after Sprint 8 v1 cleanup

**Discovered:** 2026-05-27 during the public-repo-prep PR 5
investigation.
**Severity:** HIGH for fresh Portainer deploys, none for upgrades.
**Affected versions:** every release after Sprint 8 v1 frontend
cleanup (PR #118, 2026-05-05).

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
- `DEPLOY.md` §16, README, `.env.example`, `docker-compose.yml`,
  `REFERENCES.md` — all document `/setup.html` as the wizard URL

No replacement wizard was built. The v2 React app under `/v2/*`
does not currently expose a setup-flow route.

## Workaround

Until a v2 setup wizard is implemented, fresh Portainer deploys
must skip the bootstrap-wizard flow:

1. Set `AUTH_TOKEN` directly as a Portainer stack env-var before
   first deploy (`openssl rand -hex 32` on any host).
2. Set `BOOTSTRAP_ALLOWED=false` (or omit it) so the server does
   not enter bootstrap mode.
3. Set `ALLOWED_ORIGINS`, `SESSION_SECRET`, and the other env-vars
   listed in `docs/runbooks/deploy-portainer.md` §3.
4. Deploy normally — the server boots straight into production
   mode and the operator can sign in via magic-link.

Christer's pilot already runs this way; the bootstrap-wizard path
was only used during early Phase 22 testing before this issue
appeared.

## Fix proposals (not yet implemented)

Three options for a real fix, in increasing engineering cost:

1. **Restore a static `public/setup.html`** that mirrors the
   bootstrap wizard logic from the v1 era. Plain HTML + a small
   `<script>` that calls `POST /api/bootstrap/generate-token` and
   `POST /api/bootstrap/complete`. ~150 lines, no v2 React deps.
   This is the minimal change to make `DEPLOY.md` §16 work again.

2. **Build a v2 setup-wizard route** at `/v2/setup` that the
   bootstrap endpoint redirects to. Reuses the v2 design tokens
   and component library. Larger change because the v2 React
   bundle must run before auth — the existing `PilotPasswordGate`
   pattern is closest precedent.

3. **Inline the wizard in the bootstrap response.** Server returns
   a self-contained HTML form from `GET /` when in bootstrap mode.
   No filesystem dependency. Simplest deployment story.

Each option also needs corresponding doc updates in `README.md`,
`DEPLOY.md` §16, `docker-compose.yml`, `.env.example`, and
`docs/runbooks/deploy-portainer.md`.

## Related

- Brand-konsolidering for PR 5 also surfaced the related question
  of `APP_NAME` flashing as `FamilyAssistant` before
  `/api/config` resolves. That happens because the index.html
  ships with default brand strings; the brand override applies
  only after the React client fetches `/api/config`. Fix is
  similar in spirit (server-side render brand into initial HTML)
  but architecturally separate.

## Owner action

This issue is documented as a known limitation. Fix is post-pilot
work — does not block the public-repo flip because the workaround
(set `AUTH_TOKEN` directly in Portainer) is already what Christer's
pilot does in practice.
