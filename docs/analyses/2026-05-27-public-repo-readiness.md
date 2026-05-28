# Public-repo readiness — exhaustive audit 2026-05-27

> Read-only, full-coverage audit. Ingen kode endret. Erstatter den
> tidligere "nok funn"-versjonen etter eksplisitt korreksjon:
> komplett dekning, ikke representativt utvalg.
>
> **Scope dekt:** alle 104 tracked .md-filer, alle .sh/.ps1/.yml/.json
> config-filer, `server/`, `client/src/`, `scripts/`, `tests/`,
> `public/`, `types/`, alle `docs/`-subkataloger, `.github/`,
> `Caddyfile`, `Dockerfile`, `docker-compose.yml`, `familieassistenten.service`,
> alle env-eksempler, hele git-historikken (273 commits, 40 branches,
> 1 tag, alle deleted blobs >100KB), og untracked filer i arbeidstreet.
> 6 parallelle agenter + direkte lesing av alle public-facing docs.
> 8200+ linjer prosa, ~250 source-filer, 273 commits scannet.

---

## 0. AKUTT — må gjøres FØR public, og helst NÅ uansett

### 0.1 PILOT_PASSWORD = 'Andromeda' i tracked tester

**Filer:**
- `tests/cookie-secure-flag.test.js:112, 304, 324, 346, 363`
- `tests/pilot-gate-lockout-fix.test.js:38, 147, 168`

Strengen `Andromeda` brukes 8 ganger i to test-filer som
`PILOT_PASSWORD`-verdi inne i `NODE_ENV='production'`-simuleringer.

Standardmønstre for test-stub er `'a'.repeat(32)`,
`'test-...-1234567890abcdef'`, `'pilot-secret-XYZ-123'` — alle finnes
også i samme test-suite (`pilot-password.test.js`).

`Andromeda` skiller seg ut: kort, menneskevalgt, ingen test-marker.

**Spørsmål til deg:** er `Andromeda` ditt faktiske pilot-passord på
`app.hverdagsplanleggeren.com`?

| Svar | Handling |
|---|---|
| Ja | **Roter passordet NÅ** (uavhengig av public-repo), bytt verdien i begge test-filer til `'TEST_PILOT_PASSWORD'` eller liknende. Hvis ekte passord var lagt inn tidligere, ligger det i git-historikken og kan ikke fjernes uten rewrite — så rotering er obligatorisk uansett. |
| Nei | Test-fixture er ufarlig. Vurder likevel å bytte til `'test-pilot-password'`-mønster så ingen leser feil om 6 måneder. |

### 0.2 USER-FACING tekst navngir deg med fornavn

**Filer:**
- `client/src/app/i18n/locales/no/auth.json:28`
- `client/src/app/i18n/locales/en/auth.json:28`

Innhold (norsk versjon): `"lockout": "Du har forsøkt flere ganger. Christer trenger at du venter i 10 minutter..."`

Denne meldingen vises faktisk til **pilot-brukerne dine** når pilot-
password-gate sin lockout slår inn. Andre familier som forker
prosjektet og deployer sin egen instans vil også vise "Christer trenger
at du venter" — som er feil for dem.

Bør parameteriseres med `{{appName}}` eller `{{ownerName}}` fra brand-
config. Strengen ligger også som onboarding-placeholders i samme fil
(`"F.eks. Frestad-familien"`, `"F.eks. Christer"` linje 74, 86).

### 0.3 Untracked filer med hardkodet e-post

**Filer (untracked, vises i `git status` ved konversasjons-start):**
- `db-check.js` — hardkoder `christer@frestad.com` i SQL-queries (linjer 6, 12, og `'%Frestad%'` på linje 18)
- `db-pantry-check.js` — ingen e-post, men hardkoder DB-stier

Hvis du noensinne kjører `git add .` eller `git add -A` ryker disse
inn. **Slett dem nå**, og legg `db-*.js` i `.gitignore`.

### 0.4 `release.yml` SLSA private-repository flag

**Fil:** `.github/workflows/release.yml:89`

Workflow har `private-repository: true` for SLSA-generator med en
norsk kommentar som sier "Prosjekt-eieren har godkjent denne
privacy-kompromissen". Når repo blir public må dette enten flippes
til `false` eller fjernes (SLSA Level 3 keyless signing fungerer
ikke korrekt med feil flag).

---

## 1. Sammendrag (TL;DR)

| Område | Status | Risiko | Antall treff |
|---|---|---|---|
| **Ekte hemmeligheter (AKIA/sk_live/ghp_/JWT/PEM/etc.)** | Ingen funn | Lav | 0 |
| **`Andromeda` som PILOT_PASSWORD i tester** | **Krever bekreftelse** | **Høy hvis ekte** | 8 (2 filer) |
| **`christer@frestad.com` i tracked filer** | Funnet | Moderat | 14 tracked filer, 9 commits |
| **`kommik303030@gmail.com` som git-author** | Funnet | Høy — ikke fjernbar | 175 av 273 commits (64%) |
| **`192.168.50.123` (RPi LAN IP)** | Funnet | Moderat | 7 tracked filer |
| **`/home/christer/...` i prod-stier** | Funnet | Moderat | `deploy-portainer.md` 8 linjer |
| **`/home/frestad/...` i prod-sti** | Funnet | Moderat | `prod-enricher-disconnect.md:42` |
| **`Christer` navngitt i USER-FACING tekst** | Funnet | Høy for white-label | `auth.json` lockout-melding (NO+EN) |
| **`Christer` i kode-kommentarer** | Funnet | Lav | ~100 stedet i `server/`+`client/` |
| **`Christer Frestad` i dev-preview Avatar-fixture** | Funnet | Lav | `Avatar.tsx` (5 linjer) |
| **`hverdagsplanleggeren.com`** | Funnet | Lav (intentional brand) | 34 filer, 13 commits |
| **`app.hverdagsplanleggeren.com` i privacy.html** | Funnet | Høy (vises til alle deployers) | 2 filer |
| **HTTP User-Agent eksponerer `github.com/ChristerFrestad`** | Funnet | Lav | `recipe-url-import.service.js:13` |
| **Untracked DB-script** | Funnet | Akutt | 2 filer |
| **Untracked `data/`-katalog** | OK | Dekket av `.gitignore` | — |
| **Personlige fotos / store binærfiler i historikk** | Ingen funn | OK | Største: 395 KB UI-mockup |
| **Norske dokumenter** | Funnet | Stor jobb hvis full oversettelse | 104 .md, ~62 server, ~93 client, ~59 tests |
| **Brand-navn-inkonsistens (`familieassistenten` vs `FamilyAssistant`)** | Funnet | Public-readiness gap | 15+ filer |

**Hovedanbefaling:** Splitt jobben i 7 PR-er (se §13). Aksepter norsk
git-historikk. Pragmatisk språk-split. Bekreft Andromeda **i dag**
uavhengig av public-repo-beslutning.

---

## 2. Komplett PII- og infrastruktur-inventory

### 2.1 Personlig e-post (`christer@frestad.com` + varianter)

**Eksakt treff-tabell (alle tracked filer):**

| Fil | Linjer | Kontekst | Anbefaling |
|---|---|---|---|
| `db-check.js` (untracked!) | 6, 12 | SQL-query mot users-tabellen | **Slett filen** |
| `AGENT_LOG.md` | 432 | Test-instruks i logg-innlegg | La stå (append-only historie) |
| `docs/runbooks/deploy-portainer.md` | 50 | Env-tabell: `APP_ADMIN_EMAIL = christer@frestad.com` | **Bytt til `your-admin@example.com`** |
| `docs/analyses/2026-04-29-atomic-onboarding.md` | 645, 664 | SQL-snapshot av users-tabell med real data | **Maskér** (eller `2026-04-29-internal/`) |
| `docs/analyses/2026-05-01-fase-2f-settings.md` | 357 | Manuell test-instruks ("Logg inn som owner") | **Maskér** |
| `docs/analyses/2026-05-03-pre-pilot-comprehensive-audit.md` | 194 | SQL-snapshot av users-tabell | **Maskér** |
| `docs/analyses/2026-05-04-admin-role-bootstrap.md` | 12, 52 | Eksempel-Portainer-env-verdi | **Maskér** |
| `client/src/app/family/useFamilyData.test.tsx` | 43 | Test-fixture | Bytt til `alice@example.com` |
| `client/src/app/screens/Dashboard.test.tsx` | 21 | Test-fixture | Bytt til `alice@example.com` |
| `client/src/app/screens/Family.test.tsx` | 24, 128 | Test-fixture | Bytt til `alice@example.com` |
| `client/src/app/components/dashboard/WelcomeHeader.tsx` | 11 | Kode-kommentar | Bytt til generisk eksempel |
| `client/src/app/components/dashboard/WelcomeHeader.test.tsx` | 17, 62, 96 | Test-fixtures | Bytt til `alice@example.com` |
| `client/src/app/components/family/MemberCard.test.tsx` | 43 | Test-fixture | Bytt til `alice@example.com` |
| `docs/analyses/2026-05-27-public-repo-readiness.md` | (mange) | Dette dokumentet selv | OK |

**Varianter på samme domene:**

| Variant | Filer:linjer |
|---|---|
| `kid@frestad.com` | `client/src/app/screens/Family.test.tsx:37, 312` |
| `pilot@frestad.com` | `client/src/app/screens/a11y.test.tsx:27, 139` |
| `Christer@Frestad.COM` | `tests/admin-bootstrap.test.js:73` (test for case-insensitivitet) |

**Bekreftet i git-historikk:** `christer@frestad.com` introdusert i
9 commits. Kan ikke fjernes fra historikk uten force-push-rewrite
(DEL 1 #7 forbyr det).

**`@gmail.com`-treff** (3 stk):
- `design/2026-04-redesign/source/Familieassistenten.html:2209` — template literal `${name.toLowerCase()}@gmail.com` (mockup, ikke ekte)
- `design/redesign-exploration-2026-04/project/Familieassistenten.html:2209` — duplikat
- Dette dokumentet selv (referer historisk git-author)

**`kommik303030@gmail.com`:** Ingen treff i tracked source-filer
(bortsett fra denne audit-doc-en). Finnes **kun** som git-author på
175 av 273 commits.

### 2.2 Private IP-adresser

**`192.168.50.123` (din RPi LAN-IP) — 7 tracked filer:**

| Fil:linje | Kontekst | Anbefaling |
|---|---|---|
| `CHANGELOG.md:188` | "on plain-HTTP LAN (`http://192.168.50.123:7777`)" | Maskér til `<lan-ip>` |
| `docs/runbooks/deploy-portainer.md:193` | Healthcheck-eksempel | Maskér til `<rpi-ip>` |
| `docs/analyses/2026-05-04-cookie-secure-flag-fix.md:11, 20, 72` | Bug-rapport (3 forekomster) | Maskér eller flytt til `internal/` |
| `docs/analyses/2026-05-04-v2-bundle-not-in-image.md:10` | Bug-rapport | Maskér eller flytt til `internal/` |
| `tests/cookie-secure-flag.test.js:7` | Kommentar i test | Maskér til `<lan-ip>` |
| `tests/llm-ollama-url.test.js:9, 10` | Test-data for URL-normalisering | **Bytt til `192.0.2.1`** (RFC 5737) |

**`192.168.50.50`** (én linje, eksempel-IP):
- `Caddyfile:38` — RPi5 placeholder. Bytt til `192.168.1.50` med kommentar "Bytt til RPi5s faktiske LAN-IP".

**Generiske RFC 1918-eksempler (OK):**
- `192.168.1.50` i `DEPLOY.md:505`
- `192.168.1.1`, `192.168.1.5` i `tests/m2-reliability.test.js:214, 219`, `tests/recipe-url-import.test.js:99`
- `192.0.2.1` i `tests/sentry-integration.test.js:100` (korrekt RFC 5737-bruk)

**Bekreftet ikke funnet:** Ingen public IPv4-adresser, ingen IPv6,
ingen MAC-adresser, ingen norske telefonnummer, ingen norske
postnummer i adresse-kontekst, ingen kredittkortnummer, ingen IBAN,
ingen fødselsnummer.

### 2.3 Absolutte filsystem-stier

**`/home/christer/` — `docs/runbooks/deploy-portainer.md`, 8 linjer:**
- Linjer 14, 18, 19, 20, 34, 35, 146, 147 — alle bruker `/home/christer/familieassistenten-data/` som volume-mount-path

**`/home/frestad/` — `docs/analyses/2026-05-prod-enricher-disconnect.md`:**
- Linje 42: `/home/frestad/familieassistenten-data/data/familieassistenten.db`
- Linje 158: SSH-kommando-template `ssh frestad@<pi-ip>` — bekrefter Unix-brukernavn er `frestad` på Pi-en

**`/home/pi/` (generisk RPi-default — OK):**
- `.env.example:92, 105, 106` — som kommentar-eksempel
- `familieassistenten.service:18-19, 47` — `User=pi`, `WorkingDirectory=/home/pi/Familieassistenten`, `ReadWritePaths=...`. `install.sh` patcher disse runtime.

**`/mnt/` (generiske NAS-eksempler — OK):**
- `.env.example:105-106` — eksempel-paths
- `RUNBOOK.md:105`, `server/backup.js:8, 107`, `tests/m2-reliability.test.js:223` — generiske

**Bekreftet ikke funnet:** Ingen `C:\Users\kommi\`-stier i source.
Ingen `/Users/` (macOS user-paths).

### 2.4 Personnavn — Christer/Frestad i tracked filer

**Bekreftet intentional / fine to keep:**

- `LICENSE:3` — © Christer Frestad
- `package.json:120` — `"author": "Christer Frestad"`
- `README.md:169` — License copyright
- `Dockerfile:129` — `LABEL org.opencontainers.image.authors="Christer Frestad"`
- `CLAUDE.md:3, 1140` — agent-instruks-eier
- `CONTEXT.md:12` — eier-felt
- `REFERENCES.md:256` — eier-info
- `.github/CODEOWNERS` — alle linjer `@ChristerFrestad` (GitHub-username, intentional)
- `.github/dependabot.yml` — reviewer-felt
- `tests/phase21-repo-hygiene.test.js:39` — policy-test asserterer at README inneholder ditt navn

**USER-FACING (krever endring — andre families ser dette):**

- `client/src/app/i18n/locales/no/auth.json:28, 74, 86` — lockout-melding + onboarding-placeholders
- `client/src/app/i18n/locales/en/auth.json:28, 74, 86` — engelsk versjon
- `public/privacy.html:128` — "Christers pilot-RPi har volum-kryptering aktivert"
- `public/privacy-en.html:131` — engelsk versjon

**Dev-preview / fixtures (vurder å endre):**

- `client/src/dev/preview/sections/components/Avatar.tsx:17, 34, 47, 77, 83` — hardkoder "Christer Frestad" som fixture-navn
- `client/src/app/components/display/Avatar.tsx:16` — eksempel i JSDoc-kommentar

**Kode-kommentarer (~100 treff totalt — kategorisert):**

Server-side:
- `server/config.js:16` — "Christer's Hverdagsplanleggeren"
- `server/auth/sessions.js:44` — "locked Christer's first pilot deploy out"
- `server/routes.js:1118` — "bug Christer reported on the Phase 2E pantry sub-view"
- `server/services/pantry-deduction.service.js:17, 26` — "Christer's decision", "Christer's mental model"
- `server/migrations/021_users_onboarding_completed.sql:12` — "Christer is the only existing"
- `server/migrations/022_magic_link_token_hash.sql:8` — "Christer's pilot RPi5"

Client-side (representativt utvalg — totalt ~50+ tilfeller):
- `client/src/app/dashboard/dashboardApi.ts:3` — "Christer's Strategy A"
- `client/src/app/components/settings/{LogoutButton,DeleteAccountButton}.tsx:3` — "Christer-confirmed"
- `client/src/app/components/pantry/ExpiryBadge.tsx:3` — "Tilleggsoppdrag fra Christer (B5)"
- `client/src/app/components/pantry/UseDialog.tsx:1` — "Christer-bekreftet B3"
- `client/src/app/hooks/useBrandConfig.ts:7` — "Christer's guidance"
- `client/src/app/screens/Settings.tsx:3` — "Christer-confirmed"
- `client/src/app/components/dashboard/WelcomeHeader.tsx:11, 31` — flere
- `client/src/app/components/brand/Wordmark.tsx:36` — "Christer's verification"
- `client/src/app/components/meals/RecipeIngredients.tsx:15` — "because Christer..."
- `client/src/app/components/form/PortionFactorSlider.tsx:96` — "Christer's clarification"

Scripts:
- `scripts/inspect-family-1-state.js:96`, `scripts/e2e-tenant-isolation.js:6`, `scripts/cleanup-orphan-family-1.js:146`
- `scripts/local-ci.sh:84` + `scripts/local-ci.ps1:90` — siterer literal push-trigger-frase `'nå kan vi pushe'`

Test-fixtures med `Frestad`-familienavn (intentional men personlig):
- `tests/email-invitation-locale.test.js` — minst 20 treff av `inviterName: 'Christer'`, `familyName: 'Frestad'`
- `tests/family-invitation-{extension,message}.test.js` — `'Frestad-A'`, `'Frestad-B'`, `'Frestad-msg'`-prefiks
- `tests/auth-onboarding-complete.test.js:45, 46, 183, 191, 197, 204` — `'Familien Frestad'`, `'Christer'`

**Familie-medlems-navn (verifiser med deg):**
- `docs/analyses/2026-04-22-per-member-diet.md:96` — "Lise" og "Kari" som eksempel-familiemedlemmer. Ekte familiemedlemmer eller illustrative navn? Bekreft.

### 2.5 Personlige domener

**`hverdagsplanleggeren.com` — 34 filer, 13 commits:**

Intentional brand-references (behold):
- `README.md:139` — white-label-eksempel
- `docs/BRAND_SYSTEM.md:133` — brand-config-tabell
- `docs/operations/PORTAINER_BRANDING_SETUP.md` — extensiv bruk som canonical eksempel
- `docs/runbooks/deploy-portainer.md` — multiple
- `tests/brand-config-validation.test.js` — verifiserer parsing
- `client/src/app/i18n/app-name.test.ts` — verifiserer override-mekanikk
- `client/src/app/hooks/useBrandConfig.test.ts` — test-fixtures

USER-FACING (krever endring):
- `public/privacy.html:134` — `app.hverdagsplanleggeren.com` som "Active (pilot)" Cloudflare Tunnel-host
- `public/privacy-en.html:136` — engelsk versjon

Kode-kommentarer:
- `server/config.js:16`, `server/services/pilot-password.service.js:6`
- `client/src/app/components/brand/Wordmark.tsx:9, 38`
- `client/src/app/screens/auth/Welcome.tsx:11`
- `client/src/app/styles/{brand-tokens.ts:5, tokens.css:84}`

Runbook-kontekst:
- `docs/runbooks/ci-cd-pipeline.md:71` — `app.hverdagsplanleggeren.com/health` som healthcheck-eksempel
- `docs/runbooks/deploy-portainer.md` — multiple (12, 45, 78, 100, 107, 110, 115, 121, 172)

**`frestad.com` som domene-navn:**
- `REFERENCES.md:260` — eksplisitt: "Domene: frestad.com (ikke aktivt for app-deploy nå)" — bekrefter du eier domenet

**`frestad.no`:** Ingen treff.

### 2.6 GHCR-image-namespace

**`ghcr.io/christerfrestad/familyassistant`** — 14+ filer:
- `Dockerfile` doc-block linje 23-27
- `docker-compose.yml:27` — default image: `${TAG:-main}`
- `install.sh` doc-header
- `README.md:51` — quickstart
- `DEPLOY.md` §16 (Portainer-deploy)
- `docs/runbooks/deploy-portainer.md` — multiple
- `docs/runbooks/b1-deploy-checklist.md`
- `docs/runbooks/ci-cd-pipeline.md`
- `docs/runbooks/llm-cache-key-policy.md`
- `docs/operations/PORTAINER_BRANDING_SETUP.md`
- `docs/baselines/2026_W17.md`
- `docs/known-issues/portainer-session-secret-deploy-gate.md`
- `CHANGELOG.md`

GHCR-namespacet er public via GitHub uansett (du har allerede published images der). **Vurdering:** lav risiko som-er.

### 2.7 HTTP User-Agent — load-bearing kode

**`server/services/recipe-url-import.service.js:13`:**
```js
USER_AGENT = 'FamilyAssistant/1.0 (+https://github.com/ChristerFrestad/FamilyAssistant)'
```

Denne sendes ut til oppskrift-nettsteder du importerer fra. Alle de
nettstedene logger din User-Agent med GitHub-link inkludert.
GitHub-username er public. **Vurdering:** Lav risiko, men du kan
parameterisere med `APP_NAME` og en konfigurerbar repo-URL hvis
white-label skal være helhetlig.

---

## 3. Hemmeligheter-skann — komplett

### 3.1 Skannede mønstre (alle returnerte 0 treff)

| Mønster | Resultat |
|---|---|
| `AKIA[0-9A-Z]{16}` (AWS access key) | 0 treff |
| AWS secret (40-char base64 i cred-kontekst) | 0 treff |
| `ghp_[a-zA-Z0-9]{36}` / `gho_` / `ghs_` / `ghu_` (GitHub PAT) | 0 treff |
| `glpat-` (GitLab PAT) | 0 treff |
| `xox[bsap]-` (Slack tokens) | 0 treff |
| `sk_live_` / `pk_live_` (Stripe) | 0 treff |
| `SK[a-z0-9]{32}` / `AC[a-z0-9]{32}` (Twilio) | 0 treff |
| `SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}` (Sendgrid) | 0 treff |
| `eyJ...eyJ...` (JWT) | 0 treff (eneste treff er truncated mockup `eyJhbGciOi...`) |
| `Bearer\s+[a-zA-Z0-9._-]{30,}` (Bearer tokens) | 1 treff (test stub) |
| `-----BEGIN .* PRIVATE KEY-----` | 0 treff |
| `ssh-(rsa|ed25519|dss|ecdsa) AAAA` | 0 treff |
| `password\s*[:=]\s*['"][^'"]{6,}` (hardkodet passord) | Kun test-fixtures |
| Kredittkort (Luhn-ish) | 0 treff |
| IBAN | 0 treff |
| Norsk fødselsnummer (11 siffer i personlig-kontekst) | 0 treff |

### 3.2 Test-fixtures (alle åpenbare stubs)

- `tests/fase-f6-env-store.test.js` — `sk-test*` og `sk-ant-concurrenttest123`
- `tests/llm-config.test.js` — `sk-ant-xxx`, `sk-ant-plaintext-should-not-be-stored`, `sk-ant-test`
- `tests/auth-onboarding-complete.test.js:234` — `'onb-me-token-0123456789012345'`
- `tests/m-week2-supply-chain.test.js:263, 280` — `'a'.repeat(32)`, `'b'.repeat(32)`
- `tests/pilot-password.test.js:21, 67, ...` — `'pilot-secret-XYZ-123'`, `'anything'`
- `tests/cookie-secure-flag.test.js:107-108`, `tests/pilot-gate-lockout-fix.test.js:35` — generiske auth-tokens med "test-"-prefiks

### 3.3 **Ett spørsmål du må svare på**

`tests/cookie-secure-flag.test.js` + `tests/pilot-gate-lockout-fix.test.js`:
**`PILOT_PASSWORD = 'Andromeda'` (8 forekomster)**

Se §0.1 over. Dette er det eneste i hele repoet som ser ut til å
potensielt være et ekte passord. Bekreft.

### 3.4 `.env` og `bootstrap.json`-håndtering

- `.env` og `.env.*` er `.gitignore`-dekket (linje 13-15)
- `bootstrap.json` har ALDRI vært committet (verifisert via git history)
- `.env.example` er tracked og kun inneholder placeholders + Norske kommentarer (266 linjer)

---

## 4. Untracked filer i arbeidstreet

Fra `git status` ved konversasjons-start:

| Path | Innhold | Anbefaling |
|---|---|---|
| `data/` | 4 ekte SQLite-filer (.db) + 3 backup-filer + WAL/SHM | Allerede dekket av `.gitignore` (`data/*.db`, `data/backups/`). **OK.** |
| `db-check.js` | `christer@frestad.com` i SQL (linjer 6, 12, 18) | **Slett + legg i `.gitignore`** |
| `db-pantry-check.js` | DB-stier, ingen e-post | **Slett + legg i `.gitignore`** |

---

## 5. Git-historikk — komplett oversikt

### 5.1 Autoritets-fordeling (273 commits)

```
175 commits  kommik303030@gmail.com               (Christer Frestad)        ← personal Gmail
 89 commits  82406432+ChristerFrestad@users.noreply.github.com  (ChristerFrestad)  ← GitHub privacy
  9 commits  49699333+dependabot[bot]@users.noreply.github.com               ← Dependabot
```

64 % av historikken bruker personal Gmail. **Ikke fjernbar uten
force-push-rewrite** (CLAUDE.md DEL 1 #7 forbyr det).

### 5.2 Branches og tags

- **40 lokale branches**, hvorav 6 har unmerged content:
  - `chore/perf-harness-hardening` (+7 commits)
  - `chore/multi-tenant-audit-and-fix` (+2)
  - `chore/sprint-11-analyse` (gjeldende, +2)
  - `feat/sprint-6-finalize-with-coupling` (+6)
  - `feat/meal-planning-picker` (+2)
  - `fix/wordmark-dark-mode` (+1, allerede merget via PR #126)
- **28 stale lokale branches** (0 commits ahead av main) — vurder cleanup
- **3 remote refs** (`origin/HEAD`, `origin/main`, `origin/chore/sprint-11-analyse`)
- **1 tag** (`v1.3.0`)
- **0 stashes**
- **0 submodules**

### 5.3 Deleted files (60 unique)

Sensitive-pattern-skann (`.env|secret|key|cred|bootstrap|.db|.sql|backup|dump|email`): **0 treff** bortsett fra `tests/phase22-bootstrap.test.js` (test-fil for bootstrap-wizard, ikke bootstrap.json selv).

**Ingen `.env`, `.db`, `.sql`, secret-filer eller credential-filer
har noensinne vært committet.**

Notable deletions (alle legitime):
- `railway.json` + `phase18/phase19-test`-filer — Railway retired Sprint 2.6
- Hele `public/js/`, `public/*.html` etc. — legacy v1 frontend slettet Sprint 8 (PR #118)
- `BRUKERGUIDE.md`, `docs/RELEASE_V1_3_0.md`, `RISK_REGISTER.md`, `SAFETY_CASE.md`, `TYPE_COVERAGE.md` — superseded docs

### 5.4 Største blobs i historikk

Tærskel >100 KB returnerer 32 blobs. Alle benigne:

| Størrelse | Path | Notater |
|---|---|---|
| 395 KB | `design/2026-04-redesign/source/uploads/pasted-1776677964209-0.png` | UI mood-board screenshot (verifisert: 3 generiske app-mockups, ingen personlig foto) |
| 361 KB | `package-lock.json` (flere revisjoner) | npm lockfile |
| 277 KB | `server/routes.js` | Application code |
| 211 KB | `design/.../draw-08aebf3c-*.png` | Design-mockup (verifisert generisk) |
| 204 KB | `design/.../draw-ec148452-*.png` | Design-mockup |
| 199 KB | `design/.../draw-a9b44c22-*.png` | Design-mockup |

**Ingen databaser, backup-arkiv, dumper, eller uventede binærfiler.**
**Ingen personlige fotos** i design-mappa.

### 5.5 Commit-meldinger med personlig kontekst

39 av 273 commits (14%) inneholder `christer|frestad|kommi|hverdag|192.168|nas.local` i subject-linjen. Eksempler:
- `bc5df48 docs(domain): correct domain to hverdagsplanleggeren.com`
- Mange `Merge pull request ... from ChristerFrestad/...`

### 5.6 Suspicious commit messages — alle clean

19 commits matched `secret|token|password|credential|api-key|leak|oops|forgot|remove|sensitive`. Manuell review: alle er legitime endringer (auth-features, debug-endpoint-fjerning, dependency-bumps). **Ingen "oops"-pattern**, ingen "remove leaked X"-commit.

### 5.7 `.gitignore`-historikk

Kun 3 commits har endret `.gitignore`:
1. `39b0645 v1.3.0` — initial (allerede comprehensive)
2. `32ade70 feat(client): Fase 1a — Vite+React+TS+Tailwind toolchain`
3. `96ed1af feat(client): introduce app/dev boundary with enforce-isolation plugin`

### 5.8 Remotes / config / hooks

- **Remote:** `origin → https://github.com/ChristerFrestad/FamilyAssistant.git` (kun en)
- **`.git/config`:** `worktreeConfig = true` (worktrees aktivert; én eksisterer i `.claude/worktrees/`)
- **Hooks:** kun `.husky/pre-commit` (1 linje: `npx lint-staged`). Husky v9 shim har deprecation-warning — minor tech-debt
- **Ingen `original-*`, `backup-*`, `refs/replace/`, eller `refs/notes/` refs** — clean shape, ingen tegn på tidligere rewrite

---

## 6. Norsk språk — komplett inventory (104 .md + source)

### 6.1 By design — behold som norsk

**i18n-bundles (norsk pilot-default):**
- `client/src/app/i18n/locales/no/*.json` (12 filer): `auth.json` (33 NO-treff), `family.json` (33), `meals.json` (33), `shopping.json` (35), `settings.json` (19), `pantry.json` (19), `common.json` (12), `dashboard.json` (12), `admin.json` (2), `calendar.json` (3)

**Email-templates (NO-versjon):**
- `server/email/templates/magic-link-no.{html,txt}`
- `server/email/templates/invitation-no.{html,txt}`

**Norsk data (intentional):**
- `server/data/ingredient-dictionary-en-no.json` — bilingual, NO-kolonne er kjernedata
- `server/services/diet-filter.service.js` — diet-keyword data (NO)
- `server/services/allergy-filter.service.js` — allergen-keyword data (NO)
- `server/services/slugify.js` — NO character map
- `server/services/ingredient-normalizer.service.js` — NO-data
- `server/llm.js` — Norske prompts til LLM

**Brukervendte sider (har EN-versjon):**
- `public/privacy.html` (NO, 213 linjer) + `public/privacy-en.html` (EN, 217 linjer)
- `public/terms.html` (NO, 130 linjer) — har **ikke** EN-versjon, må oversettes

### 6.2 Public-facing docs — krever oversettelse

| Fil | Linjer | Språk |
|---|---|---|
| `SECURITY.md` | 274 | NO |
| `CONTRIBUTING.md` | 317 | NO (har eksplisitt disclaimer "norsk siden appen er norsk-fokusert" — må bort) |
| `DEPLOY.md` | 556 | MIX (§16 er EN, resten NO) |
| `RUNBOOK.md` | 1138 | NO (omfattende, mange "Christers"-referanser i §13) |
| `CI.md` | 172 | NO |
| `CHANGELOG.md` | 1590 | NO (eksisterende entries kan stå, fremtidige skrives engelsk) |
| `docs/DOMAIN_MODEL.md` | 353 | NO |
| `docs/BRAND_SYSTEM.md` | 164 | NO |
| `docs/frontend/v2-strategy.md` | 175 | NO |
| `docs/operations/PORTAINER_BRANDING_SETUP.md` | 181 | EN (allerede) |
| `docs/architecture/frontend.md` | 104 | EN (allerede) |
| `docs/runbooks/deploy-portainer.md` | 378 | NO |
| `docs/runbooks/smart-coupling-flow.md` | 152 | NO |
| `docs/runbooks/b1-deploy-checklist.md` | 301 | NO |
| `docs/runbooks/ci-cd-pipeline.md` | 112 | EN |
| `docs/runbooks/wcag-compliance.md` | 148 | EN |
| `docs/runbooks/llm-cache-key-policy.md` | 76 | EN |
| `docs/known-issues/portainer-session-secret-deploy-gate.md` | 197 | NO |
| `docs/vision/integration-platform-future.md` | 243 | NO |
| `public/terms.html` | 130 | NO (mangler EN-versjon) |
| `.env.example` | 266 | NO (kommentarer) |
| `README.md` | 174 | EN (allerede god, kun linje 110-112 har norsk parentes) |
| `docs/DB_INDEXES.md` | 160 | NO |

**Estimat:** ~14-18 filer + `.env.example` + ~3000-4500 linjer prosa å oversette.

### 6.3 Internal docs — behold på norsk eller flytt til `internal/`

| Sti | Antall | Karakter | Anbefaling |
|---|---|---|---|
| `AGENT_LOG.md` | 1 (1123 linjer) | Append-only arbeidslogg | **Behold** norsk — historie |
| `CONTEXT.md` | 1 (180 linjer) | Personlig oppgave-tracker | **Gitignore** + flytt til personlig fil |
| `CLAUDE.md` | 1 (1291 linjer) | Personlig agent-instruks | **Splitt**: public `AGENTS.md` (EN) + private `CHRISTER.md` (NO, gitignored) |
| `docs/analyses/` | 40 filer | Historiske beslutnings-analyser | 27 behold-norsk + 8 flytt til `internal/` + 6 OK som-er |
| `docs/workflow/` | 22 filer | Sprint/batch/PR-utkast | 22 keep (norsk historie) |
| `docs/baselines/` | 1+ filer | Ukentlig perf-snapshots | Behold norsk |

### 6.4 Source-kode — Norske kommentarer (DEL 7.7-debt)

Per CLAUDE.md DEL 7.7 skal ny kode skrives med engelske kommentarer.
Eksisterende debt ble lovet adressert i "pre-deploy cleanup-sesjon"
(uke 9-10).

**Fil-tellinger** (Norsk-content i kommentarer/strings):
- `server/` — **62 filer** med norske kommentarer (inkl. migrations 001-024 SQL-headers)
- `client/src/` — **93 filer** (inkl. test-fixtures med norske beskrivelser)
- `tests/` — **59 filer** med norske test-beskrivelser/assertions
- `scripts/` — **6 filer**

Eksempler på "tunge" filer:
- `server/seed.js` (270 NO-treff — mest produkt-navn, BR-keep)
- `server/routes.js` (46 — kommentarer + error-strings)
- `server/migrations/007_shopping_lists.sql` (34 — extensiv NO design-doc-kommentarer)
- `tests/iteration3b-enricher.test.js` (47)
- `tests/iteration3a.test.js` (41)
- `tests/m-week9-safety.test.js` (42)

Per DEL 7.7 skal disse adresseres i én samlet cleanup-sesjon, ikke
drive-by. Drive-by gjør Christer urolig fordi det skjuler size av
opprydningen.

### 6.5 Konfig-filer med norske strings

- `eslint.config.mjs:160` — `'app/ kan ikke importere fra dev/. Se client/src/dev/README.md for begrunnelse.'`
- `Caddyfile` — alle kommentarer er norske
- `familieassistenten.service` — Description på norsk
- `install.sh`, `setup-rpi5.sh`, `start.sh`, `upgrade.sh` — alle norsk
- `.dockerignore` — norske kommentarer
- `.github/workflows/{ci,backup-restore,release,performance,docker}.yml` — norske kommentarer

---

## 7. White-label brand-inkonsistens

**Egen public-readiness-gap, ikke privacy.** Repo bruker fortsatt
to navn om hverandre:

| Bruker `familieassistenten` | Bruker `FamilyAssistant` / `familyassistant` |
|---|---|
| `package.json` `"name"`-felt | `Dockerfile` OCI `org.opencontainers.image.title` |
| `terms.html` `<title>` ("Bruksvilkår — Familieassistenten") | GHCR image-navn: `ghcr.io/christerfrestad/familyassistant` |
| `familieassistenten.service` (filnavn + Description) | `README.md` (overskrift og description) |
| `install.sh` UI-strings ("Familieassistenten") | `package.json` `"description"` har begge mikset |
| Tarball-prefiks i `release.yml`: `familieassistenten-${VERSION}` | LICENSE: "FamilyAssistant" |
| OCI label i `docker.yml`: `org.opencontainers.image.title=Familieassistenten` | `client/src/app/i18n/locales/{no,en}/common.json` (`appName: "FamilyAssistant"`) |
| Database-filnavn: `familieassistenten.db` | |
| Mange Norske docs ("Familieassistenten gjør X") | |

Per CLAUDE.md DEL 7.12 er default `FamilyAssistant`. Pre-public må
du beslutte:

**ANBEFALING:** Konsolider til **`FamilyAssistant`** som default
brand-navn (matcher `package.json` `name`-felt etter rename,
Dockerfile, GHCR, i18n-bundles, og DEL 7.12-policy). Christers
pilot-deploy bruker `Hverdagsplanleggeren` via env-override (allerede
fungerer).

Filer som må endres:
- `package.json` `"name"`: `familieassistenten` → `familyassistant`
- `terms.html` `<title>`: `Bruksvilkår — Familieassistenten` → `Terms of Service — FamilyAssistant`
- Rename `familieassistenten.service` → `familyassistant.service` (eller la stå hvis breaking change for installerte instanser — vurder)
- `install.sh` UI-strings
- Tarball-prefiks i `release.yml`
- OCI label i `docker.yml`
- Database-filnavn: vurder rename + migrasjon, eller la stå (breaking)
- Norske docs trenger oppdatering hvis vi oversetter dem

---

## 8. CI / Docker / Service / Config — funn

### 8.1 `release.yml:89` SLSA-flagget

`private-repository: true` med kommentar "Prosjekt-eieren har godkjent denne privacy-kompromissen". **Må flippes til `false` (eller fjernes) når repo blir public.**

### 8.2 Hardkodet image-tag i docker-compose

`docker-compose.yml:27`: `image: ghcr.io/christerfrestad/familyassistant:${TAG:-main}` — andre deployers må overstyre via stack-env. Dokumentert, men baked in.

### 8.3 Dockerfile OCI-label

`Dockerfile:129`: `LABEL org.opencontainers.image.authors="Christer Frestad"` — arves av alle som bygger fra Dockerfile. **Vurdering:** kan beholdes som original-author, eller endres til `"FamilyAssistant maintainers"`.

### 8.4 `familieassistenten.service` hardkodede stier

Linjer 18-19, 47: `User=pi`, `WorkingDirectory=/home/pi/Familieassistenten`. `install.sh` patcher disse runtime, men committed template reflekterer ett spesifikt oppsett. **Vurdering:** la stå (template) eller bytt til `User=CHANGEME` med tydelig kommentar.

### 8.5 `scripts/local-ci.{sh,ps1}` siterer norsk push-trigger

Linjer 84 (sh) og 90 (ps1) inneholder `'nå pusher vi batch N'` og `'nå kan vi pushe'` — Christer-spesifikk arbeidsflyts-frase som lekker inn i shipped scripts. Refererer også `CLAUDE.md DEL 5.2`. Bytt til generisk engelsk.

### 8.6 Konfig refererer interne docs

- `client/vite.config.ts:16` — refererer `CLAUDE.md DEL 7.8`
- `eslint.config.mjs:160` — refererer `client/src/dev/README.md` (norsk)

Behold, men oversett message-strenger til engelsk hvis intern-docs forsvinner.

### 8.7 Workflows med blandet norsk/engelsk

- `.github/workflows/{ci,backup-restore,release,performance,docker}.yml` — flere har norske kommentarer/error-strings (`"FEIL: forventet ..."`, `"Server er oppe etter $i sek"`, etc.)

### 8.8 GitHub-username i CODEOWNERS

`.github/CODEOWNERS` — alle linjer `@ChristerFrestad`. Intentional public identifier. **OK.**

### 8.9 Dependabot reviewer-felt

`.github/dependabot.yml` — lister `ChristerFrestad` som reviewer + timezone Europe/Oslo + norsk kommentar. **OK.**

---

## 9. Manglende public-repo-artefakter

| Fil | Status | Anbefaling |
|---|---|---|
| `LICENSE` | Eksisterer (MIT, 2026, Christer Frestad) | OK |
| `README.md` | Eksisterer, engelsk | OK |
| `SECURITY.md` | Eksisterer, norsk | Oversett |
| `CONTRIBUTING.md` | Eksisterer, norsk | Oversett + fjern norsk-disclaimer |
| `CODE_OF_CONDUCT.md` | **Mangler** | Legg til (Contributor Covenant 2.1) |
| `.github/ISSUE_TEMPLATE/` | **Mangler** | Vurder bug/feature-templates |
| `.github/PULL_REQUEST_TEMPLATE.md` | **Mangler** | Anbefales — kort sjekkliste |
| `.github/FUNDING.yml` | **Mangler** | Kun hvis du vil ta imot sponsing |
| `public/terms-en.html` | **Mangler** | Trengs hvis EN-versjon ønskes (paralleldesign med privacy-en.html) |
| `public/manifest.json` | **Slettet** (PR #118) | Kommer i Sprint 6 v2 PWA |
| Root `CODEOWNERS` | **Mangler** (kun `.github/CODEOWNERS`) | OK — GitHub leser begge |
| Root `.editorconfig` | **Mangler** | Vurder å legge til |
| `client/postcss.config.js` | **Mangler** | Tailwind-config er i vite-plugin, OK |

---

## 10. `.gitignore`-revisjon

Eksisterende `.gitignore` er god (skannet historikk: ingen sensitive
filer noensinne lekket). Trenger tilleggene:

```gitignore
# Engangs-diagnostikk-skript som har inneholdt personlig data
db-check.js
db-pantry-check.js
db-*.js
inspect-*.js

# Personlige agent-instruksjoner (hvis du splitter CLAUDE.md)
CHRISTER.md

# SQLite checkpoint-filer (mindre gap i nåværende setup)
*.sqlite-shm
*.sqlite-wal

# Lokal CONTEXT (hvis du flytter den ut av tracked)
CONTEXT.md
```

`db-*.js` som bredt mønster fanger fremtidige ad-hoc-skript med samme
navn-rot uten ekstra vedlikehold. `inspect-*.js` matcher
`scripts/inspect-family-1-state.js` mønsteret hvis du lager nye
slike.

---

## 11. Portainer-oppstartsrisiko-sjekk (per CLAUDE.md DEL 3 §2.6)

| Berører | Ja/Nei |
|---|---|
| `Dockerfile` eller `.dockerignore` | Bare OCI-label endring foreslått (kosmetisk) |
| `docker-compose.yml` | Nei (default image-tag forblir) |
| `server/http/bootstrap.js` | Nei |
| `server/config.js` oppstartsvalidering | Nei |
| `server/index.js` startup-sekvens | Nei |
| `server/db.js` eller `server/migrations/**` | Nei |
| `install.sh` | Bare UI-string-endring (kosmetisk) |
| `bootstrap.json`-lesning eller -skriving | Nei |
| Miljøvariabel-krav for oppstart | Nei |

**Portainer-risiko: NEI**, med unntak av eventuell `familieassistenten.service` → `familyassistant.service` rename (breaking for installerte systemd-instanser). Hvis du beslutter rename: legg til migrasjons-steg i `install.sh` som rydder gammel service før den nye installeres.

---

## 12. ISO 25010-påvirkning

| Karakteristikk | Før | Etter | Δ | Begrunnelse |
|---|---|---|---|---|
| Funksjonell egnethet | 8.95 | 8.95 | 0 | Ingen kode-endring |
| Pålitelighet | 8.45 | 8.45 | 0 | Ingen kode-endring |
| Brukervennlighet | 8.7 | 8.75 | +0.05 | USER-FACING lockout-tekst får riktig appName i stedet for Christer |
| Effektivitet | uendret | uendret | 0 | Ikke berørt |
| Vedlikeholdbarhet | 8.35 | 8.45 | +0.10 | Splitt CLAUDE.md + brand-konsistens + PII-scrub |
| Portabilitet | 8.5 | 8.55 | +0.05 | White-label-konsistens gjør forks lettere |
| **Sikkerhet** | 8.2 | **8.40** | **+0.20** | Andromeda-rotering + PII-scrub + author-skift + USER-FACING-name fjernet |
| Kompatibilitet | uendret | uendret | 0 | — |

Snitt: marginal positiv effekt. Ingen ≥8.0 trekkes under 8.0.

---

## 13. Beslutninger Christer må ta (med anbefaling)

### BESLUTNING 1: PILOT_PASSWORD = 'Andromeda'
- **ANBEFALING:** Bekreft nå. Hvis ekte: roter pilot-passordet umiddelbart + bytt test-fixture til generisk streng.
- **ALTERNATIVER:** N/A — kan ikke utsettes hvis ekte.
- **KONSEKVENS HVIS ANNERLEDES:** Hvis du ignorerer: passordet er allerede i git-historikken og kompromittert hvis ekte.

### BESLUTNING 2: Translation scope
- **ANBEFALING:** Oversett kun §6.2 (public-facing docs). La `docs/analyses/`, `docs/workflow/`, `AGENT_LOG.md`, `docs/baselines/` stå norsk (append-only historie). Source-code-kommentarer adresseres i pre-deploy cleanup-sesjon per DEL 7.7.
- **ALTERNATIVER:**
  - Full oversettelse av alle 104 .md + 220 source-filer: ~4-6 ukers arbeid
  - Kun README + LICENSE: oppleves halvferdig for contributors
- **KONSEKVENS HVIS ANNERLEDES:** Mer arbeid, eller ujevn presentasjon.

### BESLUTNING 3: UI-språk default
- **ANBEFALING:** Behold norsk bokmål default. i18n-system fra Sprint 10 har allerede både `no`/`en`-bundles.
- **KONSEKVENS HVIS ANNERLEDES:** Pilot-brukere får engelsk UI, må overstyres med `localStorage['fa:language']='no'`.

### BESLUTNING 4: CLAUDE.md split
- **ANBEFALING:** Splitt til `AGENTS.md` (engelsk, public) + `CHRISTER.md` (norsk, gitignored). DEL 7.8 (port-mapping), DEL 7.9 (config-protection), rpi-memory-referanser, push-trigger-frase går til CHRISTER.md.
- **KONSEKVENS HVIS ANNERLEDES:** Andre brukere får et norsk personlig dokument der det er uklart hva som er prinsipp vs. personlig oppsett.

### BESLUTNING 5: Git-historikk
- **ANBEFALING:** Aksepter eksisterende historikk. Skift git author for fremtidige commits til `82406432+ChristerFrestad@users.noreply.github.com`.
- **ALTERNATIVER:**
  - Force-push rewrite: bryter DEL 1 #7, høyrisiko (273 commit-hash invalideres, alle PR-referanser brytes, Portainer pull-er muligens et bortrevet commit)
  - Lag nytt repo: tap av 273 commits + 89 PR-historikk
- **KONSEKVENS HVIS ANNERLEDES:** Personlig Gmail forblir synlig i `git log` på public repo.

### BESLUTNING 6: `christer@frestad.com` i tracked filer
- **ANBEFALING:** Bytt ut til `admin@example.com` i 11 ikke-historiske filer (`docs/runbooks/deploy-portainer.md` + test-fixtures + WelcomeHeader-kommentar). La `AGENT_LOG.md` og `docs/analyses/2026-04*/2026-05-0[1-5]*` stå.
- **KONSEKVENS HVIS ANNERLEDES:** Personlig e-post synlig i tester og runbook.

### BESLUTNING 7: `192.168.50.123` i tracked filer
- **ANBEFALING:** Maskér til `<lan-ip>` i prose-filer (CHANGELOG, runbook, analyser). Bytt til `192.0.2.1` (RFC 5737) i 2 test-filer.
- **KONSEKVENS HVIS ANNERLEDES:** Ditt subnett synlig i public docs.

### BESLUTNING 8: USER-FACING tekst med ditt navn
- **ANBEFALING:** Parameteriser `auth.json` lockout-melding + onboarding-placeholders. Bytt `privacy.html` + `privacy-en.html` til generisk "the operator" eller bruk `{{operatorName}}` template-variabel.
- **KONSEKVENS HVIS ANNERLEDES:** Andre familier som forker prosjektet vil se "Christer trenger at du venter" som lockout-melding for sine egne brukere.

### BESLUTNING 9: Brand-navn-konsolidering
- **ANBEFALING:** Konsolider til `FamilyAssistant` overalt unntatt:
  - User-facing pilot-strings hos deg (overstyrt via `APP_NAME` env)
  - Database-filnavn (`familieassistenten.db` — breaking change å rename)
  - `familieassistenten.service` (vurder rename + install.sh-cleanup, eller la stå)
- **ALTERNATIVER:** Konsolider til `Familieassistenten`: bryter DEL 7.12 og GHCR image-navn.
- **KONSEKVENS HVIS ANNERLEDES:** Forks får forvirrende dobbelt-branding.

### BESLUTNING 10: `release.yml` SLSA-flagg
- **ANBEFALING:** Flip `private-repository: true` → `false` (eller fjern flagget) når repo blir public. SLSA Level 3 keyless signing fungerer ikke korrekt med feil flag.
- **KONSEKVENS HVIS ANNERLEDES:** Release-artifacts blir ikke korrekt signert post-public.

### BESLUTNING 11: HTTP User-Agent
- **ANBEFALING:** La stå som-er. GitHub-username er public uansett. Hvis du vil ha helhetlig white-label: parameteriser med `APP_NAME` og en konfigurerbar repo-URL.
- **KONSEKVENS HVIS ANNERLEDES:** Andre deployers sender din User-Agent til oppskrift-nettsteder.

### BESLUTNING 12: Familie-medlems-navn "Lise" og "Kari"
- **ANBEFALING:** Bekreft om dette er ekte familiemedlemmer eller illustrative norsk-navn. Hvis ekte: bytt til generiske eksempel-navn.
- **KONSEKVENS HVIS ANNERLEDES:** Familiemedlems-navn synlig i public doc.

---

## 14. Anbefalt commit-plan — 7 PR-er

Hver PR er selvstendig mergebar.

### PR 1 — AKUTT: `chore/public-repo-prep-1-andromeda-and-untracked`
**Mål:** Stopp akutt lekkasje.

- Bekreft `Andromeda` med Christer
- Hvis ekte: roter pilot-passord på `app.hverdagsplanleggeren.com`
- Bytt `'Andromeda'` → `'TEST_PILOT_PASSWORD'` i 2 test-filer (8 forekomster)
- Slett `db-check.js` og `db-pantry-check.js` fra arbeidstreet
- Legg til i `.gitignore`: `db-*.js`, `inspect-*.js`, `CHRISTER.md`, `*.sqlite-shm`, `*.sqlite-wal`
- Skift git author lokalt: `git config user.email 82406432+ChristerFrestad@users.noreply.github.com`
- Dokumenter author-skift i AGENT_LOG.md

Estimat: 1 sesjon. Tester må fortsatt passere.

### PR 2 — `chore/public-repo-prep-2-pii-scrub-tracked`
**Mål:** Maskér PII i tracked, ikke-historiske filer.

PII-fixes:
- `192.168.50.123` → `<lan-ip>` i `CHANGELOG.md:188`, `docs/runbooks/deploy-portainer.md:193`
- `192.168.50.123` → `192.0.2.1` i `tests/cookie-secure-flag.test.js:7`, `tests/llm-ollama-url.test.js:9-10`
- `192.168.50.50` → `192.168.1.50` i `Caddyfile:38` + bedre kommentar
- `christer@frestad.com` → `admin@example.com` i `docs/runbooks/deploy-portainer.md:50`
- `christer@frestad.com`, `kid@frestad.com`, `pilot@frestad.com` → `alice@example.com`, `bob@example.com`, etc. i 8 test-filer
- `WelcomeHeader.tsx:11` (kommentar)
- `/home/christer/...` → `/srv/familyassistant-data/` i `docs/runbooks/deploy-portainer.md` (8 linjer)

Flytt 8 analyser til `docs/analyses/internal/` (gitignored):
- `2026-04-29-atomic-onboarding.md`
- `2026-05-01-fase-2f-settings.md`
- `2026-05-03-pre-pilot-comprehensive-audit.md`
- `2026-05-04-admin-role-bootstrap.md`
- `2026-05-04-cleanup-orphan-family-1.md`
- `2026-05-04-cookie-secure-flag-fix.md`
- `2026-05-04-v2-bundle-not-in-image.md`
- `2026-05-prod-enricher-disconnect.md`

Estimat: 1 sesjon.

### PR 3 — `feat/public-repo-prep-3-user-facing-strings`
**Mål:** Fjern ditt navn fra USER-FACING tekst.

- `client/src/app/i18n/locales/no/auth.json:28` — parameteriser lockout-melding med `{{operatorName}}` eller `{{appName}}`
- `client/src/app/i18n/locales/en/auth.json:28` — samme
- Linjer 74, 86 i begge — bytt `"F.eks. Frestad-familien"` og `"F.eks. Christer"` til generiske eksempler
- `public/privacy.html:128` + `public/privacy-en.html:131` — bytt "Christer's pilot RPi has volume encryption" til "The operator's pilot RPi has volume encryption" eller parameteriser via `{{operatorName}}`
- `public/privacy.html:134` + `public/privacy-en.html:136` — bytt `app.hverdagsplanleggeren.com` til `app.example.com` eller `{{appHost}}` template
- Oppdater test-fixtures som verifiserer disse strings

Estimat: 1 sesjon. Frontend-tester må oppdateres.

### PR 4 — `docs/public-repo-prep-4-translate-public-facing`
**Mål:** Oversett public-facing docs til engelsk.

Oversettelser:
- `.env.example` (266 linjer kommentarer)
- `SECURITY.md` (274 linjer)
- `CONTRIBUTING.md` (317 linjer) — fjern norsk-fokus-disclaimer
- `DEPLOY.md` §1-15 (~400 linjer, §16 allerede engelsk)
- `RUNBOOK.md` (1138 linjer — stort, vurder å gjøre i sub-PR)
- `CI.md` (172 linjer)
- `docs/DOMAIN_MODEL.md` (353 linjer)
- `docs/DB_INDEXES.md` (160 linjer)
- `docs/BRAND_SYSTEM.md` (164 linjer)
- `docs/frontend/v2-strategy.md` (175 linjer)
- `docs/runbooks/deploy-portainer.md` (378 linjer)
- `docs/runbooks/smart-coupling-flow.md` (152 linjer)
- `docs/runbooks/b1-deploy-checklist.md` (301 linjer)
- `docs/known-issues/portainer-session-secret-deploy-gate.md` (197 linjer)
- `docs/vision/integration-platform-future.md` (243 linjer)
- `public/terms.html` — lag `public/terms-en.html` parallell
- `README.md:110-112` — oversett norsk parentes
- `package.json`: `name`, `description`, `keywords` → engelsk

Estimat: 3-4 sesjoner. Hver fil er én commit. Kan splittes i flere PR-er for review-håndterbarhet.

### PR 5 — `chore/public-repo-prep-5-brand-consolidation`
**Mål:** Konsolider brand-navn til `FamilyAssistant`.

- `package.json`: `"name": "familyassistant"`
- `terms.html` (etter oversettelse): `<title>FamilyAssistant — Terms of Service</title>`
- `install.sh` UI-strings: `"Familieassistenten"` → `"FamilyAssistant"`
- `release.yml` tarball-prefiks: `familieassistenten-${VERSION}` → `familyassistant-${VERSION}`
- `docker.yml` OCI label: `org.opencontainers.image.title=FamilyAssistant`
- `.dockerignore` kommentarer
- Workflow norske kommentarer/error-strings — oversett

**IKKE i denne PR-en:**
- `familieassistenten.service` rename (breaking for installerte systemd-instanser — egen PR med install.sh-migrasjon)
- Database-filnavn rename (breaking)

Estimat: 1 sesjon.

### PR 6 — `docs/public-repo-prep-6-split-claude-md`
**Mål:** Splitt CLAUDE.md.

- Opprett `AGENTS.md` (engelsk) med generaliserbart innhold:
  - DEL 0 (filosofi) — oversatt
  - DEL 1 (kjernekontrakt) — oversatt
  - DEL 2 (stopp-triggere)
  - DEL 3 (arbeidsflyt)
  - DEL 4 (sikkerhetssjekkliste)
  - DEL 5 (merge-autonomi, generisk)
  - DEL 6 (multi-tenant frys)
  - DEL 7.1-7.7, 7.10-7.12 (kvalitetskrav)
  - DEL 8 (AGENT_LOG-format)
  - DEL 9 (git/identitet)
  - DEL 10 (kommunikasjon, generisk)
  - DEL 11, 14
- Opprett `CHRISTER.md` (norsk, **gitignored**) med:
  - DEL 7.8 (port-mapping på din maskin)
  - DEL 7.9 (beskyttede filer / shell-config)
  - Personlige preferanser (push-disiplin med trigger-frase)
  - Pekere til rpi-memory MCP
- Oppdater `README.md` til å peke til `AGENTS.md` i stedet for `CLAUDE.md`
- Oversett `scripts/local-ci.{sh,ps1}` push-trigger-melding til generisk
- Oversett `eslint.config.mjs:160` message-string

Estimat: 2 sesjoner.

### PR 7 — `chore/public-repo-prep-7-finalize`
**Mål:** Siste polish + public-repo-artefakter + SLSA-flagg.

- Flip `release.yml:89` `private-repository: true` → `false`
- Legg til `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1)
- Legg til `.github/PULL_REQUEST_TEMPLATE.md`
- Legg til `.github/ISSUE_TEMPLATE/{bug.md,feature.md}`
- Vurder `.editorconfig` på root
- Slett `CONTEXT.md` fra tracked (flytt innhold til personlig fil)
- Husky v9 → v10 (deprecation-warning)
- Rydd opp 28 stale lokale branches
- Slett 3 stale post-merge `docs/post-merge-*` branches
- Final review

Estimat: 1 sesjon.

### Total estimat
7-9 sesjoner fordelt på 7 PR-er. PR 1 alene stopper akutt lekkasje
og kan merges på dagen.

---

## 15. Foreslått neste steg

1. **Bekreft `Andromeda` umiddelbart.** Hvis ekte, roter passord
   uansett om public-repo-løpet starter eller ikke.
2. **Svar på de 12 beslutningene i §13** med ja/nei/endre per linje.
3. **Når besluttet:** velg om vi går rett til PR 1, eller om du vil
   ha en kort sub-analyse for hver PR-fase.
4. Hvis spørsmål oppstår underveis: spør før jobb begynner.

Etter PR 1-7 er repo-et klart til å gjøres public via GitHub-UI.
Det er din handling, ikke en commit.
