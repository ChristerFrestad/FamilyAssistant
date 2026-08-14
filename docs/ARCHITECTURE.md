# ARCHITECTURE.md – One-page system overview

> Reading time: 5 minutes. Aimed at a new contributor or external
> reviewer who wants the mental model before clicking through 22
> services. Authoritative reference is the code; this document
> explains *what fits where and why*.

## TL;DR

FamilyAssistant is a single-process Node.js backend (`node:http`, no
framework) backed by SQLite, with one Vite + React + TypeScript UI
served at the site root (`/login`, `/dashboard`, `/invite/:token`).
The build output lives in `public/v2/`; that folder name is not a
URL. Legacy `/v2/*` paths 301 to the unprefixed route. The intended
deploy story is `Docker → Portainer → Raspberry Pi 5 → Cloudflare
Tunnel`. Multi-tenancy is enforced by an `AsyncLocalStorage`-scoped
`familyId` that every repository read/write filters on.

## Request flow

```
              ┌──────────────────────────────┐
              │  Cloudflare Tunnel (TLS)     │
              └──────────────┬───────────────┘
                             │
              ┌──────────────▼───────────────┐
              │  Caddy on RPi5 (:443)        │
              │  reverse proxy + headers     │
              └──────────────┬───────────────┘
                             │  HTTP :7777
              ┌──────────────▼───────────────┐
              │  server/index.js             │
              │   1. config + sentry init    │
              │   2. db init + migrations    │
              │   3. seed-if-empty           │
              │   4. http server up          │
              └──────────────┬───────────────┘
                             │  every request:
              ┌──────────────▼───────────────┐
              │  server/http/server.js       │
              │   rateLimit  →  authenticate │
              │     →  AsyncLocalStorage     │
              │        (familyId scope)      │
              │     →  router.dispatch       │
              └──────────────┬───────────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
 ┌─────▼──────┐       ┌──────▼──────┐       ┌──────▼──────┐
 │ services/  │       │  llm.js     │       │ static      │
 │ (22 files) │       │  per-family │       │ / + assets  │
 │ business   │       │  backend    │       │ privacy.html│
 │ rules      │       │  selection  │       │             │
 └─────┬──────┘       └──────┬──────┘       └─────────────┘
       │                     │
 ┌─────▼──────┐       ┌──────▼──────────────────────────┐
 │ repos.js + │       │ Ollama / Anthropic / OpenAI /   │
 │ http/cache │       │ xAI / llama.cpp                 │
 │ (no SQL    │       │ (key AES-256-GCM at rest)       │
 │  outside)  │       └─────────────────────────────────┘
 └─────┬──────┘
       │
 ┌─────▼──────┐
 │ SQLite     │
 │ better-    │
 │ sqlite3    │
 │ (sql.js    │
 │  fallback) │
 └────────────┘
```

## Layers

| Layer | Folder | Responsibility | Talks to |
|---|---|---|---|
| HTTP entry | `server/index.js` | bootstrap, startup ordering, shutdown | `http/`, `db.js`, `cron.js` |
| HTTP infra | `server/http/` | router, middleware, security, validate, errors, metrics, cache, branding-config endpoint | `services/`, `auth/` |
| Auth + tenancy | `server/auth/` | sessions, magic-link, Google OAuth, GDPR endpoints, `family-context` (AsyncLocalStorage) | `repositories/`, `email.service.js` |
| Routes | `server/routes.js` | URL-to-handler wiring; **no business logic, no SQL** | `services/`, `schemas.js` |
| Services | `server/services/*.service.js` | business rules, pure functions or factories | `repositories.js`, `llm.js`, `kassal-client.service.js` |
| Repositories | `server/repositories.js` + `server/repositories/` | all SQL; every query filters on `getFamilyId()` | `db.js` |
| Persistence | `server/db.js` + `server/migrations/*.sql` | SQLite connection, idempotent migrations on boot | filesystem (`data/familieassistenten.db`) |
| LLM | `server/llm.js` + `server/llm/*.js` | per-family backend adapter; RAG context build with `sanitizeForPrompt` | external HTTP |
| Frontend | `client/src/app/` | Vite + React + TS UI at `/` (`/login`, `/dashboard`) | `/api/*` |
| Static extras | `public/setup.html`, legal pages | Portainer first-boot wizard + privacy/terms | — |
| Observability | `server/observability/sentry.js` + `server/logger.js` | pino logging with redact-paths, optional Sentry | external HTTP (Sentry) |

## Multi-tenancy in one paragraph

When a request comes in, `server/auth/middleware.js` resolves the
session cookie or bearer token, sets `ctx.familyId`, and wraps the
rest of the request in `familyContext.run({ familyId }, runRouted)`.
Inside that scope, `getFamilyId()` from `server/auth/family-context.js`
returns the active familyId. Every repository function in
`server/repositories.js` reads it and parameterises queries with it.
This means a service does not pass family-id around — the
async-local context guarantees that an accidental missing filter
returns zero rows for the wrong family instead of leaking one
family's data to another. Cross-tenant isolation is verified end-to-end
in `tests/tenant-isolation.test.js` and
`tests/multi-tenant-isolation.test.js`.

## Deploy topology

Default and only supported path:

1. GitHub Actions builds a multi-arch (`amd64` + `arm64`) image and
   pushes to `ghcr.io/christerfrestad/familyassistant:main` with
   SLSA Level 3 provenance.
2. Portainer on the operator's host (Raspberry Pi 5 in Christer's
   pilot deploy) pulls `:main` on its watch interval.
3. The container reads env-vars from the Portainer stack —
   `AUTH_TOKEN`, `ALLOWED_ORIGINS`, `SESSION_SECRET`, `ENCRYPTION_KEY`,
   per-brand `APP_NAME*` overrides, optional `RESEND_API_KEY` for
   magic-link emails — and starts.
4. On first boot, if `AUTH_TOKEN` is unset, the container enters
   bootstrap mode and serves `/setup.html` so the operator can
   finish setup in the browser without SSH.
5. Caddy on the host terminates Cloudflare's tunnel and reverse-
   proxies port 7777.

Bare-metal `npm start` works too (the dev workflow + the
`single-family` pilot path), but Portainer is the documented
production deploy. See `DEPLOY.md` for the click-by-click recipe.

## Where to start reading

- New to the project? Read this file, then `README.md`, then
  `DEPLOY.md §16` (Portainer recipe).
- Adding a feature? Read `AGENTS.md` (the workflow spec) and
  `docs/DOMAIN_MODEL.md` (business rules), then look at
  `server/services/pantry-coverage.service.js` as a service-pattern
  reference.
- Reviewing security? Read `SECURITY.md`, then
  `tests/tenant-isolation.test.js` and `tests/security-auth-rate-limit.test.js`
  to see what the test-suite enforces.
- Debugging in prod? `RUNBOOK.md` covers operations, backup, restore,
  and on-call.

## What this document is *not*

- Not a per-entity domain reference — that lives in
  `docs/DOMAIN_MODEL.md`.
- Not a per-table schema reference — migrations under
  `server/migrations/` are the source of truth; query plans in
  `docs/DB_INDEXES.md`.
- Not a frontend deep-dive — see
  `docs/architecture/frontend.md` and
  `docs/frontend/v2-strategy.md`.
- Not a brand-system spec — see `docs/BRAND_SYSTEM.md` and
  `docs/operations/PORTAINER_BRANDING_SETUP.md`.
