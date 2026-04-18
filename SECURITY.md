# Security Policy

**Last updated:** 2026-04-18
**Applies to:** Familieassistenten v1.3.0+

Familieassistenten kjører i to modus:

1. **Lokal selvhost** (RPi5 bak router) — én familie, `AUTH_TOKEN`.
2. **Sky, multi-tenant** (Railway + TLS) — flere familier, Google OAuth
   eller magic-link-innlogging, per-familie LLM-konfig.

Sikkerhetsmodellen dekker begge. Vi forsvarer mot tilfeldig ondsinnet
trafikk, prompt-injeksjoner og tenant-krysning, ikke mot statsaktører.

## 0. Multi-tenant-garantier (fase 1–20)

- **Tenant-isolasjon**: alle familie-skopede repositories leser `family_id`
  fra en `AsyncLocalStorage`-kontekst satt av middleware. Ingen query kan
  returnere data uten denne konteksten. Integrasjonstester i
  `tests/tenant-isolation.test.js` verifiserer at familie A aldri ser
  familie Bs inventory/menyer/oppskrifter/handleliste/kvitteringer.
- **Rolle-håndhevelse**: `owner`/`adult`/`child`-matrise håndheves per
  mutations-endepunkt via `requireRole`. `child` kan ikke POSTe til
  pantry, meny, handleliste eller AI-chat. Se
  `tests/role-enforcement.test.js`.
- **Kryptering av LLM-credentials**: `family_llm_config.api_key_encrypted`
  er AES-256-GCM-kryptert med `ENCRYPTION_KEY` (32 bytes hex, distinkt fra
  `SESSION_SECRET`). Klartekst returneres aldri via API —
  `GET /api/family/llm` returnerer kun `has_key: boolean`.
- **Hashed family-id i observability**: Sentry-integrasjonen (valgfri)
  sender kun SHA-256-truncated family-id som `user.id`. `email`,
  `username`, `ip_address` og request-body scrubbes i `beforeSend`.
  Authorization/Cookie-headere redacted.
- **Session-cookies**: HttpOnly + Secure + SameSite=Lax, 30-dagers TTL,
  signed med `SESSION_SECRET`. Logout invaliderer serverside-sessionen
  og tømmer SW API-cache slik at neste bruker på delt enhet ikke ser
  forrige brukers data.
- **Tenant-sensitive API-endpoints** (`/api/auth/*`, `/api/family/*`,
  `/api/llm-config/*`, `/api/invitations/*`, `/api/onboarding/*`,
  `/api/gdpr/*`) bypasser service-worker-cache eksplisitt — network-only
  slik at en stale bufret respons aldri kan lekke mellom kontoer.

---

## 1. Trusselmodell (STRIDE)

| Kategori | Trussel | Mitigasjon |
|---|---|---|
| **S**poofing | Uautorisert klient på LAN | `AUTH_TOKEN` (≥16 tegn) obligatorisk i produksjon, bearer auth på alle `/api/*` unntatt `/health`, `/ready`, `/metrics` |
| | Caddy serverer feil sertifikat | Caddy intern CA, `caddy trust` installerer rot-cert lokalt |
| | Angriper på offentlig nett | Tailscale Serve eller Let's Encrypt for ekstern tilgang |
| **T**ampering | XSS via recipe-import / LLM | `escapeHtml` i alle `innerHTML`, CSP `script-src 'self' 'unsafe-inline'`, backend `sanitizeString` trimmer tags/control chars |
| | Prompt-injection i LLM-kontekst | `sanitizeForPrompt` fjerner "ignore previous", rolle-hijack, kontrolltegn |
| | Modifisering av lokal DB | SQLite-fil eid av `pi:pi` med `0644`, systemd `ReadWritePaths` begrenser til `data/` |
| | MITM på LAN | HTTPS via Caddy, HSTS når `HTTPS_TERMINATED=true` |
| **R**epudiation | Uklart hvem som gjorde hva | `requestId` i alle log-linjer + problem-body, men single-user på dette nivået |
| **I**nformation disclosure | API-nøkkel i loggen | `pino` redact-paths for `KASSAL_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `AUTH_TOKEN`, `Authorization`-header, `cookie` |
| | `.env`-fil lest av annen bruker | systemd `User=pi`, `.env` settes til `0600 pi:pi` i installasjonsscriptet |
| | Env-nøkler returnert i `/api/settings/env` | `readMasked()` returnerer `●●●●●●●●●•XYZW` — aldri klartekst |
| | Error-traces lekker detaljer i prod | `server/http/server.js` masker interne meldinger til "Intern feil" når `NODE_ENV=production` |
| **D**enial of service | Flood av requests | `RATE_LIMIT_MAX=300`/min per IP (default), Caddy `request_body { max_size 5MB }` |
| | Henger på ekstern backend | Circuit breakers på ollama (3 fails, 30s cooldown), kassal/anthropic (5, 60s) |
| | Uendelig backup-loop | Schedule-driven, én gang per 24t, prune etter 14 dager |
| | Massive payloads | `MAX_BODY_BYTES=1MB` (configurable) |
| **E**levation of privilege | systemd prosess kompromittert | `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp`, `PrivateDevices`, `ProtectKernel*`, `RestrictSUIDSGID` |
| | Symbolic link attack | `ReadWritePaths=$APP_ROOT/data` — DB-filen er eneste skriving |

---

## 2. Sensitiv data i prosjektet

Dette er data som finnes i produksjonsinstallasjonen og krever ekstra vare:

- **API-nøkler** (Kassal, OpenAI, Anthropic, xAI) — lagres i `.env`,
  permissions `0600`, aldri logged. Kan settes/rotert via Settings-UI
  som skriver via `env-store.service` med atomic write + backup.
- **AUTH_TOKEN** — systemd environment (`systemctl edit`) eller separate
  `/etc/familieassistenten.env`. Minimum 32 hex-tegn (`openssl rand -hex 32`).
- **Familiedata** — medlemmer, allergier, mislikt mat, handlemønster,
  LLM-chat-historikk. Alt ligger i SQLite-filen `data/familieassistenten.db`.
  Backup-filer krypteres ikke (hjemme-nett only) — bruk `rsync` over SSH
  for off-site og stol på SSH-nøkkelen, eller manuell GPG-kryptering.
- **Kvitteringer + OCR-tekst** — tekst-ekstrakter kan inneholde navn/adresser.
  Lagres i `receipts`-tabellen, samme sensitivitet som DB ellers.

### 2.1 PII i dokumentasjon — policy

**Ingen PII skal committes i repo-tekst.** Dette dekker:

- Navn på familiemedlemmer utover prosjekt-eieren (for author-attribution)
- Adresser, postnummer, telefon, personnummer
- Bilder eller navn på barn
- Spesifikke butikk-lokasjoner (bruk generisk butikk-navn uten bydel
  eller by — f.eks. "Kiwi" i stedet for "Kiwi <bydel>")
- Kalender-lokasjoner (bruk test-verdier som "Testveien 1" i fixtures)

**Hvorfor:** Repoet kan en dag bli delt, klonet av nye bidragsytere,
eller eksponert via logs/backups. PII i git-historien er vanskelig
å fjerne senere (krever force-push + history rewrite).

**Ved oppdagelse av PII i committed kode:** Kjør `git log --all -p |
grep -i <trigger>` for å finne alle forekomster, bruk `git filter-repo`
eller squash-rewrite for å fjerne fra hele historikken. Force-push og
varsle alle som har clonet.

**Hva operatøren gjør i prod:** Familiespesifikk data (navn, allergier,
preferanser) legges i family_profile-tabellen via Kontrollrommet-UIet.
Det er kun i SQLite-databasen lokalt på enheten — aldri i git.

## 3. Kjente svakheter og trade-offs

Disse er akseptert risiko, dokumentert her så nye utviklere forstår:

- **CSP har `'unsafe-inline'` for script** — `public/index.html` er én stor
  fil med inline-handlers (`onclick="..."`). Planen var å modularisere i M5,
  men ble utsatt til v1.3 for å unngå blast radius av en 3700-linje refaktor.
  `escapeHtml`-helperen gir bunden sikkerhet selv uten nonce/hash-baserte CSP.
- **~~Ingen audit-logg~~ Dedikert audit-log fra v1.3** — destruktive
  operasjoner (DELETE/PUT på profile, pantry, sources, receipts, calendar)
  logges i `audit_log`-tabellen med request-id, SHA-256 før/etter-hash og
  tidsstempel. Eksponeres read-only via `/api/audit`. Append-only på
  API-nivå. Se SBOM-6 i CHANGELOG.md.
- **Rate-limit er in-memory** — nullstilles ved restart, ikke delt mellom
  noder. Akseptabelt for single-node RPi5.
- **Ingen 2FA** — kun bearer-token. Token-kompromittering gir full tilgang.
- **`sw.js` bufrer API GET-responses** — inneholder ikke-sensitive data
  (meal plans, chores) men en fysisk enhet med cache-tilgang kan lese
  gammel data. Scope er samme device, så samme risiko som DB-tilgangen.

## 4. Supply-chain policy (fra v1.3)

### 4.1 SBOM (Software Bill of Materials)

Hver release-bygging genererer en **CycloneDX 1.6** SBOM som dekker alle
runtime-avhengigheter (produksjons-bundle, ekskluderer devDeps).

- **Lokalt:** `npm run sbom` → `sbom.json`
- **Full (inkl. dev):** `npm run sbom:full` → `sbom-full.json`
- **CI:** `sbom`-jobben i `.github/workflows/ci.yml` genererer og laster opp
  SBOM-en som build-artifact ved hver push. Beholdes i 90 dager.
- **Release:** `.github/workflows/release.yml` vedhefter `sbom.json` til
  hver GitHub Release (taggede versjoner `v*`).

SBOM gir downstream-brukere muligheten til å krysssjekke egne avhengigheter,
møte NIS2 / US EO 14028 supply-chain-krav, og rask CVE-kartlegging.

### 4.2 OSV-Scanner (vulnerability feed)

Google's [Open Source Vulnerabilities](https://osv.dev) database scannes
på hvert CI-kjøring via `google/osv-scanner-action`.

- **Gate:** CI feiler hvis HIGH/CRITICAL-sårbarheter finnes i `package-lock.json`.
- **Output:** SARIF-fil lastes opp til GitHub Security-tabben (krever
  `security-events: write`-permission).
- **Reaksjonstid:** Hvis OSV-Scanner flagger en HIGH/CRITICAL CVE, skal
  den patches eller workaround etableres **innen 7 dager**. Dokumenter i
  issue eller CHANGELOG.

### 4.3 npm audit

Komplementerer OSV-Scanner med npm-sin egen database:

- `npm audit --omit=dev --audit-level=high` kjøres som eget CI-steg
  (`security`-jobben). Feiler ved HIGH+.
- `npm audit --audit-level=moderate` (inkl. dev) kjøres som informativt
  steg, ikke blokkerende.

### 4.4 SLSA Level 3 provenance

Release-artifacts er kryptografisk signert med build-herkomst:

- `release.yml` bruker `slsa-framework/slsa-github-generator` for å generere
  en signert `.intoto.jsonl` fil som beskriver hvem, hva, når, og hvordan
  artifact-et ble bygget.
- Ingen private nøkler i repoet — signeringen skjer via GitHub OIDC +
  Sigstore Fulcio/Rekor (keyless signing).
- Verifisering downstream:
  ```bash
  slsa-verifier verify-artifact \
    --provenance-path familieassistenten-v1.3.0.intoto.jsonl \
    --source-uri github.com/ChristerFrestad/FamilyAssistant \
    familieassistenten-v1.3.0.tar.gz
  ```

### 4.5 Token rotation

`AUTH_TOKEN` skal roteres **minst hver 90. dag**. Mekanikk:

1. Operatør setter ny token i `.env` eller `systemd environment`:
   ```bash
   NEW_TOKEN=$(openssl rand -hex 32)
   # Oppdater AUTH_TOKEN og AUTH_TOKEN_CREATED_AT
   ```
2. `AUTH_TOKEN_CREATED_AT=2026-04-10T12:00:00Z` (ISO-8601).
3. Appen leser dette i `config.js` og /ready flagger warning
   `auth_token_stale_<N>d` når `N > AUTH_TOKEN_MAX_AGE_DAYS` (default 90).
4. Hvis `AUTH_TOKEN` er satt men `AUTH_TOKEN_CREATED_AT` mangler, returnerer
   /ready en `auth_token_age_unknown`-warning i produksjon.

Rate-limit CI-gate og audit-log fanger eventuell misbruk mellom rotasjoner.

### 4.6 Dependabot

`.github/dependabot.yml` åpner ukentlige PR-er (mandager 07:00 Europe/Oslo):

- **npm (production + development)** — grupperte minor/patch for mindre støy,
  separate PRs for major.
- **GitHub Actions** — action-versjoner.

Alle Dependabot-PRs skal kjøre gjennom vanlig CI-gate (lint + format + test
+ coverage + SBOM + OSV-scan) før merge.

### 4.7 Oppdaterings-policy

- **Node.js**: hold på siste LTS (20.x p.t.). Sjekk `package.json#engines`.
- **better-sqlite3**: oppdateres ved større Node-versjoner. Fallback til
  `sql.js` hvis kompilering feiler.
- **zod, pino, pino-pretty**: patch-level fra time til time, minor-level
  månedlig hvis endringslog er ren.
- **Avhengigheter fra Caddy/Ollama/whisper.cpp**: operatør holder disse
  oppdatert separat via `apt` / releases.

Sjekk utdaterte pakker:
```bash
cd $APP_ROOT
npm outdated
npm audit
# CVE-er innen 7 dager, minor-updates innen 30 dager.
```

## 5. Rapporter en sikkerhetssvakhet

Familieassistenten er et privat prosjekt, ikke en offentlig tjeneste.
Hvis du er en del av familien eller en tidligere utvikler som finner
noe bekymringsverdig:

1. **Ikke** åpne en public GitHub-issue med tekniske detaljer.
2. Send en privat melding til prosjektets eier med:
   - Hva du observerte
   - Hvordan du reproduserte det
   - Hvilken versjon (commit-hash fra `git rev-parse HEAD`)
3. Responstid: vi målfører innen 48 timer, fix innen 7 dager for
   kritiske funn.

For public GitHub-repo (`ChristerFrestad/FamilyAssistant`), bruk
GitHub Security Advisories (private disclosures) hvis den funksjonen er
aktivert.

## 6. Sikkerhets-sjekkliste før deploy

Kjør gjennom denne før `systemctl start familieassistenten` i prod:

- [ ] `NODE_ENV=production` satt
- [ ] `AUTH_TOKEN` generert med `openssl rand -hex 32`
- [ ] `ALLOWED_ORIGINS` satt til konkrete host-verdier (ikke `*`)
- [ ] `.env` har `chmod 600` og `chown pi:pi`
- [ ] `HTTPS_TERMINATED=true` hvis bak Caddy
- [ ] `BACKUP_REMOTE_PATH` satt hvis off-site backup er ønsket
- [ ] Caddyfile konfigurert (LAN intern CA eller Tailscale)
- [ ] `ufw` tillater bare 80/443, ikke 3000
- [ ] `sudo journalctl -u familieassistenten -p warn` viser ingen
      `AUTH_TOKEN er påkrevd`-feil
- [ ] `curl -H "Authorization: Bearer $TOKEN" https://host/api/today`
      returnerer 200
- [ ] `curl https://host/api/today` uten token returnerer 401
- [ ] `curl -k https://host/health` returnerer 200 med CSP-header
- [ ] `curl https://host/api/status | jq '.breakers'` viser alle CLOSED
- [ ] Minimum én lokal backup <24t gammel i `data/backups/`
- [ ] (Off-site) Minimum én ekstern backup <24t gammel
