## Sammendrag

Backend-sikkerhets-fundament for Sprint 1 (Prompt 2) — bringer backend fra "ser solid ut" til "bevist solid" før Fase 1e (auth-flyt) og pilot.

Fem områder dekket:

1. **`auth/google.js` test-coverage:** 32.64% → **98.96% lines / 92.31% functions**
2. **Negative multi-tenant-tester:** 13 tester som verifiserer at familie-isolasjon faktisk håndheves
3. **Server-side input-validering:** auditert (alle endepunkter dekket)
4. **Rate limiting:** strict per-IP-grense på `/api/auth/*` (5 req / 15 min) lagt til
5. **Audit-trail:** auditert (eksisterende `audit_log` + `withAudit()`-pattern dokumentert; gap-flagging for pre-deploy)

## Test-coverage før / etter

| Modul | Før (lines/branches/functions) | Etter |
|-------|-------------------------------:|------:|
| `server/auth/google.js` | 32.64% / 100% / 0% | **98.96% / 96.36% / 92.31%** |
| Backend totalt | 83.06% / 73.41% / 80.46% | **83.69% / 73.64% / 81.59%** |

Coverage-gate baseline (80% / 68% / 72%): begge før og etter passerer.

## Tester lagt til

| Fil | Tester | Tema |
|-----|-------:|------|
| `tests/auth-google.test.js` | **31** | OAuth/JWT-flow (PKCE, URL-bygging, JWT-validering, JWK-konvertering, token-exchange) |
| `tests/security-multi-tenant-isolation.test.js` | **13** | Cross-tenant-isolasjon (12 endepunkter + 1 unauth-test) |
| `tests/security-auth-rate-limit.test.js` | **4** | Strict per-IP-rate-limit på `/api/auth/*` |
| **Totalt** | **48** | |

Server-tester totalt: 1258 → **1306** (+48). Skipped: 2 (uendret).

## Endepunkter med ny validering

**Ingen** — auditen viste at alle 87 mutating-endepunkter allerede har enten Zod-validering (32 forekomster), hand-rolled checks i handler, eller service-lag-validering (f.eks. SSRF-beskyttelse i `recipe-url-import`). Ingen "true unvalidated"-endepunkter funnet. Detaljer i `docs/workflow/backend-security-audit-2026-04.md`.

## Rate limiting — konfigurasjon

| Bucket | Threshold | Vindu | Path |
|--------|----------:|------:|------|
| Global (eksisterende) | 300 req | 60 sek | `/*` |
| **Auth (ny)** | **5 req** | **15 min** | `/api/auth/*` |

Begge er sliding-window-per-IP, in-memory. Auth-bucket har egne `X-Auth-RateLimit-*`-headers og dedikert "Auth rate limit"-feilmelding så logger kan splitte brute-force fra generell 429-trafikk.

Configurerbart via `AUTH_RATE_LIMIT_MAX` og `AUTH_RATE_LIMIT_WINDOW_MS` environment-vars.

## Audit-trail — dekning

`audit_log`-tabell (migration 012) og `withAudit()`-helper (`routes.js:87`) eksisterer fra tidligere arbeid. 5 routes wrappes i dag (alle på sensitive DELETE-mutasjoner).

**Gap flagget for pre-deploy (uke 10-11):**

- Login (suksess + fail) — pino-logget, men ikke i `audit_log`
- Logout — pino-logget
- Familie-medlem opprettet/slettet — handlers wrappes ikke i dag
- Magic-link generert — pino-logget
- Family-data eksportert — pino-logget

For pilot er pino-loggingen tilstrekkelig for GDPR Art. 30 incident-response. Strukturert `audit_log`-coverage utvides før pilot-launch.

## KRITISKE flagg

**Ingen.** Audit fant ingen aktive sårbarheter eller manglende auth-sjekker. SSRF-beskyttelse i `recipe-url-import` blokkerer `127.*`, `10.*`, `192.168.*`, `169.254.*`, `0.*`, `::1`, `localhost` — solid pattern.

## Test plan

- [x] `npm run lint` — 0 errors / 0 warnings
- [x] `npm run typecheck` — clean
- [x] `npm run typecheck:client` — clean
- [x] `npm run test` — 1306 / 1308 (2 skipped, 0 fail)
- [x] `npm run test:client` — 180 / 180
- [x] `npm run test:coverage:gate` — over baseline (83.69% / 73.64% / 81.59%)
- [x] `npm run audit:prod` — 0 vulnerabilities
- [x] `npm run build:client` — clean (150.50 kB JS / 26.22 kB CSS — uendret)

## Referanser

- `docs/workflow/backend-security-audit-2026-04.md` — full audit-rapport
- `tests/auth-google.test.js` — OAuth-tester
- `tests/security-multi-tenant-isolation.test.js` — multi-tenant-tester
- `tests/security-auth-rate-limit.test.js` — rate-limit-tester
- `server/http/security.js` — strict per-IP-rate-limiter (lagt til på linje 113-152)

## Etter merge

Klar for **Prompt 3 (Fase 1c — i18n med react-i18next)**.
