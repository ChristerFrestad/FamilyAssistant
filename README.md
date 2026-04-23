# FamilyAssistant

Self-hosted household assistant for Norwegian families — plans the weekly
menu, shopping list, pantry inventory, and chore rotation. Runs either
locally on a Raspberry Pi 5 or as a multi-tenant SaaS on Railway.

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

Two deployment modes — same codebase.

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

### 2) Railway (cloud, multi-tenant)

Google OAuth + magic-link, per-family LLM config, optional Sentry.
See [`DEPLOY.md` §15](DEPLOY.md) for the full walkthrough including
DNS, Resend, volume mount, and backup.

```bash
# In the Railway dashboard:
#   1. New project from this repo
#   2. Mount a volume at /app/data
#   3. Set environment variables (see .env.example)
#   4. Push to main → CI → auto-deploy
```

## Documentation

| File | Purpose |
|---|---|
| [`DEPLOY.md`](DEPLOY.md) | Deploy on RPi5 or Railway |
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

# Terminal 2 — Vite dev-server on :5173 with /api proxied to :7777
npm run dev:client

# Open http://localhost:5173/v2/  — hot reload works end-to-end
```

Prod-style build:
```bash
npm run build:client         # emits to public/v2/ (gitignored)
npm start                    # serve via Express
# Open http://localhost:7777/v2/
```

## Production requirements

`NODE_ENV=production` requires at minimum:

1. `AUTH_TOKEN` (≥ 16, ideally 32+ characters) — generate with
   `openssl rand -hex 32`
2. `ALLOWED_ORIGINS` — comma-separated allowlist, `*` is rejected
3. HTTPS (Caddy on RPi5, automatic on Railway) and
   `HTTPS_TERMINATED=true`
4. For the multi-tenant path: `SESSION_SECRET`, `ENCRYPTION_KEY`,
   `APP_URL`

The server refuses to start if 1 or 2 are missing.

## License

MIT — see [`LICENSE`](LICENSE). © Christer Frestad.

## Security reports

See [`SECURITY.md`](SECURITY.md) for responsible disclosure.
