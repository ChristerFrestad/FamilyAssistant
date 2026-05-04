# Post-Pilot Code-Debt Cleanup Tracking

**Type:** Living document — append-only inventory until cleanup-sprint
**Eier:** Claude (autonom inventering) + Christer (godkjenner cleanup-sprint)
**Først opprettet:** 2026-05-04
**Sist oppdatert:** 2026-05-04
**Cleanup-sprint målperiode:** uke 9–10 (post-pilot, etter 13–17. mai 2026)

---

## Kontekst

Under utvikling har flere features blitt forberedt men ikke aktivert i
pilot-scope. Dette skaper "dead code" — dependencies, kodelinjer og
konfigurasjoner som ikke brukes, men som fortsatt vedlikeholdes,
sikkerhets-skannes og opptar utviklerens mentale kapasitet.

Eksempler fra pre-pilot-audit (PR #96):

- Personvernerklæringen nevner Backblaze B2 (ingen kode), Sentry
  (deaktivert via env), og Google OAuth (deaktivert via env).
- Optional dependency `@sentry/node` er installert hvis utvikleren
  kjører `npm install`, men runtime aktiveres bare ved `SENTRY_DSN=...`.
- Magic-link via Resend krever `RESEND_API_KEY`; uten den faller flyten
  tilbake til `MAGIC_LINK_CONSOLE`.

Disse representerer ikke aktive feil, men de er teknisk gjeld som må
adresseres systematisk **etter** pilot-launch — ikke under, fordi
endringer i auth-/observability-stien er fryst per CLAUDE.md DEL 6.

---

## Klassifisering

For hver entry brukes følgende felter:

- **Kategori:** A) Dependencies, B) Endpoints uten frontend-kobling,
  C) Frontend-komponenter uten bruk, D) Konfigurasjonsalternativer,
  E) Tester for ikke-aktiverte features, F) Dokumentasjon-referanser
- **Status:** UNUSED (helt død), OPTIONAL (gated av env), GATED (gated
  av feature flag), PROCESS-FROZEN (DEL 6 — krever Christer-godkjenning)
- **Severity:**
  - **CRITICAL:** må fjernes for sikkerhet/compliance
  - **HIGH:** bør fjernes for clarity (forvirrende for nye brukere/devs)
  - **MEDIUM:** kan fjernes ved cleanup
  - **LOW:** low-priority cleanup
- **Cleanup-handling:** REMOVE / ACTIVATE / DEFER / DOCUMENT-ONLY

---

## Inventering — første batch (2026-05-04)

### Entry 1: Backblaze B2 (referanse uten implementasjon)

- **Kategori:** F (dokumentasjons-referanser uten kode)
- **Status:** UNUSED
- **Severity:** **CRITICAL** (GDPR — privacy-erklæring nevner tjeneste vi ikke bruker)

**Hvor:**
- `public/privacy.html:111` — table-row for Backblaze B2 i personvern-tabell
- `docs/analyses/2026-05-03-pre-pilot-comprehensive-audit.md:1000, 1004, 1102` (audit-historikk)
- `docs/workflow/pending-decisions.md:829, 862` (off-site backup discussion — ingen beslutning tatt)

**Hvorfor det ble bygget:**
Aldri bygget. Privacy-html-en ble skrevet med en planlagt off-site backup-løsning (B2/S3/Hetzner) i tankene. Implementasjonen ble aldri startet — ingen npm-pakker, ingen API-klient, ingen config-felter.

**Hvorfor det ikke brukes nå:**
Off-site backup er ikke i pilot-scope (per audit § 2.3 / pending-decisions). Backup går til lokal `data/backups/` via cron, ikke til ekstern tjeneste.

**Cleanup-handling:** REMOVE (fra privacy.html) — håndteres i **PR A4** (Privacy.html corrected for pilot scope).

**Estimert tid:** 5 min (én tabell-rad i privacy.html, begge språk).

**Risiko:** Null. Ingen kode-sti aktiveres av endringen.

---

### Entry 2: Sentry (`@sentry/node`)

- **Kategori:** A (dependency) + D (config-gated)
- **Status:** OPTIONAL + PROCESS-FROZEN (DEL 6)
- **Severity:** **MEDIUM** (zero runtime cost; gating fungerer som forventet)

**Hvor:**
- `package.json` → `optionalDependencies['@sentry/node']: '^8.0.0'`
- `server/observability/sentry.js` (98 % av modul-koden, full PII-scrubbing)
- `server/index.js`, `server/http/server.js` (init + middleware-wiring)
- `server/config.js` → `SENTRY_DSN: z.string().optional()` (linje ca. 50)
- `public/privacy.html:111-ish` (nevnes i privacy-tabell)
- Test-suite: `tests/sentry-integration.test.js`

**Hvorfor det ble bygget:**
Phase 17 — opt-in error-observability for cloud-deploys. Designet med
zero runtime cost når `SENTRY_DSN` er unset (selv `require('@sentry/node')`
unngås). PII-scrubbing fjerner email, request body, cookies før event
sendes til Sentry.

**Hvorfor det ikke brukes nå:**
Pilot kjører på Christers RPi5 uten cloud observability. `SENTRY_DSN` er ikke satt i pilot-Portainer-config. Modulen lastes ikke inn ved oppstart.

**Cleanup-handling:** **DEFER + DOCUMENT-ONLY** for pilot. Post-pilot:
- Hvis cloud-deploy kommer: ACTIVATE (sett SENTRY_DSN i Portainer-stack).
- Hvis kun RPi-deploy fortsetter: vurder REMOVE av:
  - `optionalDependencies['@sentry/node']`
  - `server/observability/sentry.js`
  - tilhørende init/middleware-wiring
  - `tests/sentry-integration.test.js`
  - `SENTRY_DSN` fra `server/config.js`
  - `public/privacy.html`-referanse

**Process-frys:** `server/observability/sentry.js` er listet i CLAUDE.md DEL 6.1 som "fullt frosset". Endring krever eksplisitt Christer-godkjenning. Cleanup-sprint må respektere denne.

**Estimert tid:** 30 min hvis REMOVE (test, dep, config, init, middleware, privacy-html-rad, alle samtidig). 5 min hvis ACTIVATE.

**Risiko:** Lav for REMOVE (zero runtime use; test vil feile ved kompilering hvis tilstand ikke holdes ren). Lav for ACTIVATE (eksisterende design er testet).

---

### Entry 3: Google OAuth

- **Kategori:** A (kode + scopes), B (endpoints), D (config-gated), F (privacy-html)
- **Status:** OPTIONAL (config-gated)
- **Severity:** **HIGH** (privacy-html nevner det; pilot-bruker forventer ikke OAuth-flow)

**Hvor:**
- `server/auth/google.js` — full PKCE OAuth 2.0-implementasjon (~150 linjer)
- `server/auth/sessions.js` — Google-relaterte session-felter
- `server/auth/family-routes.js`, `server/auth/routes.js` — Google-OAuth-endpoints
- `server/repositories/auth.repo.js` — Google-felter i users-repo
- `server/migrations/014_auth_and_multi_family.sql` — kolonner for Google-OAuth (google_sub, google_email, etc.)
- `server/config.js` → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY` (krever GOOGLE_CLIENT_ID i prod)
- `client/src/app/i18n/locales/{no,en}/auth.json` — UI-strenger (men ingen UI-komponenter bruker dem ennå)
- `public/login.html` — legacy SPA login (har Google-button)
- `public/privacy.html` — nevnes i tabell
- `tests/auth-google.test.js` — test-coverage

**Hvorfor det ble bygget:**
Multi-tenant auth-design ga rom for to login-flows: magic-link (default) og Google OAuth (alternative). Google er enklere for noen brukere; magic-link krever bare email-tilgang.

**Hvorfor det ikke brukes nå:**
Pilot er kun magic-link via Resend (`MAGIC_LINK_CONSOLE=true` som fallback). Google OAuth krever ekstra Cloud Console-setup og er ikke i pilot-scope. `GOOGLE_CLIENT_ID` er unset.

**Cleanup-handling:** **DEFER** til etter pilot. Beslutning post-pilot:
- A: ACTIVATE Google OAuth som alternativ login (krever Cloud Console-setup, samtykke-flyt).
- B: REMOVE hele Google-stien fra koden (auth-routes, repo-felter, migration-data, tester, i18n-strenger).
- C: BEHOLDE som-er (config-gated, dokumenter status).

Anbefaling B hvis multi-tenant ikke krever Google. PRIVACY-html må uansett oppdateres for pilot (PR A4) — Google-rad fjernes der.

**Process-frys:** `server/auth/` er per CLAUDE.md DEL 6.1b "soft-thaw" — endring krever Christer-godkjenning per PR. Inkluderer Google-OAuth-koden.

**Estimert tid:** 1–2 timer hvis REMOVE (mer en migrasjon enn enkel sletting fordi DB-kolonner finnes). 30 min hvis ACTIVATE (krever ekstern Cloud Console + Christer-tester). 5 min hvis BEHOLDE (kun privacy-html-rensing).

**Risiko:** Medium for REMOVE (DB-data må migreres bort). Lav for ACTIVATE eller BEHOLDE.

---

### Entry 4: Resend (`RESEND_API_KEY`)

- **Kategori:** D (config-gated, infrastructure-klar)
- **Status:** GATED (klar for pilot-aktivering)
- **Severity:** **HIGH** (kritisk for pilot — magic-link uten Resend faller tilbake til console-log)

**Hvor:**
- `server/services/email.service.js` (Resend-integrasjon for magic-link)
- `server/auth/magic-link.js` (kaller email.service)
- `server/config.js` → `RESEND_API_KEY: z.string().optional()`, `MAGIC_LINK_CONSOLE: default(false)`
- `client/src/app/components/settings/SettingsRow.tsx` (Resend-related copy)
- `client/src/app/i18n/locales/{no,en}/settings.json` (Resend-related strings)
- `tests/email-service-app-name.test.js`

**Hvorfor det ble bygget:**
Magic-link via Resend er pilot-default email-leveranse. Resend gir API-basert sending uten egen SMTP-server.

**Hvorfor det ikke brukes nå:**
Pilot krever konto + API-key fra Christer (forventes satt opp før 13. mai). Til da: `MAGIC_LINK_CONSOLE=true` printer link til container-log.

**Cleanup-handling:** **ACTIVATE** før pilot — Christer setter `RESEND_API_KEY` i Portainer.

**Estimert tid:** 0 min for kode (alt er klart). Christer-arbeid: 30 min for Resend-konto + DNS-verifisering + API-key.

**Risiko:** Lav. Hvis Resend feiler, faller stien tilbake til `MAGIC_LINK_CONSOLE`.

---

### Entry 5: Web Push / VAPID

- **Kategori:** Ingen (verifisert: ingen kode)
- **Status:** UNUSED (planlagt men aldri implementert)
- **Severity:** **LOW** (ingen kode-debt; bare doc-referanse)

**Hvor:**
Ingen treff i kode. `server/cron.js` har "notifications" — men det er DB-rader for in-app-notifications, ikke web push.

**Hvorfor det ble bygget:**
Aldri bygget. Web push krever VAPID-nøkler, service worker-pushManager, og endpoint for å lagre subscriptions. Ingen av disse finnes i koden.

**Hvorfor det ikke brukes nå:**
Ikke implementert. Settings-UI har en placeholder-row "Push-varsler — Krever Resend (Sprint 7)" men funksjonaliteten er ikke kodet.

**Cleanup-handling:** **DOCUMENT-ONLY** for pilot. Settings-row endres til "Kommer post-pilot" i **PR B1** (Settings badge cleanup). Senere beslutning: implementer eller fjern row helt.

**Estimert tid:** 0 min cleanup (kun badge-tekst i PR B1).

**Risiko:** Null.

---

### Entry 6: Backup off-site / cloud sync

- **Kategori:** F (kun pending-decisions-doc-referanse)
- **Status:** UNUSED (ingen kode, ingen beslutning tatt)
- **Severity:** **LOW**

**Hvor:**
- `docs/workflow/pending-decisions.md:829, 862` (skisserer alternativer: B2, S3, Hetzner Storage Box, rsync til ekstern disk).
- Audit § 2.3 nevner at dette er post-pilot-vurdering.

**Hvorfor det ble bygget:**
Ikke bygget — kun dokumentert som "pending decision".

**Hvorfor det ikke brukes nå:**
Pilot bruker lokal RPi-backup via cron. Off-site er post-pilot-konsept.

**Cleanup-handling:** **DEFER** til Christer beslutter strategi. Privacy.html fjerner B2-referansen i PR A4 (B2 er bare ett alternativ av flere).

**Estimert tid:** Ikke estimert (avhenger av valgt løsning).

**Risiko:** Null for nåværende pilot.

---

### Entry 7: TODO/FIXME-kommentarer

- **Kategori:** F
- **Status:** N/A
- **Severity:** N/A

**Hvor:** Ingen TODO/FIXME/XXX/HACK-kommentarer funnet i `server/`, `client/`, eller `scripts/` via grep `^\s*(//|#)\s*(TODO|FIXME|XXX|HACK)`. Kodebasen er ren på dette punktet.

**Cleanup-handling:** Ingen handling nødvendig.

---

## Sammendrag — første batch

| ID | Tema | Severity | Cleanup-handling | Estimat |
|----|------|----------|------------------|---------|
| 1 | Backblaze B2 (privacy-html) | CRITICAL | REMOVE i PR A4 | 5 min |
| 2 | Sentry (`@sentry/node`) | MEDIUM | DEFER (post-pilot beslutning) | 5–30 min |
| 3 | Google OAuth | HIGH | DEFER (post-pilot beslutning) | 5 min – 2 timer |
| 4 | Resend (config-gated) | HIGH | ACTIVATE før pilot (Christer-task) | 0 min kode |
| 5 | Web Push / VAPID | LOW | DOCUMENT-ONLY (badge-fix i PR B1) | 0 min |
| 6 | Off-site backup | LOW | DEFER (pending-decision) | TBD |
| 7 | TODO/FIXME-kommentarer | N/A | Ingen funnet | 0 min |

**Pre-pilot cleanup nødvendig:** Entry 1 (PR A4), Entry 5 (PR B1).
**Pilot-aktivering:** Entry 4 (Christer-task: Resend-konto + API-key).
**Post-pilot beslutninger:** Entry 2, 3, 6.

**Total estimat for full cleanup-sprint:** 2–4 timer aktivt arbeid + Christer-beslutninger på Entry 2, 3, 6.

---

## Cleanup-strategi (anbefalt)

### Fase 1 — Pre-pilot kosmetisk (denne uken, før 13. mai)

- [x] **Entry 1 (B2)** ryddes i PR A4 (privacy-html-korreksjon).
- [x] **Entry 5 (Web push)** badge-fixes i PR B1 (Settings-rader → "Kommer post-pilot").
- [ ] **Entry 4 (Resend)** aktiveres av Christer (utenfor agent-scope).

### Fase 2 — Pilot kjører (13.–17. mai)

Ingen cleanup. Frys på alt under DEL 6 + ny pilot-feedback har høyere prioritet.

### Fase 3 — Post-pilot cleanup-sprint (uke 9–10 anbefalt)

Anbefalt rekkefølge:

1. **Entry 6** — bestem off-site backup-strategi (Christer-beslutning),
   så implementer eller dokumenter "ikke planlagt" eksplisitt.
2. **Entry 3 (Google OAuth)** — beslutning REMOVE/ACTIVATE/BEHOLDE.
   Hvis REMOVE: full migrasjons-PR med DB-kolonne-cleanup.
3. **Entry 2 (Sentry)** — beslutning REMOVE/ACTIVATE.
   Krever DEL 6-prosess (eksplisitt Christer-godkjenning).
4. **Sweep:** kjør samme inventory-prosessen på nytt; legg til entries
   som ble oppdaget under pilot.

### Test-coverage-strategi

For hver REMOVE-handling:
- Slett tilhørende test-fil(er) først (de skal feile før REMOVE av kode).
- Verifiser `npm test` faller med eksakt det forventede antall failures.
- Slett kode i samme PR; tests passerer igjen.
- Coverage-gate skal fortsatt være over baseline.

### Verifikasjons-flyt for cleanup-PR

For hver REMOVE-PR:

1. ANALYSE-fasen viser eksakt fil-liste som skal slettes.
2. Pre-PR: kjør `npm run lint && npm run typecheck && npm test` — alt grønt.
3. Slett filer + referanser i atomiske commits.
4. Post-PR: `npm run lint && npm run typecheck && npm test && npm run audit:prod` — alt grønt.
5. Verifiser bundle-størrelse (`npm run build:client`) — bør synke for client-side cleanup.

---

## Tilleggs-inventering (oppdatering når ny dead code oppdages)

Append nye entries her med samme format som over.

### Entry 8: Container-log-duplisering (rapportert 2026-05-04)

- **Kategori:** F (kosmetisk operasjons-issue)
- **Status:** Funnet under første pilot-deploy
- **Severity:** **LOW** (logs er fortsatt lesbare; ingen funksjonell impact)

**Hvor:** Christer rapporterte massive doble timestamps i container-logs på første RPi-deploy (under pilot-gate-bug diagnostikk). Ikke kjørt detaljert diagnose ennå.

**Sannsynlige årsaker:**
1. Pino + console.log blandes (server bruker pino, men noen scripts/cron-helpers kan bruke console direkte)
2. Docker logging-driver konflikt (json-file × stdout dobbel)
3. Caddy reverse-proxy logger separat
4. Healthcheck-loops trigger mange identiske log-linjer
5. better-sqlite3-driver-logs prefikser med egen `[DB ...]` timestamp som dupliserer pino's `time`-felt

**Hvorfor det ikke ble bygget:**
Pino-konfig har ikke vært gjennomgått for produksjon-deployment. Lokal dev-modus med `LOG_PRETTY=true` har vært den primære test-banen.

**Hvorfor det ikke håndteres nå:**
- Logs er lesbare (ikke error-tilstand)
- Ingen sikkerhets- eller funksjonell impact
- Pilot-launch er prioritet — kosmetiske log-issues kan vente
- Christer's eksplisitte beslutning (2026-05-04 etter pilot-gate-fix): ikke håndter under denne PR-en

**Cleanup-handling:** **DEFER** til post-pilot. Når addresseres:
1. Diagnostiser presis kilde (samle 100 linjer logs fra running container, identifiser duplisering-pattern)
2. Hvis pino-issue: rydd `LOG_PRETTY` og/eller pino transport-config
3. Hvis better-sqlite3 prefiks: konverter til pino-strukturerte logs
4. Hvis Docker-driver: dokumenter forventet oppførsel og evt. bytt til `local`-driver

**Estimat:** 30 min – 2 timer avhengig av kilde.

**Risiko:** Null for pilot. Lav for cleanup-sprint (logging-config er trygg å endre uten produksjons-impact).

---

### Entry 9: Pilot-gate auth-token interaksjon (oppløst 2026-05-04, kun-doc-entry)

- **Kategori:** Bug-historie (allerede fikset i fix/pilot-gate-lockout)
- **Status:** RESOLVED i CHANGELOG entry "Pilot-gate lockout regression"
- **Severity:** N/A (fikset)

**Hvorfor logget her:** Bug-en demonstrerte en test-coverage-mangel — produksjons-konfig (`AUTH_TOKEN` satt) ble aldri testet i CI. Helpers.js falls tilbake til `LOCAL_USER` når `AUTH_TOKEN` er unset. Test-kjøringen i CI bruker ikke `AUTH_TOKEN`, så middleware-flowen som triggret bug-en var aldri eksekvert i tester.

**Cleanup-handling for post-pilot:**
1. Audit hvilke andre auth-paths som kun testes uten `AUTH_TOKEN`
2. Vurdere å introdusere et "production-env" test-suite-flag som setter `AUTH_TOKEN` for at tester skal kjøres mot den faktiske prod-stien
3. Dokumentere i CLAUDE.md at integration-tester bør dekke begge `AUTH_TOKEN` set/unset varianter

**Estimat:** 1–2 timer for prod-env-test-suite + audit av andre auth-paths.

**Risiko:** Lav. Forbedring av test-coverage, ingen prod-endring.
