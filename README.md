# FamilyAssistant

Self-hosted household assistant for Norwegian families — plans the weekly
menu, shopping list, pantry inventory, and chore rotation. Designed to run
on a Raspberry Pi 5 (or any Docker host) behind Cloudflare Tunnel; the
deploy story is `Docker → Portainer → RPi5 → Cloudflare Tunnel`.

The UI is Norwegian; the codebase is English.

## Features

- **Weekly menu** with per-member portion scaling
- **Pantry inventory** wired to the shopping list — knows what's already
  in the house
- **Shopping list** auto-generated when the week is complete
- **Chores** with schedules and completion log
- **Recipe import** from URLs, with AI parsing
- **Two-layer allergy filter** (LLM context + deterministic post-filter)
- **Receipt OCR** against the Kassal catalogue
- **AI chat** grounded in the family's pantry and menu history
- **Multi-tenant**: each family has its own data, role-based access
  (`owner` / `adult` / `child`), optional Google OAuth or magic-link sign-in
- **Per-family LLM**: choose Anthropic, OpenAI, xAI, or Ollama — each
  family brings its own API key (AES-256-GCM encrypted at rest)
- **PWA**: installable on mobile, works offline for reads
- **GDPR**: data export, soft-delete with 30-day grace, cascade-delete on
  family removal

## Quickstart

Two flavours of the same codebase, both targeting the RPi5/Docker
deploy story.

### 1) Raspberry Pi 5 (bare-metal, single-family)

One family, `AUTH_TOKEN` instead of user sign-in, optional Google OAuth
for remote access. See [`DEPLOY.md` §1–14](DEPLOY.md) for the full
walkthrough.

```bash
git clone <repo>
cd FamilyAssistant
cp .env.example .env      # set AUTH_TOKEN + ALLOWED_ORIGINS
chmod 600 .env
npm ci --omit=dev
npm start
```

### 2) Docker via Portainer (zero-config, recommended)

Same RPi5 (or any Docker host), but Portainer pulls the multi-arch
image from `ghcr.io/christerfrestad/familyassistant:main` and a
first-boot wizard at `/setup.html` generates the `AUTH_TOKEN` for
you. No SSH, no manual `npm install`. See [`DEPLOY.md` §16](DEPLOY.md)
for the click-by-click recipe.

```bash
# In Portainer → Stacks → + Add stack:
#   1. Paste docker-compose.yml from this repo
#   2. Deploy the stack
#   3. Open http://<host>:7777/setup.html and finish setup
```

A multi-tenant cloud deploy (Google OAuth + magic-link across
families) is on the roadmap but not currently shipped. The auth
code lives in `server/auth/` and is exercised in tests; the deploy
recipe will return when the pilot has stabilised.

## Documentation

| File | Purpose |
|---|---|
| [`DEPLOY.md`](DEPLOY.md) | Deploy on RPi5 (bare-metal or Docker/Portainer) |
| [`RUNBOOK.md`](RUNBOOK.md) | Operations, on-call, backup/restore |
| [`SECURITY.md`](SECURITY.md) | Threat model, vulnerability reporting |
| [`CI.md`](CI.md) | CI gates, test/lint/coverage commands |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution flow, coding style |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |
| [`docs/DB_INDEXES.md`](docs/DB_INDEXES.md) | SQLite indexes and query plans |
| [`docs/frontend/v2-strategy.md`](docs/frontend/v2-strategy.md) | New frontend (Vite + React) under `/v2/*` |

## Stack

- **Node.js ≥ 20**, no framework — `node:http` with a hand-rolled router
- **SQLite** via `better-sqlite3` (synchronous, fastest on an RPi5)
- **Validation**: Zod
- **Logging**: pino
- **Frontend (legacy, `/`)**: plain HTML / CSS / JS + a service worker, no build step
- **Frontend (v2, `/v2/*`)**: Vite + React 18 + TypeScript + Tailwind v3 +
  React Router — under active development, see
  [`docs/frontend/v2-strategy.md`](docs/frontend/v2-strategy.md)
- **LLM abstraction**: per-family backend — Anthropic, OpenAI, xAI,
  Ollama, or a local llama.cpp server

### Frontend v2 dev quickstart

```bash
# Install frontend devDeps (already in root package.json)
npm install

# Terminal 1 — backend on :7777
npm start

# Terminal 2 — Vite dev-server on :7778 with /api proxied to :7777
npm run dev:client

# Open http://localhost:7778/v2/  — hot reload works end-to-end
```

(Vite-port `7778` (ikke standard `5173`) sitter rett ved backend
på `7777`. Full port-matrise for utviklermaskinen er i `CLAUDE.md`
DEL 7.8.)

Prod-style build:
```bash
npm run build:client         # emits to public/v2/ (gitignored)
npm start                    # serve via Express
# Open http://localhost:7777/v2/
```

## Branding (white-label)

FamilyAssistant supports custom branding via env vars so a fork
can ship with its own product name without touching code.

- **Default:** the app calls itself `FamilyAssistant` in both
  Norwegian and English — across the header, login screen,
  magic-link emails, and the page title.
- **Override:** set the same brand value on both sides of the
  stack:

  ```
  VITE_APP_NAME=YourBrandName   # frontend, build-time
  APP_NAME=YourBrandName        # backend, runtime
  ```

  Both flags read the same brand string. Frontend uses Vite's
  `import.meta.env.VITE_*` exposure (so the value lands in the
  built bundle); backend reads `process.env.APP_NAME` at startup
  via `server/config.js`. Keep them in sync — divergence shows
  up as the email saying one name and the website another.

See `CLAUDE.md` § 7.12 for the full pattern (which files are
white-labeled, which always read `FamilyAssistant`, and the test
contract that protects the override).

## Production requirements

`NODE_ENV=production` requires at minimum:

1. `AUTH_TOKEN` (≥ 16, ideally 32+ characters) — generate with
   `openssl rand -hex 32`
2. `ALLOWED_ORIGINS` — comma-separated allowlist, `*` is rejected
3. HTTPS (Caddy on RPi5 — or terminated upstream by a reverse proxy
   such as Cloudflare Tunnel) and `HTTPS_TERMINATED=true`
4. For the multi-tenant path: `SESSION_SECRET`, `ENCRYPTION_KEY`,
   `APP_URL`

The server refuses to start if 1 or 2 are missing.

## License

MIT — see [`LICENSE`](LICENSE). © Christer Frestad.

## Security reports

See [`SECURITY.md`](SECURITY.md) for responsible disclosure.
