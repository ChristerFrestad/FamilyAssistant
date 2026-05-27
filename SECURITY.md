# Security Policy

**Last updated:** 2026-04-18
**Applies to:** FamilyAssistant v1.3.0+

FamilyAssistant runs in two modes:

1. **Local self-host** (RPi5 behind router, optionally exposed via
   Cloudflare Tunnel) — single family, `AUTH_TOKEN`.
2. **Multi-tenant via Docker/Portainer** (same codebase) — multiple
   families on the same host with Google OAuth or magic-link login,
   per-family LLM config. The cloud/SaaS variant of this mode was
   retired as of Sprint 2.6 (2026-04-29); the auth code lives on and
   is covered by tests.

The security model covers both. We defend against incidental malicious
traffic, prompt injections, and tenant crossing — not against state
actors.

## 0. Multi-tenant Guarantees (phases 1–20)

- **Tenant isolation**: all family-scoped repositories read `family_id`
  from an `AsyncLocalStorage` context set by middleware. No query can
  return data without this context. Integration tests in
  `tests/tenant-isolation.test.js` verify that family A never sees
  family B's inventory/menus/recipes/shopping list/receipts.
- **Role enforcement**: the `owner`/`adult`/`child` matrix is enforced
  per mutation endpoint via `requireRole`. `child` cannot POST to
  pantry, menu, shopping list, or AI chat. See
  `tests/role-enforcement.test.js`.
- **Encryption of LLM credentials**: `family_llm_config.api_key_encrypted`
  is AES-256-GCM encrypted with `ENCRYPTION_KEY` (32 bytes hex, distinct
  from `SESSION_SECRET`). Cleartext is never returned via the API —
  `GET /api/family/llm` returns only `has_key: boolean`.
- **Hashed family-id in observability**: the Sentry integration (optional)
  sends only the SHA-256-truncated family-id as `user.id`. `email`,
  `username`, `ip_address`, and request body are scrubbed in `beforeSend`.
  Authorization/Cookie headers are redacted.
- **Session cookies**: HttpOnly + Secure + SameSite=Lax, 30-day TTL,
  signed with `SESSION_SECRET`. Logout invalidates the server-side
  session and clears the SW API cache so the next user on a shared
  device cannot see the previous user's data.
- **Tenant-sensitive API endpoints** (`/api/auth/*`, `/api/family/*`,
  `/api/llm-config/*`, `/api/invitations/*`, `/api/onboarding/*`,
  `/api/gdpr/*`) explicitly bypass the service-worker cache — network-only
  so a stale cached response can never leak between accounts.

---

## 1. Threat Model (STRIDE)

| Category | Threat | Mitigation |
|---|---|---|
| **S**poofing | Unauthorized client on LAN | `AUTH_TOKEN` (≥16 chars) required in production, bearer auth on all `/api/*` except `/health`, `/ready`, `/metrics` |
| | Caddy serves the wrong certificate | Caddy internal CA, `caddy trust` installs the root cert locally |
| | Attacker on public network | Tailscale Serve or Let's Encrypt for external access |
| **T**ampering | XSS via recipe-import / LLM | `escapeHtml` in all `innerHTML`, CSP `script-src 'self' 'unsafe-inline'`, backend `sanitizeString` trims tags/control chars |
| | Prompt injection in LLM context | `sanitizeForPrompt` removes "ignore previous", role hijack, control characters |
| | Modification of local DB | SQLite file owned by `pi:pi` with `0644`, systemd `ReadWritePaths` restricts to `data/` |
| | MITM on LAN | HTTPS via Caddy, HSTS when `HTTPS_TERMINATED=true` |
| **R**epudiation | Unclear who did what | `requestId` in all log lines + problem body, but single-user at this level |
| **I**nformation disclosure | API key in logs | `pino` redact paths for `KASSAL_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `AUTH_TOKEN`, `Authorization` header, `cookie` |
| | `.env` file read by another user | systemd `User=pi`, `.env` set to `0600 pi:pi` in the install script |
| | Env keys returned in `/api/settings/env` | `readMasked()` returns `●●●●●●●●●•XYZW` — never cleartext |
| | Error traces leak details in prod | `server/http/server.js` masks internal messages to "Internal error" when `NODE_ENV=production` |
| **D**enial of service | Request flood | `RATE_LIMIT_MAX=300`/min per IP (default), Caddy `request_body { max_size 5MB }` |
| | Hangs on external backend | Circuit breakers on ollama (3 fails, 30s cooldown), kassal/anthropic (5, 60s) |
| | Infinite backup loop | Schedule-driven, once per 24h, prune after 14 days |
| | Massive payloads | `MAX_BODY_BYTES=1MB` (configurable) |
| **E**levation of privilege | systemd process compromised | `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp`, `PrivateDevices`, `ProtectKernel*`, `RestrictSUIDSGID` |
| | Symbolic link attack | `ReadWritePaths=$APP_ROOT/data` — the DB file is the only write target |

---

## 2. Sensitive Data in the Project

This is data that exists in a production install and requires extra care:

- **API keys** (Kassal, OpenAI, Anthropic, xAI) — stored in `.env`,
  permissions `0600`, never logged. Can be set/rotated via the Settings
  UI, which writes through `env-store.service` with atomic write + backup.
- **AUTH_TOKEN** — systemd environment (`systemctl edit`) or separate
  `/etc/familyassistant.env`. Minimum 32 hex chars (`openssl rand -hex 32`).
- **Family data** — members, allergies, food dislikes, shopping patterns,
  LLM chat history. All lives in the SQLite file `data/familyassistant.db`.
  Backup files are not encrypted (home-network only) — use `rsync` over SSH
  for off-site and trust the SSH key, or manual GPG encryption.
- **Receipts + OCR text** — text extracts can contain names/addresses.
  Stored in the `receipts` table, same sensitivity as the DB otherwise.

### 2.1 PII in Documentation — Policy

**No PII shall be committed in repo text.** This covers:

- Names of family members beyond the project owner (for author attribution)
- Addresses, postal codes, phone numbers, national ID numbers
- Pictures or names of children
- Specific store locations (use generic store names without district or
  city — e.g. "Kiwi" instead of "Kiwi <district>")
- Calendar locations (use test values like "Test Street 1" in fixtures)

**Why:** The repo may one day be shared, cloned by new contributors, or
exposed via logs/backups. PII in git history is hard to remove later
(requires force-push + history rewrite).

**On discovery of PII in committed code:** Run `git log --all -p | grep
-i <trigger>` to find all occurrences, use `git filter-repo` or
squash-rewrite to remove from the entire history. Force-push and notify
everyone who has cloned.

**What the operator does in prod:** Family-specific data (names,
allergies, preferences) is entered into the family_profile table via the
Control Room UI. It lives only in the SQLite database locally on the
device — never in git.

## 3. Known Weaknesses and Trade-offs

These are accepted risks, documented here so new developers understand:

- **CSP has `'unsafe-inline'` for script** — `public/index.html` is one
  large file with inline handlers (`onclick="..."`). The plan was to
  modularize in M5, but it was deferred to v1.3 to avoid the blast radius
  of a 3700-line refactor. The `escapeHtml` helper gives bounded security
  even without nonce/hash-based CSP.
- **~~No audit log~~ Dedicated audit log from v1.3** — destructive
  operations (DELETE/PUT on profile, pantry, sources, receipts, calendar)
  are logged in the `audit_log` table with request-id, SHA-256 before/after
  hash, and timestamp. Exposed read-only via `/api/audit`. Append-only at
  the API level. See SBOM-6 in CHANGELOG.md.
- **Rate limit is in-memory** — resets on restart, not shared between
  nodes. Acceptable for single-node RPi5.
- **No 2FA** — bearer-token only. Token compromise grants full access.
- **`sw.js` caches API GET responses** — contains non-sensitive data
  (meal plans, chores), but a physical device with cache access can read
  old data. Scope is the same device, so the same risk as DB access.

## 4. Supply-chain Policy (from v1.3)

### 4.1 SBOM (Software Bill of Materials)

Every release build generates a **CycloneDX 1.6** SBOM that covers all
runtime dependencies (production bundle, excluding devDeps).

- **Locally:** `npm run sbom` → `sbom.json`
- **Full (incl. dev):** `npm run sbom:full` → `sbom-full.json`
- **CI:** the `sbom` job in `.github/workflows/ci.yml` generates and
  uploads the SBOM as a build artifact on every push. Retained for 90 days.
- **Release:** `.github/workflows/release.yml` attaches `sbom.json` to
  every GitHub Release (tagged versions `v*`).

SBOM gives downstream users the ability to cross-check their own
dependencies, meet NIS2 / US EO 14028 supply-chain requirements, and
perform rapid CVE mapping.

### 4.2 OSV-Scanner (vulnerability feed)

Google's [Open Source Vulnerabilities](https://osv.dev) database is
scanned on every CI run via `google/osv-scanner-action`.

- **Gate:** CI fails if HIGH/CRITICAL vulnerabilities are found in
  `package-lock.json`.
- **Output:** SARIF file uploaded to the GitHub Security tab (requires
  `security-events: write` permission).
- **Response time:** If OSV-Scanner flags a HIGH/CRITICAL CVE, it shall
  be patched or a workaround established **within 7 days**. Document in
  an issue or CHANGELOG.

### 4.3 npm audit

Complements OSV-Scanner with npm's own database:

- `npm audit --omit=dev --audit-level=high` runs as its own CI step
  (`security` job). Fails on HIGH+.
- `npm audit --audit-level=moderate` (incl. dev) runs as an informational
  step, non-blocking.

### 4.4 SLSA Level 3 Provenance

Release artifacts are cryptographically signed with build provenance:

- `release.yml` uses `slsa-framework/slsa-github-generator` to generate a
  signed `.intoto.jsonl` file that describes who, what, when, and how the
  artifact was built.
- No private keys in the repo — signing happens via GitHub OIDC + Sigstore
  Fulcio/Rekor (keyless signing).
- Downstream verification:
  ```bash
  slsa-verifier verify-artifact \
    --provenance-path familieassistenten-v1.3.0.intoto.jsonl \
    --source-uri github.com/ChristerFrestad/FamilyAssistant \
    familieassistenten-v1.3.0.tar.gz
  ```

### 4.5 Token Rotation

`AUTH_TOKEN` shall be rotated **at least every 90 days**. Mechanics:

1. Operator sets a new token in `.env` or `systemd environment`:
   ```bash
   NEW_TOKEN=$(openssl rand -hex 32)
   # Update AUTH_TOKEN and AUTH_TOKEN_CREATED_AT
   ```
2. `AUTH_TOKEN_CREATED_AT=2026-04-10T12:00:00Z` (ISO-8601).
3. The app reads this in `config.js` and /ready flags warning
   `auth_token_stale_<N>d` when `N > AUTH_TOKEN_MAX_AGE_DAYS` (default 90).
4. If `AUTH_TOKEN` is set but `AUTH_TOKEN_CREATED_AT` is missing, /ready
   returns an `auth_token_age_unknown` warning in production.

The rate-limit CI gate and audit log catch any misuse between rotations.

### 4.6 Dependabot

`.github/dependabot.yml` opens weekly PRs (Mondays 07:00 Europe/Oslo):

- **npm (production + development)** — grouped minor/patch for less noise,
  separate PRs for major.
- **GitHub Actions** — action versions.

All Dependabot PRs go through the normal CI gate (lint + format + test +
coverage + SBOM + OSV-scan) before merge.

### 4.7 Update Policy

- **Node.js**: stay on the latest LTS (20.x currently). Check
  `package.json#engines`.
- **better-sqlite3**: updated with major Node versions. Fallback to
  `sql.js` if compilation fails.
- **zod, pino, pino-pretty**: patch-level hour by hour, minor-level
  monthly if the changelog is clean.
- **Dependencies from Caddy/Ollama/whisper.cpp**: the operator keeps
  these up to date separately via `apt` / releases.

Check outdated packages:
```bash
cd $APP_ROOT
npm outdated
npm audit
# CVEs within 7 days, minor updates within 30 days.
```

## 5. Report a Vulnerability

FamilyAssistant is a private project, not a public service. If you are
part of the family or a former developer who finds something concerning:

1. **Do not** open a public GitHub issue with technical details.
2. Send a private message to the project owner with:
   - What you observed
   - How you reproduced it
   - Which version (commit hash from `git rev-parse HEAD`)
3. Response time: we aim to triage within 48 hours, fix within 7 days for
   critical findings.

For the public GitHub repo (`ChristerFrestad/FamilyAssistant`), use
GitHub Security Advisories (private disclosures) if that feature is
enabled.

## 6. Security Checklist Before Deploy

Run through this before `systemctl start familieassistenten` in prod:

- [ ] `NODE_ENV=production` set
- [ ] `AUTH_TOKEN` generated with `openssl rand -hex 32`
- [ ] `ALLOWED_ORIGINS` set to concrete host values (not `*`)
- [ ] `.env` has `chmod 600` and `chown pi:pi`
- [ ] `HTTPS_TERMINATED=true` if behind Caddy
- [ ] `BACKUP_REMOTE_PATH` set if off-site backup is desired
- [ ] Caddyfile configured (LAN internal CA or Tailscale)
- [ ] `ufw` allows only 80/443, not 3000
- [ ] `sudo journalctl -u familieassistenten -p warn` shows no
      `AUTH_TOKEN is required` errors
- [ ] `curl -H "Authorization: Bearer $TOKEN" https://host/api/today`
      returns 200
- [ ] `curl https://host/api/today` without token returns 401
- [ ] `curl -k https://host/health` returns 200 with CSP header
- [ ] `curl https://host/api/status | jq '.breakers'` shows all CLOSED
- [ ] At least one local backup <24h old in `data/backups/`
- [ ] (Off-site) at least one external backup <24h old
