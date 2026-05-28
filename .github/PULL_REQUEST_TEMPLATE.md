<!--
Thanks for opening a pull request! A few quick reminders:

- Keep the title short (≤ 70 chars). Put detail in the body, not the title.
- If the change touches the Portainer deploy flow, the multi-tenant auth
  code in `server/auth/`, or `server/observability/sentry.js`, see
  AGENTS.md DEL 6 — these surfaces are frozen and need explicit approval.
- Conventional Commits in commit messages: feat / fix / chore / docs /
  test / refactor / perf / ci / deps + (scope).
-->

## What and why

<!-- 3-5 sentences. Focus on the why, not the what — the diff shows the what. -->

## Link to analysis

<!--
If this PR implements work planned in `docs/analyses/`, link the analysis
document here. Trivial PRs (typo fix, small chore) can skip this.
-->

## How to test manually

<!--
Step-by-step instructions a reviewer or operator can follow. Include the
exact commands, expected output, and any setup state.
-->

## Security checklist

<!-- Mark Yes / "Not relevant because X" for each. See AGENTS.md DEL 4. -->

- [ ] Input validation via Zod or local schema where user input is read
- [ ] SQL parameterized (`?` bindings in better-sqlite3)
- [ ] New endpoints have auth + role check via the middleware chain
- [ ] Secrets via `.env` / `bootstrap.json`, never in code
- [ ] PII not logged (see `server/logger.js` redact paths)
- [ ] Error messages do not leak internal details to the user
- [ ] Destructive operations wrapped with `withAudit()` (SBOM-6)
- [ ] Frontend: no `innerHTML` with user-controlled data without `escapeHtml()`
- [ ] CSP in `server/http/security.js` not weakened

## Portainer boot risk

<!--
Mark "Yes" if the change touches any of these files / behaviors. If yes,
include the rollback plan and how the boot path was verified. See AGENTS.md
DEL 3 §2.6 / 3b.

- Dockerfile / .dockerignore
- docker-compose.yml
- server/http/bootstrap.js
- server/config.js startup validation
- server/index.js startup sequence
- server/db.js or server/migrations/**
- install.sh / bootstrap.json read/write
- Environment variables required at boot
-->

**Boot risk: No** <!-- or Yes + details -->

## ISO 25010 impact

<!--
Per affected characteristic, estimate the impact. See AGENTS.md DEL 3 §2.7.
Use "not affected" for characteristics that genuinely are not touched.
-->

## DOMAIN_MODEL.md update

<!-- Yes / No + brief description if Yes. See AGENTS.md DEL 1 #9. -->

## Screenshots

<!-- Required for UI changes. -->
