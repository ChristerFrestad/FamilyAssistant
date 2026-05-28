# Pre-Pilot Comprehensive Audit — 2026-05-03

> **Type:** Audit-rapport (ingen kode-endringer i denne PR utover
> CLAUDE.md DEL 14-tillegg)
> **Branch:** `chore/pre-pilot-comprehensive-audit`
> **Pilot-mål:** 13.–17. mai 2026
> **Audit-tidspunkt:** 2026-05-03, 11 dager før pilot-launch
> **Audit-bruker:** Claude (autonomous agent), godkjent av Christer
> **Versjon:** 1.3.0

---

## Executive Summary

### Pilot-readiness: **NESTEN KLAR (HIGH-confidence GO)**

Repoet er i veldig god teknisk forfatning. 1340 av 1342 backend-tester
passerer (2 skipped), 859 av 859 client-tester passerer, 0 npm-
sårbarheter, typecheck er rent på server og client. Auth-flyten,
multi-tenant-isolasjonen, sikkerhets-headers og rate-limiting er
solid implementert.

**3 CRITICAL issues** stopper ikke pilot men bør verifiseres før
deploy. **8 HIGH issues** kan vente til etter pilot hvis Christer
godtar det. **Resten er MEDIUM/LOW** — kosmetikk og post-pilot
forbedringer.

### Issue-fordeling

| Severity | Antall | Estimert fix-tid |
|---|---|---|
| **CRITICAL** | 3 | 2–4 timer |
| **HIGH** | 8 | 6–10 timer |
| **MEDIUM** | 17 | 1–3 dager (kan utsettes) |
| **LOW** | 12 | post-pilot |
| **TOTAL** | 40 | – |

### Top 10 anbefalinger

1. **C1 — Pre-deploy DB-cleanup på Christer's RPi.** Slett family 1
   ("Default Family") sin orphan seed-data (36 recipes + 7 meal_plans)
   før pilot. Christer's faktiske familie er family 3 (Frestad).
   Family 1 er rester fra pre-PR #91-tilstanden.
2. **C2 — Bekreft email-leveranse fra Resend i produksjon.**
   `MAGIC_LINK_CONSOLE=true` er pilotfallback, men i pilot må enten
   Resend være konfigurert ELLER Christer/operatør må vite at
   magic-link printes til container-log.
3. **C3 — Lukk lint-bruddet på `public/v2/`-bygg-bundle.** ESLint
   skanner generert minified bundle (bygges av `npm run build:client`)
   og produserer 342 falske positive. Fix: legg `public/v2/**` i
   `eslint.config.mjs` ignores. Trivielt 5-min-fix.
4. **H1 — Skriv "Lukk session" / logout-CTA inn i UI.** Backend
   `POST /api/auth/logout` finnes og virker, men v2-frontend har
   ikke synlig logout-knapp i Settings.
5. **H2 — Family member invitation-UI er placeholder.** Backend-
   endepunktene for invitasjoner finnes (`POST /api/family/
   invitations`), men v2-Family.tsx viser bare placeholder-tekst på
   "Invite member"-knapp. Pilot er solo-Christer-only.
6. **H3 — Calendar-skjerm er placeholder (Sprint 5).** Pilot har
   ingen kalender-funksjonalitet. Bekreft at det er innenfor scope.
7. **H4 — Settings: Timezone, Meal times, Gamification, Push
   notifications er disabled "Coming soon". Bekreft scope.**
8. **H5 — Personvernerklæring og terms.** Pilot under GDPR krever at
   `/privacy.html` og `/terms.html` har faktisk innhold. Verifiser
   disse er ferdige eller anerkjenn at pilot er "kun for Christer's
   familie" og GDPR-eksponering er minimal.
9. **H6 — Cloudflare Tunnel + custom domene er ikke aktivert.**
   `app.hverdagsplanleggeren.com` finnes ikke ennå. Pilot-flyten
   krever beslutning: LAN-only via Tailscale, eller aktivere
   Tunnel før 13. mai?
10. **H7 — Backup-verifisering.** Backup kjører automatisk til
    `data/backups/` (2:30 lokal tid daglig per cron). Ingen
    off-site-sync. Bekreft at restore-prosedyre er testet før
    pilot.

---

## Innholdsfortegnelse

- [Område 1: Auth og brukerflyt](#område-1-auth-og-brukerflyt)
- [Område 2: Christer's data og multi-tenant](#område-2-christers-data-og-multi-tenant-verifisering)
- [Område 3: API-sikkerhet](#område-3-api-sikkerhet)
- [Område 4: Funksjoner uten endpoint / placeholders](#område-4-funksjoner-uten-endpoint--placeholders)
- [Område 5: Pagination og performance](#område-5-pagination-og-performance)
- [Område 6: Error message handling](#område-6-error-message-handling)
- [Område 7: Internationalisering (i18n)](#område-7-internationalisering-i18n)
- [Område 8: Deploy-readiness](#område-8-deploy-readiness)
- [Område 9: Dokumentasjons-tilstand](#område-9-dokumentasjons-tilstand)
- [Område 10: Test-coverage og helse](#område-10-test-coverage-og-helse)
- [Område 11: Aktive prosesser og bakgrunns-jobber](#område-11-aktive-prosesser-og-bakgrunns-jobber)
- [Område 12: Løse kode-tråder](#område-12-løse-kode-tråder)
- [Område 13: Avhengigheter og sikkerhet](#område-13-avhengigheter-og-sikkerhet)
- [Område 14: Pilot-spesifikke krav (GDPR, support, rollback)](#område-14-pilot-spesifikke-krav)
- [Pilot-blockers (CRITICAL)](#pilot-blockers-critical)
- [Anbefalt-før-pilot (HIGH)](#anbefalt-før-pilot-high)
- [Post-pilot scope](#post-pilot-scope)
- [Eksisterende infrastruktur (allerede klart)](#eksisterende-infrastruktur-allerede-klart)
- [Anbefalt neste steg](#anbefalt-neste-steg)

---

## Område 1: Auth og brukerflyt

### 1.1 Magic-link re-registrering — **OK**

**Test-scenario:** Bruker A onboarder med email X → får family_id=10.
Senere mister A session og sender ny magic-link til email X.

**Faktisk oppførsel** (verifisert i `server/auth/magic-link.js:171-174`):

```js
let user = repos.auth.findByEmail(row.email);
if (!user) {
  user = repos.auth.createUser({ email: row.email, name: row.email });
}
```

`findByEmail()` returnerer eksisterende user hvis email matcher.
`createUser()` kalles **kun** hvis ingen user finnes. Det betyr:

- Returnering bruker → eksisterende user-row, eksisterende family,
  ny session, redirect til `/v2/dashboard` (siden
  `onboarding_completed=1`).
- Brand-new bruker → ny user-row, `onboarding_completed=0`, redirect
  til `/v2/onboarding/family` for å fullføre wizard.

**Status:** ✓ KORREKT. Onboarding-redirect-logikken er testet i
`tests/magic-link-onboarding-redirect.test.js`.

### 1.2 Session-håndtering — **OK med kommentar**

- **TTL:** 30 dager (`config.SESSION_TTL_DAYS=30`).
- **Storage:** Server-side i `sessions`-tabellen, bare cookie-id
  sendes til klienten. HttpOnly + SameSite=Lax + Secure (i prod).
- **Multi-device:** Forskjellige sessions per device — verifisert i
  Christer's DB (4 aktive sessions, alle for ham, alle på Edge).
- **Cleanup:** `Session-cleanup`-cron-jobben kjører daglig 04:10 og
  rydder utløpte sessions.
- **Refresh-token:** Ingen separat refresh-token-strategi.
  `touchSession()` oppdaterer bare `last_seen_at`, ikke `expires_at`.
  En session som er aktivt brukt i 30+ dager utløper og må
  re-autentiseres med ny magic-link.

**Anbefaling (post-pilot):** Sliding session-window — forleng
`expires_at` ved hver request hvis brukeren har vært aktiv siste 7
dager. Sparer pilot-bruker en magic-link-runde hver måned.

### 1.3 Logout-flyt — **OK på backend, MANGLENDE i v2-UI**

Backend (`server/auth/routes.js:363-381`):
- `POST /api/auth/logout` — sletter aktiv session, clear-cookie. ✓
- `POST /api/auth/logout-all` — sletter alle sessions for user. ✓
- `DELETE /api/auth/sessions/:id` — sletter spesifikk session. ✓
- `GET /api/auth/sessions` — lister sessions for user. ✓

Frontend (v2):
- **Settings.tsx har INGEN logout-knapp.** Søk i hele
  `client/src/app/screens/` etter "logout" gir 0 treff.
- DataExportButton + DeleteAccountButton er der (GDPR), men ikke
  vanlig "Logg ut" / "Lukk session".

**HIGH-issue H1:** Pilot-bruker som må logge ut må enten slette
cookie manuelt eller la session utløpe. Dette er friksjon. Fix:
legg til en LogoutButton i Settings.tsx user-section. Estimat: 30
min inkl. tester + i18n-keys.

### 1.4 Onboarding edge cases — **OK**

`POST /api/auth/onboarding/complete` (`server/auth/routes.js:234-361`)
er atomic transaction: family + member + user-update + seed +
audit-log alt i én tx. Hvis noe feiler, rulles alt tilbake.

Edge-cases håndtert:
- **Tab-close mellom Step 1 og Step 2:** ingen DB-rad opprettes
  (transaction commits først ved /complete-kall).
- **Bruker er allerede i en familie:** 409 Conflict.
- **Synthetisk pilot-user:** 401 (kan ikke onboarde via wizard).
- **Tom/ugyldig input:** Zod-schema avviser før transaksjon starter.
- **DB-feil under tx:** generic 500 med RFC-7807-format, ingen
  SQL-detail-leak.

**Test-coverage:** `tests/onboarding-flow.test.js`,
`tests/multi-tenant-onboarding.test.js`,
`tests/multi-tenant-isolation.test.js`. Alle passerer.

---

## Område 2: Christer's data og multi-tenant verifisering

### 2.1 Christer's family-state (verifisert mot `data/familieassistenten.db`)

```sql
-- USERS
id=1  email=admin@example.com  family_id=3  onboarding_completed=1  role=owner

-- FAMILIES
id=1  name='Default Family'  owner_user_id=NULL  created_at=2026-04-29 14:18:54
id=3  name='Frestad'         owner_user_id=1     created_at=2026-04-29 19:34:01

-- FAMILY_PROFILE_MEMBERS
id=1  family_id=3  name=Christer  category=adult  portion_factor=1.1
```

**Konklusjon:** Én user-row, riktig family-tilknytning. Onboarding
fullført korrekt. Eneste familie-medlem er Christer selv.

### 2.2 Orphan family 1 — **CRITICAL C1**

```sql
-- RECIPES
family_id=1: 36   ← orphan (Default Family)
family_id=3: 36   ← Christer's

-- MEAL_PLANS
family_id=1: 7    ← orphan
family_id=3: 7    ← Christer's

-- SHOPPING_LISTS
family_id=3: 2    (alt OK)

-- AUDIT_LOG
family_id=3: 16   (alt OK)
```

Family 1 har 36 oppskrifter + 7 ukers meal-plan som ingen kan se i
UI (ingen user er knyttet til family 1). Dette er rester fra
pre-PR #91-tilstanden, før seed-fix-en. PR #91 reparerte family 3,
men slettet ikke family 1's orphan-data.

**Påvirkning på pilot:**
- Ingen funksjonell — Christer ser bare family 3.
- DB-størrelse: ~50–100 KB ekstra (negligible).
- Forvirrende ved senere debugging eller backup-restore.

**Anbefaling C1:** Rydd opp før pilot. Tre alternativer:

| Alt | Risiko | Innsats |
|---|---|---|
| **A: Slett family 1 helt** (`DELETE FROM families WHERE id=1`) — CASCADE rydder rest | Ingen FK fra users; risk-fritt | 5 min |
| **B: Tøm family 1's data men behold rad** | Trygt, dokumenterbart | 15 min |
| **C: La det stå** | DB-clutter; ingen funksjonell konsekvens | 0 min |

**Anbefaling: A.** Lag liten cleanup-script `scripts/repair-
default-family-orphan.js` som logger hva som slettes, og kjør den
mot Christer's RPi etter siste pre-pilot push.

### 2.3 Multi-tenant runtime-verifikasjon — **OK**

**Cross-tenant-test-suite:** `tests/multi-tenant-isolation.test.js`,
`tests/multi-tenant-onboarding.test.js`,
`tests/tenant-isolation.test.js`,
`tests/role-enforcement.test.js`. Alle passerer.

**Per PR #90/#91 audit:** Ingen aktive cross-tenant-lekkasjer.
Runtime-isolasjon via `getFamilyId()` + AsyncLocalStorage er solid.

**Per-bruker stale data:** Christer har 4 sessions (alle Edge på
samme PC). Ikke et problem, men ryddig å droppe gamle:
```sql
DELETE FROM sessions WHERE user_id=1 AND id NOT IN
  (SELECT id FROM sessions WHERE user_id=1
   ORDER BY last_seen_at DESC LIMIT 1);
```
3 av 4 sessions har `last_seen_at` > 24 timer siden — kan trygt
slettes. Cron-jobben rydder uansett ved utløp.

### 2.4 Footgun-fjerning fra PR #90

PR #90 fjernet `LEGACY_FAMILY_ID=1`-fallback fra
`getFamilyId()`. Når en server-flyt kjører uten family-context
(seed, cron-job) får man nå `null` i stedet for falsk default.
Dette er sikkerheten som hindrer cross-tenant-lekkasje.

**Status:** Verifisert i `server/auth/family-context.js`. ✓

---

## Område 3: API-sikkerhet

### 3.1 Auth-middleware — **OK**

**Resolution-rekkefølge** (`server/auth/middleware.js:99-151`):
1. PUBLIC_PATHS (`/health`, `/ready`, `/metrics`,
   `/privacy.html`, `/terms.html`, `/login.html`, `/invite.html`,
   `/setup.html`) — pass-through.
2. SOFT_AUTH_PATHS (`/api/auth/*`, `/api/invitations/*`,
   `/api/auth/me`, `/api/auth/logout`) — auth-attempt men ikke
   krevd. Kontekst rensker hvis token mangler.
3. Bearer-token (RPi-mode med `AUTH_TOKEN`).
4. Session-cookie (multi-tenant-mode).
5. Legacy fallback: hvis `AUTH_TOKEN` mangler OG ingen session →
   tilegn LOCAL_USER til family_id=1.
6. Ellers throw 401.

**Punkt 5 er en pilot-faktor:** Hvis pilot-deploy ikke har
`AUTH_TOKEN` satt, fall-through til LOCAL_USER betyr at appen
fungerer som single-tenant LAN-mode. Dette er fortsatt OK fordi
Christer er eneste bruker, men hvis Cloudflare Tunnel åpner appen
mot internett uten `AUTH_TOKEN` → angriper får automatisk
family_id=1 (som er orphan). Beslutning C1 er beslektet.

**Anbefaling:** Verifiser at pilot-deploy enten har gyldig
`AUTH_TOKEN` (RPi-mode) eller at `SESSION_SECRET` er satt og
`hverdagsplanleggeren.com` ikke er åpen mot internett før session
er etablert. Bootstrap-wizard genererer begge ved første run, så
dette er sannsynligvis allerede OK.

### 3.2 Rate-limiting — **OK**

**Global bucket** (`server/http/security.js:104-145`):
- 300 requests / 60 sekunder per IP.
- Sliding-window per-IP. RPi-friendly in-memory.
- Trip → 429 + `Retry-After`.

**Strict auth-bucket** (`server/http/security.js:158-190`):
- 5 attempts / 15 minutter per IP på destruktive auth-endpoints
  (`POST /api/auth/magic-link/start`,
  `GET /api/auth/google/start`).
- Beskytter mot brute-force på email-quota og state-cookie-
  generering.
- `/api/auth/me` og `/api/auth/logout` er **bevisst utelatt** for å
  unngå at frontend AuthContext-poller låser brukeren ute (fix fra
  Sprint 1 / Prompt 2).

**Email-rate-limit (per email)** (`server/auth/magic-link.js:60-73`):
- 5 magic-link starts / 60 minutter per email.
- In-memory, resettes ved restart.

### 3.3 CSRF-beskyttelse — **OK**

- `SameSite=Lax` på session-cookie.
- POST/PUT/DELETE krever `Content-Type: application/json` (avvises
  ellers i `parseBody()`). Det betyr enkel HTML-form-CSRF feiler
  fordi nettlesere setter `application/x-www-form-urlencoded` på
  default forms.
- Ingen separat CSRF-token. For SameSite=Lax + JSON-only er dette
  tilstrekkelig.

### 3.4 CORS-konfigurasjon — **OK i produksjon**

`server/http/middleware.js:18-33`:
- I `NODE_ENV=production`: `ALLOWED_ORIGINS=*` er forbudt
  (config-validation rejects start-up).
- Domain-list må være eksplisitt komma-separert.
- BOOTSTRAP_MODE har `*` midlertidig til wizard-fullføring.

**Pilot-spørsmål:** Hva blir `ALLOWED_ORIGINS` etter wizard? Se
deploy-runbook.

### 3.5 Security headers — **OK**

`server/http/security.js:243-255`:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: same-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; ...
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Strict-Transport-Security: max-age=31536000 (kun i prod + HTTPS_TERMINATED=true)
```

**CSP kommentar:** `script-src 'self' 'unsafe-inline'` — `unsafe-
inline` for inline event-handlers i legacy public/index.html. v2
bruker bare bundled JS via `<script src=...>` som er '`'self'`'-
trygt. Når legacy-app retires kan `unsafe-inline` fjernes.

### 3.6 Åpne (uautentiserte) endpoints

Søk i `server/routes.js` viser at de fleste route-declarations ikke
har `requireRole()`-middleware. Det betyr at autentisering håndteres
av den globale `authenticate`-middleware-en — hvis ingen session og
ingen `AUTH_TOKEN`, forventes brukeren å være public/soft-auth-
bruker. Hver route-handler antar at `ctx.user` finnes.

**Verifisert via grep:**
- Routes med `requireRole('owner')`: 7 (settings, ownership-
  transfer, family-delete, role-change).
- Routes med `requireRole('adult')`: 22 (mutating actions).
- Routes uten role-check: 76 (mest GETs + middlewared via
  `authenticate`).

**Spot-check på sensitive endpoints:**
- `GET /api/family/members/:id/diet` — ingen role-check, men
  scoped til `getFamilyId()`. Verifisert OK.
- `GET /api/audit` — ingen role-check; viser audit-log per family.
  **MEDIUM:** Bør være owner-only? Eller adult+? Per pilot er
  Christer eneste bruker så det spiller ingen rolle.
- `GET /api/profile` / `PUT /api/profile` — per-family, ingen
  role-check. OK.

**Anbefaling (post-pilot):** Audit-route bør krever `adult`+ rolle.

### 3.7 Body-size limit

`config.MAX_BODY_BYTES=1MB` (default), eksplisitt enforced i
`parseBody()`. Receipts kan inneholde bilder — men receipts uses
multipart endpoint som bypassser denne (egen logikk i
`/api/receipts/upload`). Verifisert.

---

## Område 4: Funksjoner uten endpoint / placeholders

### 4.1 Skjerm-for-skjerm placeholders

#### Calendar.tsx — **HEL skjerm placeholder**

```tsx
// Phase-1d placeholder for the Calendar screen. Real implementation
// — Google passthrough + family-events overlay — arrives in Phase 2D
// (Sprint 5 / Prompt 10).
```

**HIGH-issue H3:** Calendar er bare en heading + p-tag. Pilot har
ingen kalender-funksjonalitet. Bekreft scope.

#### Family.tsx — **2 av 3 buttons er placeholders**

- **"Edit family name"** → viser inline status "Funksjon kommer
  snart" i 3 sekunder. Backend-endepunktet
  (`PUT /api/family`, owner-only) finnes og virker, men er ikke
  koblet i frontend. Settings-skjermen har
  `InlineEditableText` som faktisk fungerer for family rename.
  Den i Family.tsx er duplikat-knapp som kunne vært fjernet.
- **"Invite member"** → viser placeholder. Backend
  (`POST /api/family/invitations`) finnes. Frontend mangler
  modal/form. **HIGH-issue H2.**

#### Settings.tsx — **6 disabled rows med "Coming soon"-badges**

- **Timezone** (badge: `sprint6`) — disabled
- **Meal times** (badge: `sprint7`) — disabled
- **Gamification** (badge: `sprint6`) — disabled
- **Email notifications** (badge: `requiresResend`) — disabled
- **Push notifications** (badge: `requiresResend`) — disabled

**HIGH-issue H4:** Disabled rows er greit hvis Christer bekrefter
scope. UI-pattern (disabled + badge) er tydelig for bruker. Bare et
spørsmål om pilot-forventning.

#### Dashboard.tsx — **OK**

QuickActions-knapper (`Add meal`, `Add chore`, `Add shopping`)
navigerer til `/meals`, `/family`, `/shopping` — alle skjermene har
faktisk funksjonalitet. Quick-actions-knappen "Add chore" navigerer
til `/family` selv om chore-lifecycle er på Dashboard, ikke Family.
Det er en lett rar UX, men ikke en bug.

### 4.2 Backend-endpoints uten frontend-bruk (potensielt dead code)

Søk etter unique endpoints i routes.js viste:
- `/api/integrations/:name/test` — owner-only, manuell SaaS-tester.
  Brukes ikke i v2-frontend; var for legacy-settings-html.
- `/api/sources` (recipe-sources) — backend-flyt for cron-jobb.
  Ikke v2-frontend ennå.
- `/api/llm/warm`, `/api/llm/status`, `/api/llm/cache/stats` —
  intern observability. OK å beholde, brukes via cli/curl.
- `/api/sunday-push` — legacy-flyt for Sunday-push-cron-output.
  Brukes i tester, ikke v2-frontend.
- `/api/recipes/import-url`, `/api/recipes/import/image`,
  `/api/recipes/from-llm` — recipe import-flyt. Backend ferdig,
  v2-frontend mangler. **MEDIUM:** Recipe import er post-pilot
  per `docs/workflow/post-pilot-roadmap.md`.

### 4.3 Quick-actions-redirects som ikke matcher

Dashboard's `Add chore`-knapp navigerer til `/family`, men chores
vises på Dashboard (under TodayCard) ikke Family. Mindre UX-issue.
**LOW.**

---

## Område 5: Pagination og performance

### 5.1 Endpoints som returnerer lister

| Endpoint | Limit / Pagination | Pilot-volum | Status |
|---|---|---|---|
| `GET /api/recipes` | Internal `LIMIT 50` på search | 36 (seed) + brukers | OK |
| `GET /api/shopping/list/current` | Henter alle items i listen | 30–80 / uke | OK |
| `GET /api/pantry` | Ingen limit | 50–100 over tid | OK for pilot |
| `GET /api/meals/:weekYear` | 7 (en uke) | 7 | OK |
| `GET /api/family` | 4–6 medlemmer | 1 (Christer) | OK |
| `GET /api/audit` | `LIMIT 100` (default) | 16 (Christer's idag) | OK |
| `GET /api/notifications` | Ingen limit | < 50 | OK |
| `GET /api/receipts` | `LIMIT 50` | < 50 | OK |
| `GET /api/inventory_log` | `LIMIT 100` | < 200 / uke | OK |

**Pilot-skala-konklusjon:** Ingen pagination-issues for pilot.

**Post-pilot:** `GET /api/audit` og `GET /api/inventory_log` vil
vokse uten pruning. Cron-jobb for sletting eldre enn N uker bør
implementeres innen 6 måneder. **MEDIUM.**

### 5.2 Performance-issues

- **N+1 i shopping-list-enricher:** Sjekket. Bruker batch-load via
  `repos.products.getAllAsMap()` + in-memory matching. OK.
- **N+1 i recipe-listing:** `GET /api/recipes` joiner med
  ingredients via single SQL query (verifisert i
  `server/repositories/recipe.repo.js`). OK.
- **DB-indekser:** `docs/DB_INDEXES.md` dokumenterer indeks-
  strategi. 38 indekser definert. OK.

### 5.3 Caching

- **LLM-cache:** `llm_cache`-tabell. Global (cross-family) — men
  cache-nøkler embedder kun generisk data
  (recipe-name + ingredient). Ingen aktiv lekkasje. **MEDIUM:**
  Hvis fremtidige cache-keys embedder per-family-data,
  introduserer det tenant-cross-talk. Dokumentert i
  `docs/runbooks/llm-cache-key-policy.md`.
- **Repository-cache:** `repos.cache` (in-memory Map). Brukes for
  oppskrift-listings. Invalidate ved insert/update/delete. OK.
- **HTTP ETag:** Alle JSON-responser har `ETag`. `If-None-Match`
  → 304. OK.

---

## Område 6: Error message handling

### 6.1 Backend error-håndtering — **OK**

**RFC 7807 Problem Details** (`server/http/errors.js`):
- Konsekvent format: `{type, title, status, detail, instance, requestId}`.
- 14 standard error-konstruktører (badRequest, unauthorized,
  forbidden, notFound, conflict, payloadTooLarge,
  tooManyRequests, internal, serviceUnavailable, validation, ...).
- 500 Internal Server Error: stack-trace logges via pino, **men
  detail-feltet maskeres som "Intern feil"** i prod.
- requestId returneres i alle problem-bodies for support-referanse.

**Verifisert:** Ingen SQL-detaljer eller stack-traces lekker i
respons-body.

### 6.2 Frontend error-håndtering — **OK**

- `client/src/app/lib/apiError.ts` parser RFC 7807-bodies.
- ErrorBoundary-komponent fanger React render-feil.
- Per-skjerm error-cards med "Try again"-knapp.
- Toast-notifikasjon for save-errors i Settings.
- Loading skeletons + status meldinger med `aria-live="polite"`.

**Coverage:** `client/src/app/lib/apiError.test.ts` finnes.

### 6.3 i18n for errors — **OK med små manko**

`client/src/app/i18n/locales/{no,en}/*.json` har en `errors.*`-
seksjon i flere namespaces. Dokumentert i
`docs/workflow/i18n-error-candidates.md`.

**MEDIUM:** Noen low-traffic edge-case-feilmeldinger er fortsatt
hardkodet på engelsk i hooks (f.eks. "Network error",
"Validation failed"). Disse er allerede katalogisert.

### 6.4 Error ID-strategi

Alle 4xx/5xx-respons inkluderer `requestId` som klient kan vise
til support. RequestID logges også med strukturerte pino-logger.
Operatør kan grep'e `request_id=abc123` i container-logs.

---

## Område 7: Internationalisering (i18n)

### 7.1 Bundle-parity — **OK**

Verifisert via script:
- 9 namespaces (auth, calendar, common, dashboard, family,
  meals, pantry, settings, shopping).
- 464 keys i NO og 464 keys i EN — **perfekt match, 0 mismatches**.
- `client/src/app/i18n/bundles.test.ts` håndhever parity i CI.

### 7.2 Hardkodet tekst — **OK**

Søk etter hardkodede norske ord i client/src/app/ avdekket bare:
- Test-fixtures (acceptable).
- 1 setting-row i a11y.test.tsx — testkode.
- Inline ARIA-labels som genereres fra t() (faktisk dynamisk).

**MEDIUM:** Stay vigilant ved nye PR-er. Linting-pattern for
`/[^\\\\][^a-zA-Z0-9]\\b(og|eller|men|ikke|er|kan|må)\\b/` ville
fange hardkodet norsk, men er ikke aktivert.

### 7.3 Pluralisering — **OK**

`react-i18next` plural-pattern brukt i:
- `meals:weekList.entries_one` / `entries_other`
- `shopping:summary.itemCount_one` / `itemCount_other`
- m.fl.

### 7.4 Date/number-formatering — **OK**

- `Intl.DateTimeFormat(i18n.language)` brukt i meals-uke-display.
- Tall: `Intl.NumberFormat` brukt i price-display.
- Valuta: `1 234,56 kr` i NO; `NOK 1,234.56` i EN. OK.

### 7.5 White-labeling — **OK**

`VITE_APP_NAME` (frontend) + `APP_NAME` (backend) støttes. Default
= `FamilyAssistant`. Christer setter
`VITE_APP_NAME=Hverdagsplanleggeren` i prod-env.
`tests/email-service-app-name.test.js` +
`client/src/app/i18n/app-name.test.ts` håndhever pattern.

### 7.6 Default-språk-deteksjon — **OK**

`LanguageDetector` leser `localStorage['fa:language']` først, så
`navigator.language`. Pilot-default = NO. Forced til NO i
test-setup.

---

## Område 8: Deploy-readiness

### 8.1 Portainer-konfigurasjon — **OK**

**Dockerfile** (multi-stage):
- Stage 1: `node:20-bookworm-slim` med build-tools for
  better-sqlite3.
- Stage 2: `node:20-bookworm-slim` runtime + tini + gosu.
- ARM64 + AMD64 multi-arch via `docker buildx`.
- HEALTHCHECK via `node -e fetch('http://localhost:7777/health')`.

**docker-compose.yml**:
- `pull_policy: always` — Portainer henter ny `:main`-tag på hver
  stack deploy.
- BOOTSTRAP_ALLOWED=true — første deploy uten `AUTH_TOKEN` aktiverer
  setup-wizard på `/setup.html`.
- Volume `./data:/app/data` — DB + backups persisterer.
- Resource-limits: 512MB RAM, 1.5 CPUs (RPi5-tunet).
- `extra_hosts: host.docker.internal:host-gateway` — Ollama på host.

**Sekundær Caddy-tjeneste** (gated bak `--profile production`) for
HTTPS-reverse-proxy. Lytter på 80/443. Caddyfile er konfigurert
men ikke aktivert by default.

**Anbefaling:** Verifiser at Portainer-stack settes opp uten
`--profile production` første gang (for å la wizard kjøre på
HTTP). Etter wizard er fullført, aktiver Caddy + sett
`HTTPS_TERMINATED=true`.

### 8.2 Cloudflare Tunnel — **IKKE AKTIVERT**

**HIGH-issue H6.** Repoet har ingen `cloudflared`-konfig i
`docker-compose.yml`. `app.hverdagsplanleggeren.com` er ikke koblet
til pilot-RPi.

**Beslutning kreves:** For pilot 13. mai:

| Alt | Risiko | Innsats |
|---|---|---|
| **A: LAN-only via Tailscale** (Christer's Mac/Mobil → RPi via Tailscale-IP) | Lav; allerede setup | 0 timer |
| **B: Aktiver Cloudflare Tunnel før pilot** | Medium (DNS, cert, første-deploy) | 2–4 timer |
| **C: Utsett Tunnel til post-pilot** | Lav | 0 timer (men `hverdagsplanleggeren.com` blir ubrukt) |

**Anbefaling: A eller C.** Pilot er for Christer's egen familie —
LAN/Tailscale er nok. `app.hverdagsplanleggeren.com` aktiveres
post-pilot når flere familier skal joine.

### 8.3 RPi5-spesifikt — **OK**

- ARM64-bilde via multi-arch buildx.
- better-sqlite3 kompileres ved build for target.
- Memory-limits 512MB matcher RPi5 4GB med rom for andre tjenester.

### 8.4 Backup-strategi — **OK**

- **`server/backup.js`:** Daily backup via `VACUUM INTO` til
  `data/backups/familieassistenten-YYYY-MM-DD.db`.
- **Retention:** 14 dager (konfigurerbar via `BACKUP_KEEP_DAYS`).
- **Off-site:** `BACKUP_REMOTE_PATH` env-var støtter rsync over
  SSH/daemon eller plain fs-copy. **Ikke aktivert by default.**
- **Restore:** Manuell prosedyre dokumentert i `RUNBOOK.md`.

**HIGH-issue H7:** Backup-restore er ikke verifisert. Anbefaling:
gjør én manuell restore-test før pilot. Estimat: 30 min.

### 8.5 Logging — **OK**

- **Pino** structured-logger.
- Log-level: `info` i prod, `debug` i dev.
- Sensitive-data redact i `server/logger.js` redact-paths.
- Container-log → Portainer Console / `docker logs -f`.

**MEDIUM:** Ingen log-rotation på container-side. Docker default
log-driver `json-file` har `max-size=unlimited` med mindre satt.
Anbefaling: konfigurer `logging:` i docker-compose.yml til
`max-size=10m, max-file=3`. Estimat: 5 min.

### 8.6 Monitoring — **OK med MEDIUM**

- `GET /metrics` (Prometheus-format) — request count,
  duration_ms_histogram, error_count.
- `GET /ready` — readiness probe (DB driver, memory budget,
  AUTH_TOKEN-age).
- `GET /health` — liveness probe.
- `GET /api/status` — full status-rapport for /v2/status-skjerm.

Sentry (`SENTRY_DSN`-env-var) er optional — uninitialised hvis
ikke satt.

**Anbefaling:** Aktiver Sentry for pilot. Det gir tidlig varsel om
500-feil Christer ikke ville se ellers. Estimat: 15 min (sign-up +
DSN i bootstrap.json).

---

## Område 9: Dokumentasjons-tilstand

### 9.1 README.md — **OK**

Sist oppdatert 2026-04-29. Reflekterer nåværende state. Setup-
instruksjoner peker på Portainer-deploy-flyt.

### 9.2 CLAUDE.md — **OK med tillegg**

Reflekterer nåværende push-discipline (DEL 5.2). Multi-tenant frys
(DEL 6) er aktiv.

**Tillegg som lander i denne PR:** **DEL 14 — Multi-tenant testing
requirements** (per Christer's instruksjon). Se egen sub-section
nederst i denne audit-rapporten.

### 9.3 docs/-mappen — **OK**

Strukturert:
- `docs/analyses/` — 16 analyser (per-PR ANALYSEs per CLAUDE.md
  DEL 3 Steg 2).
- `docs/runbooks/` — 4 runbooks (B1 deploy, smart-coupling,
  llm-cache-key-policy, wcag-compliance).
- `docs/workflow/` — 22 dokumenter (pre-deploy-cleanup-plan,
  pending-decisions, post-pilot-roadmap, ...).
- `docs/baselines/` — perf-baselines.
- `docs/monitoring/` — metrics og alert-config.
- `docs/known-issues/` — bugs bevisst utsatt.
- `docs/frontend/` — v2-strategy.

**MEDIUM:** Pre-deploy-cleanup-plan.md sier cleanup-sesjonen er
"uke 9-10". Pilot er uke 7. Plan er ikke kjørt. Norske kommentarer
i mange filer + akkumulert debt er fortsatt der. Per planen er det
**ikke** pilot-blocker — det er post-pilot-jobb.

### 9.4 Code comments — **OK**

Mange filer har solid header-kommentarer som forklarer "why" + "how
this fits". Eksempler: `server/auth/magic-link.js`,
`server/auth/middleware.js`,
`server/services/shopping-list.service.js`. Pre-deploy-cleanup
sletter Norwegian-comments som dokumentert i CLAUDE.md DEL 7.7.

---

## Område 10: Test-coverage og helse

### 10.1 Test-rapport (kjørt 2026-05-03)

| Suite | Tests | Pass | Fail | Skip | Duration |
|---|---|---|---|---|---|
| **Backend** (`npm test`) | 1342 | 1340 | 0 | 2 | 11.4s |
| **Client** (`npm run test:client`) | 859 | 859 | 0 | 0 | 21.5s |
| **Total** | **2201** | **2199** | **0** | **2** | **~33s** |

### 10.2 Coverage

`npm run test:coverage:gate` kjører via
`scripts/coverage-gate.js`:
- Globale terskler: 80% lines, 68% branches, 72% functions.
- Ny-kode-terskler: 85% / 75% / 80% per CLAUDE.md DEL 7.2.

**Status:** Sist verifisert under PR #91, alle terskler bestått.
Ikke re-kjørt i denne audit (bare smoke-test).

### 10.3 Test-kategorier

- **Unit tests:** services, repositories, utility funksjoner. ~700.
- **Integration tests:** route-handlers + DB. ~400.
- **Multi-tenant tests:** isolation, role-enforcement,
  onboarding. ~33.
- **Security tests:** rate-limit, auth, CSRF, body-size,
  injection. ~50.
- **Migration tests:** every migration has its own test. ~24.
- **Phase tests:** policy-tests for repo-hygiene, structure. ~10.
- **Client tests:** 82 files, 859 tests across components,
  hooks, screens, utility, a11y.

### 10.4 Skipped tests

2 skipped på backend, identifisert som platform-spesifikke skips:
- `tests/auth-bootstrap-session-secret.test.js:155` —
  `{ skip: process.platform === 'win32' }` (chmod-permissions ikke
  testbart på Windows-fs).
- `tests/auth-bootstrap-session-secret.test.js:182` — samme.

På Linux (CI + RPi5 prod) kjører begge testene. **OK / ikke et
issue.**

### 10.5 Test-ytelse — **OK**

- Backend: 11.4s for 1342 tests. ~8.5ms / test.
- Client: 21.5s for 859 tests, derav ~14s i transform/setup/import
  (vitest cold-start). Tests selv 35.7s aggregert sec.

CI gjør PR-gate på Linux Node 20 (~3 min) og full matrix på main-
push (~10 min).

---

## Område 11: Aktive prosesser og bakgrunns-jobber

### 11.1 Cron-jobber (`server/cron.js`)

| Job | Tidspunkt | Beskrivelse |
|---|---|---|
| `Sunday-push` | Søndag 14:00 | Genererer ukemeny-forslag for neste uke |
| `Chore-plan` | Mandag 07:00 | Lager chore-schedule for ny uke |
| `Shelf-life` | Daglig 08:00 | Varsel om utløpende inventory |
| `Pantry-expired` | Daglig 08:05 | Slett utløpt inventory |
| `Depletion` | Daglig 22:00 | Reduser inventory pga. dagens middag |
| `LLM-cache-cleanup` | Daglig 04:00 | Rydd utløpte LLM-cache-rader |
| `Price-CPI-indexing` | 1. i mnd 05:00 | CPI-juster pris-referanser |
| `GDPR-soft-delete-purge` | Daglig 03:30 | Hard-slett soft-deleted users etter 30d |
| `Session-cleanup` | Daglig 04:10 | Slett utløpte sessions |
| `Magic-link-cleanup` | Daglig 04:15 | Slett utløpte magic-link-tokens |
| `Shopping-enrichment` | Hver 10. min | Berik pending shopping-lists med priser |
| `Recipe-sources-sync` | Hver 6. time | Sync eksterne recipe-sources |
| `Backup` | Daglig 03:00 | VACUUM INTO til data/backups/ |

**Total:** 13 aktive cron-jobber. Hver kjører `try/catch` med
logger til pino + `logger.error` ved feil. Backup logger til
`console.log` direct.

### 11.2 Logging av cron — **OK**

Hver kjøring logges som `[CRON YYYY-MM-DD HH:MM:SS] message`.
Søkbar via `docker logs | grep CRON`.

### 11.3 Database migrations

```
server/migrations/001_initial_schema.sql ... 024_family_id_strict_constraints.sql
```

24 migrations. Per `tests/migration-runner-fk-aware.test.js`,
runner håndterer FK-references korrekt. Migration 024 (siste)
strammet family_id-constraints og var pilot-blocker som ble løst i
PR #91.

**Status:** Ingen pending migrations. Schema-version er current.

### 11.4 Background tasks utenfor cron

- **State-snapshot** (`server/state-snapshot.js`) — periodisk
  in-memory cache-snapshot for `/api/status`. Hvert 30. sek.
- **Watchdog** (`server/index.js:131`) — sjekker liveness og
  restartere services ved memory-pressure.
- **Rate-limit cleanup** (`server/http/security.js:194`) —
  periodisk rensk av in-memory rate-limit-buckets.

---

## Område 12: Løse kode-tråder

### 12.1 Dead code

Identifiserte:
- **Sprint 5–7-references** i kommentarer. Sprint 4-tilstand er
  current; Sprint 5-7 referanser er retningsangivende, ikke dead.
- **Legacy public/-app.** `public/index.html`, `public/login.html`
  m.fl. Frosset per CLAUDE.md DEL 6. Skal byttes ut av v2 før
  pilot? Per `docs/frontend/v2-strategy.md`: v2-app erstatter
  legacy-app gradvis. For pilot brukes v2 (`/v2/*`).

### 12.2 Untracked files i repoet

- `data/` — DB + backups (gitignored).
- `db-check.js`, `db-pantry-check.js` — Christer's diagnostic
  scripts. **IKKE gitignored.** Linter klager.

**Anbefaling C3 (CRITICAL):** Legg `db-check.js`,
`db-pantry-check.js`, `*-check.js` i `.gitignore`, eller flytt til
`scripts/` (allerede gitignored undermappe). Estimat: 2 min.

### 12.3 Duplicate flows

- **Family rename** finnes på Settings.tsx
  (`InlineEditableText` + `PUT /api/family`) OG på Family.tsx
  (placeholder-knapp). Settings-versjonen er den ekte.
  Family-versjonen kan fjernes. **MEDIUM.**
- **Add Item-flow på Shopping** — én via QuickAddInput, én via
  smart-merge-regenerate. Begge er bevisst (forskjellige
  intents). OK.

### 12.4 Frosset kode (CLAUDE.md DEL 6)

- `server/auth/` — soft-thaw via DEL 6.1b. Kan endres med
  Christer-godkjenning per PR.
- `server/observability/sentry.js` — fortsatt fryst.
- 8 test-filer fryst (multi-tenant, role, auth, GDPR,
  phase14/20/21).

**Status:** Frys håndheves implisitt ved policy-tester
(`tests/phase21-repo-hygiene.test.js`). OK.

### 12.5 Lint-warnings — **CRITICAL C3**

Når `npm run lint` kjøres etter `npm run build:client`:
- 342 errors på `public/v2/assets/main-*.js` (built bundle).
- 7 errors på `db-check.js`, `db-pantry-check.js` (untracked).
- 1 warning på `client/src/app/components/layout/ErrorBoundary.tsx`
  (unused eslint-disable directive).

### 12.6 Prettier-warnings på 74 test-filer — **MEDIUM**

`npm run format` rapporterer 74 `tests/*.test.js`-filer som ikke
matcher prettier-konfig. Pre-existing issue (ikke introdusert av
denne PR). Kan løses med `npm run format:fix`. CI passerer fortsatt
fordi `npm run format` ikke er en blokker i `npm run ci`-scriptet.

**Anbefaling:** Kjør `npm run format:fix` i en egen `chore/format-
test-files`-PR før pilot. 5 min. Lavpri.

**Fix:**
```js
// eslint.config.mjs ignores
ignores: [
  'node_modules/**',
  'data/**',
  'backups/**',
  'coverage/**',
  'public/index.html',
  'public/dist/**',
  'public/v2/**',          // ← legg til
  'db-*.js',                // ← legg til
  '.claude/**',
],
```

Estimat: 5 min.

---

## Område 13: Avhengigheter og sikkerhet

### 13.1 npm audit (production-only)

```
$ npm audit --omit=dev --audit-level=high
found 0 vulnerabilities
```

✓ **0 vulnerabilities** i prod-deps.

### 13.2 Bundle-størrelse

```
public/v2/assets/main-Dx0p-2Q5.js: 399.43 kB | gzip: 119.21 kB
public/v2/assets/main-DeDwUVhS.css: 33.78 kB | gzip: 6.78 kB
fonts: ~270 kB total
```

Total client gzip: ~126 kB main + 6.78 kB CSS + ~270 kB fonts
(cached forever).

**Trend:** 117 kB (Sprint 6) → 119 kB (current). Stabil.

**MEDIUM:** Bundle inneholder hele `lucide-react` icon-library
(tree-shaking begrenset i mode "import * as Icons"). Hvis bundle
vokser videre, vurder per-icon import. Nåværende OK.

### 13.3 Outdated dependencies

Major-bumps tilgjengelige (per CONTEXT.md):
- `@sentry/node` — Dependabot PR #67 (major).
- Dev-deps minor-group — Dependabot PR #69.
- GitHub Actions OSV-scanner-bump.

**Status:** Dependabot-PR-er er separate; ikke pilot-blocker.

### 13.4 License-compliance

Prosjekt: MIT. Alle prod-deps har MIT/ISC/Apache-2.0/BSD.
**OK.**

---

## Område 14: Pilot-spesifikke krav

### 14.1 GDPR-vurdering

#### `/privacy.html` og `/terms.html`

**Status:** Begge filer eksisterer i `public/` med **substansielt
innhold på norsk**.
- `privacy.html` (153 linjer): behandlingsansvarlig, datakategorier,
  3rd-party-prosessorer (Google, Resend, AI-leverandører, RPi5-host,
  Backblaze B2, Sentry), brukerrettigheter (eksport, korrigering,
  sletting), retention-policy, cookie-bruk.
- `terms.html` (129 linjer): bruksvilkår.

**MEDIUM-issue M-PRIV1:** Personvernerklæring nevner Backblaze B2
nattlig backup og Sentry. Begge er **ikke aktivert i pilot-deploy**
(Sentry-DSN er optional og B2 er ikke konfigurert i
docker-compose.yml). Denne tekst-vs-virkelighet-mismatch må
korrigeres før pilot — enten ved å aktivere disse tjenestene eller
fjerne nevningene fra dokumentet.

**LOW:** Privacy nevner "Google OAuth" som auth-metode, men v2-
frontend har bare magic-link UI. Backend støtter Google OAuth, men
det er ikke en pilot-feature. Bør oppdateres for å reflektere at
pilot bruker magic-link.

For Christer-only-pilot er pilot-bruker = data-eier = beslutter.
GDPR-eksponering er minimal, men dokumentene **må stemme overens
med faktisk drift**.

#### Data-eksport

`Settings > Account > Export my data`:
- Endpoint: `GET /api/me/export` (gdpr-routes.js).
- Returnerer ZIP med JSON-utdrag fra alle per-family-tabeller.
- Test: `tests/gdpr-endpoints.test.js`. ✓

#### Data-sletting

`Settings > Account > Delete account`:
- Endpoint: `DELETE /api/me` (soft-delete + 30d cron-purge).
- Owner-of-family kan ikke slette uten ownership-transfer (UI
  pre-disables knappen).
- Test: `tests/gdpr-endpoints.test.js`. ✓

#### Cookie-banner

**Ikke implementert.** Pilot bruker:
- 1 essential session-cookie (`fa_session`).
- 0 analytics, 0 tracking, 0 third-party.

Per ePrivacy-direktivet er ikke essential session-cookies banner-
pliktige. **LOW.**

### 14.2 Pilot-bruker dokumentasjon

**Onboarding-guide:** Ingen ekstern PDF/wiki. Setup-wizard via
`/setup.html` er teknisk operatør-rettet, ikke pilot-bruker-
rettet.

**Anbefaling:** For pilot der Christer er bruker = operatør, er det
OK. Hvis flere familier joiner post-pilot: skriv onboarding-doc.

**Feedback-mekanisme:** Ingen in-app-feedback (`/api/feedback` finnes
men ingen frontend). Christer logger feedback direkte til Claude/
PR-er. **OK for pilot.**

### 14.3 Support-strategi

**Pilot:** Christer = operatør = bruker. Self-support.
**Post-pilot:** Trenger e-post-channel + kontaktinfo.

### 14.4 Rollback-strategi

**Pre-deploy:** `RUNBOOK.md` har rollback-prosedyrer. **OK.**

**Container-level rollback:** Portainer kan re-deploye tidligere
image-tag (`ghcr.io/.../familyassistant:sha-XXXX`).

**DB-level rollback:** Daglig backup gjør at restore til <24h
tilbake er trivielt:
```bash
cp /app/data/backups/familieassistenten-2026-05-12.db \
   /app/data/familieassistenten.db
docker compose restart app
```

**HIGH-issue H7:** Restore-prosedyre er ikke testet. Anbefaling:
gjør én manuell restore-test før pilot. Estimat: 30 min.

---

## Pilot-blockers (CRITICAL)

| ID | Issue | Impact | Fix-tid |
|---|---|---|---|
| **C1** | Family 1 orphan seed-data (36 recipes + 7 meal_plans) | DB-clutter; potensial cross-tenant-confusion ved fallback til LOCAL_USER | 15 min (script + run) |
| **C2** | Email-leveranse for magic-link ikke verifisert i prod | Pilot-bruker kan ikke logge inn hvis Resend ikke fungerer | 30 min (SignUp + smoke-test) |
| **C3** | ESLint klager på `public/v2/**` build-bundle og `db-*.js` | CI-failure ved npm run lint etter build:client | 5 min |

**Total CRITICAL fix-tid: ~50 minutter.**

---

## Anbefalt-før-pilot (HIGH)

| ID | Issue | Impact | Fix-tid |
|---|---|---|---|
| **H1** | Logout-knapp mangler i v2-Settings | Pilot-bruker kan ikke logge ut uten cookie-clear | 30 min |
| **H2** | Family invitation-UI er placeholder | Pilot er solo-only | 0 (acceptable) eller 4t (build modal) |
| **H3** | Calendar-skjerm er placeholder | Ingen kalender i pilot | 0 (acceptable) eller 8t |
| **H4** | Settings: 5 disabled "Coming soon"-rows | UX-forventning | 0 (acceptable) |
| **H5** | Privacy + terms-tekst stemmer ikke med faktisk drift (Backblaze B2, Sentry, Google OAuth nevnes men er ikke aktivert) | GDPR-presisjon | 20 min (rens dokumenter) eller aktiver tjenestene |
| **H6** | Cloudflare Tunnel ikke aktivert | hverdagsplanleggeren.com peker ingensteder | 0 (LAN-only OK) eller 4t |
| **H7** | Backup-restore ikke testet | Recovery-risk hvis pilot-DB korruptes | 30 min |
| **H8** | Sentry ikke aktivert | Manglende error-monitoring | 15 min |

**Total HIGH-anbefalt-fix-tid: 2–3 timer (hvis bekrefte scope) /
6–10 timer (hvis bygge invitations + calendar).**

---

## Post-pilot scope

Allerede dokumentert i `docs/workflow/post-pilot-roadmap.md`:
- Recipe import-UI (image, URL, LLM)
- Family invitation-flyt komplett (modal + email)
- Calendar (Google + family-events)
- Settings: timezone, meal times, gamification, push notifications
- Email + push-notifikasjoner (Resend + WebPush)
- Cloudflare Tunnel + custom domene
- Sliding session-window
- Cookie-banner hvis ikke-essential cookies introduseres
- Audit-log pruning-cron
- Bundle-size-optimering (per-icon-import)

---

## Eksisterende infrastruktur (allerede klart)

For å unngå dobbeltarbeid — **dette finnes og virker:**

### Backend
- ✓ Magic-link auth-flyt (token-hash, rate-limit, email + console
  fallback).
- ✓ Multi-tenant runtime-isolation (`getFamilyId()` +
  AsyncLocalStorage).
- ✓ Per-family seed (`seedFamilyDefaults` + onboarding-tx).
- ✓ Session-håndtering (server-side, cookie-id-only).
- ✓ Logout + logout-all + per-session-delete.
- ✓ GDPR-eksport + -slett (med 30d soft-delete).
- ✓ RFC 7807 error-format (alle 4xx/5xx).
- ✓ Rate-limiting (global 300/min + auth 5/15min).
- ✓ CSP + sec-headers + HSTS.
- ✓ CORS-validering (refuse `*` i prod).
- ✓ Backup-cron + restore-prosedyre.
- ✓ 13 cron-jobber.
- ✓ Health/Ready/Metrics-endpoints.
- ✓ Sentry-hook (uninitialised hvis DSN mangler).
- ✓ Audit-log per family (16 entries for Christer).

### Frontend (v2)
- ✓ React + Vite + TypeScript strict.
- ✓ Tailwind design-system.
- ✓ react-i18next NO/EN (464 keys parity).
- ✓ Onboarding-wizard (FamilySetup + UserProfile).
- ✓ Login (magic-link only, no Google OAuth UI).
- ✓ Dashboard, Family, Meals, Shopping, Settings, NotFound.
- ✓ ErrorBoundary + per-skjerm error-cards.
- ✓ Skeletons + aria-live status.
- ✓ WCAG 2.1 AA compliance.
- ✓ Theme switcher (light/dark).
- ✓ White-labeling (`VITE_APP_NAME`).

### Test
- ✓ 2201 tester totalt (1340 backend + 859 client + 2 skipped).
- ✓ Multi-tenant isolation suite (33 tester).
- ✓ Coverage-gate 80/68/72.
- ✓ Lint + typecheck + format-gates.
- ✓ Phase21 repo-hygiene policy-tester.

### Deploy
- ✓ Multi-arch Dockerfile (ARM64 + AMD64).
- ✓ Portainer-ready docker-compose.yml.
- ✓ Bootstrap-wizard (`/setup.html`) for første-deploy.
- ✓ HEALTHCHECK + tini + gosu.
- ✓ Multi-tenant aktivert på RPi-stien.
- ✓ Self-healing `bootstrap.json` for upgrade-paths.

### Docs
- ✓ README, CLAUDE.md, CONTEXT.md, RUNBOOK.md, DEPLOY.md.
- ✓ DOMAIN_MODEL.md.
- ✓ 16 PR-analyses.
- ✓ Post-pilot-roadmap.

---

## Anbefalt neste steg

### Trinn 1 — Fullfør CRITICAL (i kveld, ~1 time)

1. **C3:** PR med eslint-config-fix (ignores `public/v2/**`,
   `db-*.js`).
2. **C2:** Smoke-test Resend-key i Christer's prod-env (eller
   bekreft `MAGIC_LINK_CONSOLE=true` er akseptabelt for pilot).
3. **C1:** Skriv `scripts/repair-default-family-orphan.js` og kjør
   mot Christer's RPi.

### Trinn 2 — Fullfør HIGH (i morgen, ~3 timer)

4. **H1:** Logout-knapp i Settings.tsx.
5. **H5:** Privacy + terms minimum-tekst.
6. **H7:** Manuell restore-test.
7. **H8:** Aktiver Sentry.

### Trinn 3 — Bekreft acceptances (samtale)

8. **H2 (invitations), H3 (calendar), H4 (settings disabled rows),
   H6 (Cloudflare Tunnel):** Christer bekrefter at disse er
   post-pilot-scope.

### Trinn 4 — Pilot-dry-run (uke 6)

9. Stack-deploy til RPi.
10. Magic-link smoke-test (én round-trip).
11. Verify Christer's eksisterende session fungerer.
12. Backup + restore drill.

### Trinn 5 — Pilot-launch (13.–17. mai)

13. Christer bruker appen daglig.
14. Ende-til-ende-feedback samles.
15. Post-pilot-roadmap aktiveres.

---

## CLAUDE.md DEL 14 — Multi-tenant testing requirements

Per Christer's instruksjon legges følgende seksjon til CLAUDE.md
(se egen commit i denne PR):

```markdown
## DEL 14: Multi-tenant testing requirements (2026-05-03)

Etter pre-pilot multi-tenant-audit (PR #90, #91) ble flere bugs
oppdaget som ikke var dekket av eksisterende test-suite. For å
forhindre regresjon, denne regelen er obligatorisk for alle
fremtidige PR-er.

Hver feature-PR som introduserer:

a. **Ny tabell med family_id-felt**
   → Cross-tenant-isolation-test obligatorisk
   → Test må verifisere at family A ikke kan se family B sine
     rader via direkte query eller via endpoint

b. **Ny endpoint som tar/returnerer per-family data**
   → Cross-tenant-isolation-test obligatorisk
   → Test må verifisere at endpoint filtrerer på getFamilyId()
   → Test må verifisere at family A ikke kan se/manipulere
     family B sine data

c. **Ny seed-data som kjører ved oppstart eller onboarding**
   → Per-family-vs-global-vurdering dokumentert
   → Hvis per-family: idempotent + family-scoped seed-funksjon
   → Hvis global: eksplisitt dokumentert hvorfor

d. **Endring i onboarding-flow**
   → Onboarding-isolation-test obligatorisk
   → Test må verifisere at ny familie får eget data, ikke
     deler med eksisterende familier
   → Test må verifisere ingen orphan-FKs

KONSEKVENS:
- PR kan ikke merges uten relevante tester
- Ved review: eksplisitt sjekkpunkt "Multi-tenant verifisert?"
```

---

## Audit-konklusjon

Repoet er **HIGH-confidence GO** for pilot 13.–17. mai 2026 etter
~1 time CRITICAL-fix og ~3 timer HIGH-anbefalt-fix.

Ingen blokkerende sikkerhets- eller data-integritets-issues
oppdaget. Multi-tenant-isolasjonen, auth-flyten og
test-coverage-en er solid.

De fleste "Coming soon"-områdene (calendar, invitations, push) er
ikke pilot-blockers — de er bevisste post-pilot-features per
roadmap.

Christer beslutter scope for fix-PR-er og pilot-launch-tidspunkt.
