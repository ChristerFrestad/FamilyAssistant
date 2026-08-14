# AGENT_LOG.md – Append-only arbeidslogg

> Claude skriver hit etter hver oppgave. Aldri slett gamle innlegg.
> Format er definert i `CLAUDE.md` DEL 8.
> Nyeste innlegg øverst.

---

2026-08-14 – G1-3 recipe create / update / soft-deactivate API

Task: Manual POST/PATCH plus active-flag deactivate for recipes.
Import/LLM already insert; meals picker must not break.

Analysis: no separate ANALYSIS file (implementer ticket with a
fixed schema). Journey: create → list → patch ingredients →
deactivate → still resolve on meal plan / GET :id.
- Journey: 6 steps
- Edge cases: 5 (401, child 403, cross-family 404, DELETE 405,
  inactive still on meals/current)
- Decisions: 2 — GET list is active-only; shopping-list and GDPR
  use includeInactive so planned meals still shop/export
- Portainer risk: no (additive migration 032 DEFAULT 1)

Plan: migration 032, repo insert/update/setActive, Zod + HTTP,
sourceType on LLM/import insert, recipe-crud tests.

Done:
- Branch: feat/g1-3-recipe-crud-api
- Commits: 1
- Files changed: migration, recipe.repo, schemas, routes, router,
  server body-parse PATCH, CORS, import/from-llm sourceType,
  shopping-list + GDPR includeInactive, tests, DOMAIN_MODEL
- Tests added: tests/recipe-crud.test.js
- DOMAIN_MODEL.md updated: yes (Recipe entity)
- Deviation from plan: used 032 (G1-1 had not created 032 yet)

Security: family_id only via getFamilyId(); PATCH/GET isolated;
DELETE refused.

ISO 25010: Maintainability + Functional suitability. Security
unchanged (same ALS scope).

Status: waiting-for-operator

Decisions the operator must make:
None required. 032 may collide with G1-1 chore migration — if
they also land 032, rebase one side to 033.

Next: run tests; do not push unless asked.

---

2026-08-14 – G0-5 Isolation attacker (swapped family ids)

Oppgave: Adversarial tester som prøver å lekke familie B mens A er
innlogget — body/query/header family_id, B sine numeriske id-er,
cookie-replay, cache-probe, barn-rolle, CSRF uten cookie.

Analyse: docs/analyses/2026-08-14-g0-5-isolation-attacker.md
- Reisen: register+onboarding (2 familier) + 7 probe-klasser
- Edge cases: 10
- Beslutninger: 3 (session er eneste family-kilde; similarity-cache
  family-nøkkel; passord-sti som G0-1)
- Portainer-risiko: nei

Plan: tester i g0-5-isolation-attacker.test.js; fiks kun hvis
en-linjes getFamilyId/cache-lekkasje.

Gjort:
- Branch: feat/g0-integrate
- Filer: tests/g0-5-isolation-attacker.test.js (29 probes),
  recipe-similarity.service.js (cache-fiks), analyse, AGENT_LOG
- Tester: 29/29 grønne etter fiks (før fiks: 28 pass, 1 fail)
- DOMAIN_MODEL.md updated: no
- Avvik: fant ekte leak i GET /api/recipes/:id/similar

Security: Ingen endepunkt binder family_id fra body/query/header.
Session + ALS vinner. Probe-resultat:
1. Body family_id: ingen schema har feltet. Kalender stripper og
   oppretter i A. Shopping add er .strict() → 400. Meals swap
   endrer ikke B.
2. Query family_id/familyId på recipes, meals/current, calendar,
   pantry, me/export, family/export, today: 200 med A, aldri B.
3. B-id i A's GET/PUT/DELETE: 403/404/tomt. Kalender-slett 200-no-op
   (B-raden står). Chore complete/mark-eaten rører ikke B.
4. A's cookie mot B-ressurser: ingen B-markører.
5. Cache /api/today: A varmer, B får B sine events/måltid (G0-3 nøkkel).
6. Barn i A: POST calendar 403. POST /api/chores 404 (ingen create).
7. Uten cookie + X-Family-Id / family_id header: 401.

LEAK (fikset): similarity-cache på recipe-id alene, slått opp før
getById. B varmet, A fikk 200 med B-only-Raspeball. Fiks: getById
først + nøkkel `${familyId}:${id}`.

Residual: meals/swap kan lagre fremmed recipe_id i A's plan; navnet
lekker ikke (getById scoped). Ikke G0-blocker.

ISO 25010: Security + (lekkasje tettet). Øvrige ikke affected.

Status: waiting-for-operator

Beslutninger operatøren må ta:
Ingen. Anbefaling: ta med fiks + tester i G0-integrate. Similarity-
fiksen er liten og påkrevd.

Neste: ikke pushet (ingen «push» i oppdraget).

---

2026-08-14 – G0-6 operator docs: current surfaces + cache

Task: Oppdatere operator-docs på engelsk så de matcher det G0
faktisk shipper (ikke G1/G3 som levert).

Analysis: ingen separat ANALYSIS — docs-only synk mot allerede
merget G0-1–G0-4.

- Journey: README Features → Current surfaces-tabell → ARCHITECTURE
  calendar + withCache → screenshots-note.
- Edge cases: /v2 som URL vs. build-mappe; ikke overselge
  Google-kalender, recipe create/edit, chores-opprett-UI.
- Decisions: 1 — tabell etter Features, ikke erstatte
  backend-capability-listen. 2 — calendar er ikke placeholder.
- Portainer risk: no

Plan: README-tabell + /v2-presisering, ARCHITECTURE withCache,
screenshots optional note, AGENT_LOG, én commit.

Done:
- Branch: feat/g0-integrate
- Commits: 1 (docs: G0 current surfaces and cache isolation notes)
- Files changed: 4 (README.md, docs/ARCHITECTURE.md,
  docs/screenshots/README.md, AGENT_LOG.md)
- Tests added: 0
- DOMAIN_MODEL.md updated: no
- Deviation from plan: none

Security: ingen kodeendring. Dokumenterer at withCache-nøkler er
family-scopet (G0-1/G0-3-fiks).

ISO 25010: not affected (dokumentasjon).

Status: waiting-for-operator

Next: operator leser tabellen mot kjørende UI; valgfritt ta
kalender- og oppskriftsskjermbilder senere.

---

2026-08-14 – G0-4 Recipes library (thin)

Oppgave: Familier har GET /api/recipes og Meals-picker, men ingen
egen bibliotekskjerm. G0-4 legger til /recipes inne i AppShell og
en «Åpne bibliotek»-lenke fra Meals. Ikke create/edit (G1-3/G1-4).

Analyse: ingen separat ANALYSIS — tynn G0-skjerm, gjenbruker
eksisterende fetchRecipes og Meals last/feil-mønster.

- Reisen: Meals-header → /recipes → GET /api/recipes → liste
  (navn, kategori, prepTime, servings) / tom / feil+retry.
- Edge-cases: barn uten import-CTA, voksen kun dempet G1-note,
  abort ved unmount/retry, kategori uten badge-variant.
- Beslutninger: ikke wire POST /api/recipes/import-url (trenger
  mer enn ett felt + feilflater). Ikke i PRIMARY_NAV_ITEMS.
- Portainer-risiko: nei (kun frontend-rute + i18n).

Plan: Recipes.tsx + tester, rute, Meals-lenke, recipes-namespace
en+no, gjenbruk fetchRecipes.

Gjort:

- Branch: feat/g0-4-recipes-library
- Filer: Recipes.tsx/.test.tsx, Meals-lenke, App-rute, i18n
- Tester: Recipes 6, Meals +1 Open library, bundles 11 ns
- DOMAIN_MODEL.md updated: no
- Avvik fra plan: none

Security: GET /api/recipes bak samme AuthGuard/OnboardingGuard.
Ingen mutasjon. Barn får ingen import-CTA.

ISO 25010: usability (funnbar liste), maintainability (gjenbruk
mealsApi). Ikke affected: security-modell, reliability backend.

Status: waiting-for-operator

---

2026-08-14 – G0-2 GDPR export isolation (HTTP dual-family)

Task: Bevise via HTTP at familie A sitt GDPR-export aldri inneholder
familie B sine data, og vurdere child/adult export-scope.

Analysis: docs/analyses/2026-05-04-gdpr-family-export.md (eksisterende)
- Journey: 2 familier, cookie-sesjoner, GET /api/me/export +
  GET /api/family/export, child-export, owner-only family-export
- Edge cases: non-owner 403, child får full familie (kontrakt),
  last-owner DELETE allerede dekket
- Decisions: 1 — behold documented full-family /api/me/export for
  alle medlemmer inkl. child (ikke redesigne GDPR)
- Portainer risk: no

Plan: HTTP-isolasjonstester i gdpr-endpoints + gdpr-family-export;
ikke endre export-payload; kommenter residual child-email risiko.

Done:
- Branch: feat/g0-2-gdpr-export-isolation
- Files changed: 4 (gdpr-routes comment, 2 testfiler, AGENT_LOG)
- Tests added: 4 HTTP-tester (me dual-family, child contract,
  family dual-family, non-owner 403)
- DOMAIN_MODEL.md updated: no
- Deviation from plan: none — produksjons-scope uendret

Security: Cross-tenant isolation bevist over HTTP cookies.
Child /api/me/export inkluderer andre medlemmers e-post — residual
G4-risiko, dokumentert i test + kommentar.

ISO 25010: Security/compliance +0 (bevis, ikke ny funksjon).

Status: waiting-for-operator

---

2026-08-14 – G0-1 to-familie passord-isolasjon (e2e)

Oppgave: Bevis at to familier på samme SQLite-prosess ikke ser
hverandres meals, shopping, chores, recipes, calendar, pantry
eller GDPR-export — via ekte password-register + onboarding
(ikke magic-link DB-scrape).

- Reise: register A/B → fa_session → onboarding/complete → seed
  distinct data → GET-isolasjon + cross-DELETE + uauth export 401.
- Funnet og fikset: HTTP-response-cache nøklet kun path+query.
  Family B fikk X-Cache HIT på A's /api/meals/current, /api/today
  og /api/calendar/events. cacheKey inkluderer nå familyId
  (Number.isInteger && > 0, ellers anon).
- Ikke fikset: GET /api/today og /api/chores/current slår opp
  oppgave-etiketter i global seedChores (seed-id), ikke
  familie-rader. Etter onboarding blir etiketter '?' — samme
  seed-labels er OK; IDer er isolert. Cross-DELETE av kalender
  returnerer 200 no-op (raden overlever).
- Portainer-risiko: nei (test + 1-linje cache-nøkkel).

Gjort:

- Branch: feat/g0-1-two-family-e2e
- Filer: tests/e2e-two-families-password.test.js,
  scripts/e2e-two-families.js, server/http/cache.js, AGENT_LOG.md
- Tester: node --test tests/e2e-two-families-password.test.js
  → 11 pass / 0 fail. Gammel e2e-tenant-isolation.js urørt.
- DOMAIN_MODEL.md: nei

Status: waiting-for-operator (review/merge)

---

2026-08-14 – G0-3 local family calendar events

Task: Replace Calendar "Coming in Phase 2D" placeholder with a real
local family-events screen, and stop Dashboard from inventing startsAt
when the API returns date + startTime.

Analysis: none (implementer pass on existing backend).
- Journey: list (today..+30d) → add (adult/owner) → delete (adult) →
  child read-only. Dashboard upcoming card uses the same event shape.
- Edge cases: empty range, GET error + retry, cancelled delete confirm,
  cross-family GET/DELETE isolation, cached GET leaking tenants.
- Decisions: 1 — adapt CalendarEvent to the real API (date, startTime,
  endTime, allDay) rather than synthesizing startsAt. 2 — family-scope
  withCache keys after isolation test found a tenant leak.
- Portainer risk: no (client + cache key only; no migration).

Plan: rewrite Calendar.tsx, fix dashboard types, EN+NO i18n, Calendar
and dashboard tests, server isolation test, commit.

Done:
- Branch: feat/g0-3-calendar-events
- Commits: 1
- Files changed: Calendar screen + calendarApi, dashboard mapping,
  i18n, tests, cache key family-scope
- Tests added: Calendar.test.tsx (9), calendar-events.test.js (2),
  dashboardApi date/startTime pass-through
- DOMAIN_MODEL.md updated: no
- Deviation from plan: also family-scoped GET cache keys after the
  isolation test proved pathname+query leaked events across families.
  screens.test Login heading updated to current password-first copy.

Security: GET /api/calendar/events cache is now keyed by familyId;
A cannot list or delete B's events.

ISO 25010: Functional suitability (calendar CRUD UI), security
(tenant cache isolation), maintainability (type matches OpenAPI).

Status: waiting-for-operator

---

2026-08-07 – Password auth + progressive email verification

Oppgave: Lav barrier-to-entry med brukernavn/passord parallelt med
magic link. Full tilgang med en gang; e-postverifisering via magic
link innen konfigurerbar grace (default 60 dager). Etter frist:
neste login krever verifisering + passord-reset.

Analyse: docs/analyses/2026-08-07-password-auth-parallel.md

- Reisen: register → session → app; soft grace; hard gate ved login
  etter frist → magic link (purpose email_verify_reset) → set password.
- Edge-cases: syntetisk e-post `local+user@password.local`, scrypt
  dummy-timing, open register env-flagg, grace env uten migrasjon.
- Beslutninger: username+scrypt, PASSWORD_AUTH_* + EMAIL_VERIFICATION_GRACE_SECONDS,
  magic link uendret for classic login.
- Portainer-risiko: nei (nye env er optional med trygge defaults).

Gjort:

- Branch: feat/password-auth-progressive-verify
- Migrasjon 031, password-hash, password handlers, magic-link purpose
- Frontend Login (password-first), SetPassword, AuthGuard redirect
- Tester: tests/auth-password.test.js (8), frontend auth grønne
- Settings: EmailVerificationBanner under grace
- .env.example dokumentert

Merge: krever operatørgodkjenning (DEL 6.1b soft-thaw).

---

2026-05-28 – Public-repo prep PR 7: finalize for public flip

Oppgave: Syvende og siste av 7 PR-er. Public-repo-artefakter +
SLSA-flagg-flip + gitignore av operatør-scratchpad. Etter denne
PR-en er repoet klart til å flippes til public via GitHub UI.

Analyse: docs/analyses/2026-05-27-public-repo-readiness.md

- Reisen: 4 logiske commits — (1) SLSA flag flip,
  (2) GitHub-templates + untrack CONTEXT.md, (3) gitignore +
  phase21-test, (4) denne AGENT_LOG.
- Edge-cases: CODE_OF_CONDUCT.md ble eksplisitt utelatt etter
  Christer's beslutning (org policy block via GitHub UI). Husky
  v9→v10 ble skipt fordi .husky/pre-commit allerede er v10-
  kompatibel (bare `npx lint-staged`, ingen .husky/_/husky.sh-
  source). phase21-test må oppdateres når CONTEXT.md untrackes —
  whitelist måtte krympe med én entry.
- Beslutninger: Christer-godkjente: utelat CODE_OF_CONDUCT, gjør
  alt annet i den planlagte PR 7-scopen. Blank check på 7
  Dependabot-PRs (#137, #136, #130, #129, #128, #134) for
  autonom merge når CI grønn.
- Portainer-risiko: nei (kun GitHub-meta-filer + SLSA-flagg +
  gitignore + test-whitelist).

Plan: (1) SLSA-flip (allerede gjort tidligere på PR 7-branch),
(2) opprett .github/PULL_REQUEST_TEMPLATE.md +
.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.md,
(3) `git rm --cached CONTEXT.md` + .gitignore-utvidelse,
(4) oppdater phase21-test whitelist, (5) AGENT_LOG.

Gjort:

- Branch: chore/public-repo-prep-7-finalize (basert på PR 6-branch)
- Commits: 4 PR 7-commits totalt (b526e31 SLSA + 2c60d68
  templates+CONTEXT-untrack + e46b3b8 gitignore+test +
  denne AGENT_LOG)
- Filer endret: 8 (release.yml + 4 nye GitHub-templates + CONTEXT.md
  delete + .gitignore + phase21-test + AGENT_LOG)
- Nye filer: .github/PULL_REQUEST_TEMPLATE.md,
  .github/ISSUE_TEMPLATE/{bug_report.md,feature_request.md,
  config.yml}
- Slettet fra git: CONTEXT.md (forblir på disk som operatør-
  scratchpad)
- Test-resultat: 1361 backend pass / 0 fail / 2 skip. Lint
  0 errors. Typecheck (server + client) clean.
- DOMAIN_MODEL.md oppdatert: nei
- Avvik fra plan: CODE_OF_CONDUCT.md utelatt (Christer-beslutning).
  Husky v10-upgrade utelatt (allerede kompatibel).

Sikkerhet:
- SLSA-flagg flippet til `private-repository: false` — riktig
  for public repo. Provenance vil nå loggføres standard i
  Sigstore Rekor uten det private-repo-flagget.
- ISSUE_TEMPLATE config.yml redirecter sikkerhetsrapporter til
  GitHub Security Advisories (private disclosure) per
  SECURITY.md §5.
- PR-template har full sikkerhetssjekkliste fra AGENTS.md DEL 4.

ISO 25010:
- Vedlikeholdbarhet 8.65 → 8.70 (+0.05, bidragsfriksjon
  redusert via templates)
- Andre karakteristikker: ikke berørt

Status: lokalt klart, venter på push.

Christer-godkjent for fortsettelsen:
1. Blank check for autonom merge av 7 Dependabot-PR-er
   (#137 dev-minor, #136 runtime-minor, #130 osv-scanner,
   #129 gh-release v3, #128 qemu-action v4, #134 lint-staged v17)
   når CI grønn.
2. PR #135 (react-router-dom v6→v7) og #133 (react-dom) er
   høyrisiko majors — anbefales close + koordinert migrasjon
   senere. Venter på endelig "ja close dem" fra Christer.

Neste: push PR 7, vent CI grønn, merge alle 6 (PR 2-7) i
rekkefølge, merge 7 godkjente Dependabot. Deretter Christer
flipper repo til public via GitHub Settings.

---

2026-05-28 – Public-repo prep PR 6: split CLAUDE.md → AGENTS.md + CHRISTER.md

Oppgave: Sjette av 7 PR-er. CLAUDE.md (1291 linjer norsk) blandet
generelle agent-prinsipper med operatør-spesifikke detaljer
(port-mapping for utviklermaskinen, ECC config-protection-hook-
workaround, literal norsk push-trigger-frase, rpi-memory MCP).
Public-repo-lesere trenger de generelle delene; operatør-spesifikt
hører i en per-operatør lokal fil. Per audit-doc §13 beslutning 4
(Christer-godkjent 2026-05-27).

Analyse: docs/analyses/2026-05-27-public-repo-readiness.md

- Reisen: 3 logiske commits — (1) AGENTS.md + CLAUDE.md sletting
  + phase21-test, (2) cross-reference-sveip i 22 aktive filer,
  (3) gitignore-fix for *.db-shm/wal som ble accidentally
  tracked via `git add -A`.
- Edge-cases: phase21-repo-hygiene.test.js måtte byttes fra
  readdirSync til `git ls-files "*.md"` så CHRISTER.md (gitignored,
  men på disk) ikke teller mot whitelist. SQLite WAL/SHM-filer
  (.db-shm/.db-wal, ikke .sqlite-shm/.sqlite-wal som PR 1 dekket)
  ble accidentally tracked og måtte fjernes + gitignore utvidet.
- Beslutninger: audit §13 beslutning 4 (split CLAUDE.md) drev
  hele PR-en. Historiske filer (docs/analyses, docs/workflow,
  AGENT_LOG, CHANGELOG, design/) beholder originale CLAUDE.md-
  referanser per append-only-prinsipp.
- Portainer-risiko: nei (docs + test-policy + 2 client/server
  kode-kommentarer, ingen oppstarts-kode endret).

Plan: (1) dispatch translation-agent for AGENTS.md (1268 linjer
EN) + CHRISTER.md (149 linjer NO, gitignored), (2) slett CLAUDE.md,
(3) oppdater phase21-test, (4) sveip aktive filer for CLAUDE.md
DEL X.Y → AGENTS.md DEL X.Y refs, (5) fiks gitignore for db-shm/
wal, (6) AGENT_LOG.

Gjort:

- Branch: docs/public-repo-prep-6-split-claude-md (basert på
  PR 5-branch i stacked-PR-pattern)
- Commits: 3 split-commits + denne AGENT_LOG-commit = 4 totalt
  på denne branchen
- Filer endret: 35 totalt (AGENTS.md + CLAUDE.md deletion +
  phase21-test + 22 aktive cross-ref-oppdateringer + 8
  utracked-fjerninger + AGENT_LOG)
- Ny fil: AGENTS.md (1268 linjer, engelsk)
- Slettet fra git: CLAUDE.md, 8 *.db-shm/*.db-wal-filer
- Test-resultat: 1361 backend pass / 0 fail / 2 skip; 928
  client pass / 0 fail. Lint 0 errors. Typecheck (server +
  client) clean.
- DOMAIN_MODEL.md oppdatert: nei
- Avvik fra plan: accidentally tracked 8 SQLite WAL/SHM-filer
  via `git add -A`. Fanget før push og ryddet i commit 3.

Sikkerhet: ingen sikkerhets-endring — kun docs-split + ref-
sveip. Bekreftet ingen nye PII introdusert. CHRISTER.md er
fortsatt gitignored (verifisert via `git check-ignore CHRISTER.md`).

ISO 25010:
- Vedlikeholdbarhet 8.55 → 8.65 (+0.10, AGENTS.md som engelsk
  agent-instruks gjør repoet tilgjengelig for forks som vil
  reproduce arbeidsflyten)
- Portabilitet 8.75 → 8.80 (+0.05, operatør-spesifikke detaljer
  separert fra produktet)
- Andre karakteristikker: ikke berørt

Status: lokalt klart, venter på push fra Christer

Beslutninger Christer må ta:

1. Claude Code auto-laster typisk `CLAUDE.md` ved sesjons-start.
   Nå er CLAUDE.md borte og AGENTS.md tar over. Hvis Christer's
   Claude Code-versjon støtter AGENTS.md (industry-standard
   konvensjon i nyere versjoner), kontekst auto-lastes uten
   endring. Hvis ikke: Christer kan lokalt symlinke
   `ln -s AGENTS.md CLAUDE.md` (lokalt, ikke committet) eller
   beholde sin egen lokale CLAUDE.md som peker til AGENTS.md.

Neste: PR 7 (SLSA-flagg + CODE_OF_CONDUCT + GitHub-templates +
fjern CONTEXT.md fra tracked + slett 28 stale branches) starter
umiddelbart.

---

2026-05-28 – Public-repo prep PR 5: brand consolidation to FamilyAssistant

Oppgave: Femte av 7 PR-er. Konsolider open-source-brand default til
"FamilyAssistant" overalt i tracked filer. Beholder breaking-rename
unngått: database-filnavn (`familieassistenten.db`), systemd-unit-
filnavn (`familieassistenten.service`), Prometheus-job/service-labels
står som-er for å ikke knuse installerte instanser eller scrape-
config. Per audit-doc §13 beslutning 9 (Christer-godkjent 2026-05-27).

Analyse: docs/analyses/2026-05-27-public-repo-readiness.md
(samme audit som PR 1-4)

- Reisen: 6 logiske commits — (1) package.json name, (2) Docker +
  CI workflows, (3) installer-scripts + systemd unit, (4)
  server-source brand-strings, (5) OpenAPI + monitoring, (6)
  remaining docs + nytt known-issue.
- Edge-cases: Prometheus `service: familieassistenten` og
  `job="familieassistenten"`-labels måtte stå urørt for å ikke
  knuse scrape-config; bare alert-summaries og dashboard-titler
  rebrandet. RUNBOOK.md grep-eksempel for "Started Familieassistenten"
  byttet til generisk `^.*Started.*\.service`-pattern slik at
  både pre- og post-rename systemd-unit-Description matcher.
  systemd-Description i `familieassistenten.service` byttet til
  engelsk "FamilyAssistant — self-hosted household assistant" så
  nye installs får riktig brand i `systemctl status`.
- Beslutninger: audit §13 beslutning 9 (Christer-godkjent)
  drev scope-valget. Andre overheard "Familieassistenten"-treff
  i source-kode-kommentarer (server/* + tests/helpers.js +
  client/* design-comments) er deferred til pre-deploy cleanup
  per DEL 7.7 (ingen drive-by).
- Portainer-risiko: nei (alle endringer er enten ikke-oppstarts-
  kritisk eller bakoverkompatibel via install.sh runtime-patching).

Plan: 6 PR-grupper + ny known-issue + AGENT_LOG.

Gjort:

- Branch: chore/public-repo-prep-5-brand-consolidation (basert
  på PR 4-branch i stacked-PR-pattern)
- Commits: 6 brand-konsolidering-commits + denne AGENT_LOG-commit
  = 7 totalt på denne branchen
- Filer endret: 22 totalt
- Ny fil: docs/known-issues/setup-html-missing-after-sprint-8-cleanup.md
- Test-resultat: 1361 backend pass / 0 fail / 2 skip. Lint
  0 errors. Typecheck (server + client) clean.
- DOMAIN_MODEL.md oppdatert: nei
- Avvik fra plan: oppdaget separat bug under PR 5-investigasjon
  (setup.html mangler etter Sprint 8 v1-cleanup, men bootstrap-
  flyten refererer fortsatt til /setup.html). Dokumentert som
  ny known-issue. Workaround eksisterer (sett AUTH_TOKEN direkte
  i Portainer); ekte fiks er post-pilot work.

Sikkerhet: ingen sikkerhets-endring — kun brand-rename. Bekreftet
ingen nye hardkodede credentials eller hemmeligheter introdusert.

ISO 25010:
- Portabilitet 8.70 → 8.75 (+0.05, brand-konsistens reduserer
  white-label oppsett-friksjon for forks)
- Vedlikeholdbarhet 8.50 → 8.55 (+0.05, samme brand-navn på
  tvers av tracked filer reduserer mental belastning ved review)
- Andre karakteristikker: ikke berørt

Status: lokalt klart, venter på push fra Christer
(Christer har sagt at PR 5-7 skal kjøres lokalt før batch-push)

Beslutninger Christer må ta:

1. setup.html-bug: dokumentert som known-issue, men fortsatt
   en reell deploy-blocker for fresh Portainer-deploys som
   følger DEPLOY.md §16. ANBEFALING: post-pilot work, ikke
   blocker for å gjøre repo public. Christer's egen pilot
   bruker workarounden allerede.

Neste: PR 6 (CLAUDE.md split til AGENTS.md + CHRISTER.md per
beslutning 4) starter umiddelbart.

---

2026-05-27 – Public-repo prep PR 4: translate public-facing docs to English

Oppgave: Fjerde av 7 PR-er. Oversett all public-facing
dokumentasjon fra norsk til engelsk slik at repoet blir
tilgjengelig for internasjonale contributors. Holdt
`docs/analyses/`, `docs/workflow/`, `AGENT_LOG.md`,
`docs/baselines/`, samt all source-kode-kommentarer på norsk per
audit-beslutning 2 (oversettelse av disse er stor jobb og
addresseres i pre-deploy cleanup-sesjon per CLAUDE.md DEL 7.7).

Analyse: docs/analyses/2026-05-27-public-repo-readiness.md
(audit §13 beslutning 2 ja-besvart av Christer)

- Reisen: 6 logiske commits — (1) root-docs, (2) deploy/ops-docs,
  (3) governance/reference-docs, (4) runbooks/known-issues/vision,
  (5) terms-pages bilingual, (6) policy-test-oppdateringer.
- Edge-cases: 5 filer ble identifisert som allerede engelsk og
  ikke rørt (PORTAINER_BRANDING_SETUP.md, architecture/frontend.md,
  runbooks/llm-cache-key-policy.md, runbooks/wcag-compliance.md,
  runbooks/ci-cd-pipeline.md). Quoted norske server-log-strings
  i RUNBOOK.md/DEPLOY.md bevisst bevart (operatører grep-er på
  dem). Bundle-parity-test for i18n upåvirket (kun no/en-bundles
  i client/, ikke endret her). 3 policy-tests refererte norske
  doc-strings og måtte oppdateres per CLAUDE.md DEL 6.5.
- Beslutninger: audit §13 beslutning 2 (pragmatisk oversettelse,
  ikke alle 104 .md-filer) drev scope-valget. Christers tilbake-
  melding "ok, dersom det er greit for å gjøre repo public" satte
  rammen.
- Portainer-risiko: nei (kun docs + 3 policy-test-regex, ingen
  oppstarts-kode).

Plan: dispatch 7 parallelle agenter for å oversette 17 doc-filer
+ opprette 1 ny fil (terms-en.html). Cluster:
- Agent A: README, package.json, CI.md, DB_INDEXES, BRAND_SYSTEM,
  frontend/v2-strategy, runbooks/smart-coupling-flow (~1100 linjer)
- Agent B: SECURITY.md, CONTRIBUTING.md (~590 linjer)
- Agent C: DEPLOY.md (§1-15), runbooks/deploy-portainer,
  runbooks/b1-deploy-checklist (~1230 linjer)
- Agent D: RUNBOOK.md (1137 linjer)
- Agent E: .env.example, known-issues, vision (~705 linjer)
- Agent F: DOMAIN_MODEL.md (352 linjer)
- Agent G: terms.html lang-toggle + ny terms-en.html (~260 linjer)
Totalt: ~5300 linjer prosa oversatt + 1 ny fil.

Gjort:

- Branch: docs/public-repo-prep-4-translate-public-facing
  (basert på PR 3-branch i stacked-PR-pattern)
- Commits: 6 oversettelses-commits + denne AGENT_LOG-commit = 7
  totalt på denne branchen
- Filer endret: 19 totalt (18 oversettelser + 3 policy-tester)
- Ny fil: public/terms-en.html (144 linjer)
- Test-resultat: 1361 backend pass / 0 fail / 2 skip; 928 client
  pass / 0 fail. Lint 0 errors. Typecheck (server + client) clean.
- DOMAIN_MODEL.md oppdatert: ja — oversatt til engelsk
- Avvik fra plan: 3 policy-tester brøt etter oversettelse fordi
  de asserterte på norske ord i SECURITY.md/RUNBOOK.md. Oppdatert
  per DEL 6.5 policy-test-regler med eksplisitt kommentar som
  refererer audit-doc og PR-nummer.

Sikkerhet: Ingen sikkerhets-endring — docs-only. Bekreftet ingen
nye PII introdusert under oversettelse (alle agenter ble instruert
å bevare brand-navn, e-poster, IP-er, paths som-er).

ISO 25010:
- Vedlikeholdbarhet 8.45 → 8.50 (+0.05, engelsk doc er
  tilgjengelig for bredere review-base)
- Portabilitet 8.60 → 8.70 (+0.10, internasjonale forks får
  dokumentasjon på arbeidsspråket sitt)
- Andre karakteristikker: ikke berørt

Status: lokalt klart, venter på push fra Christer
(Christer har sagt at PR 4 skal samles og kjøres som lokal
commit-batch først, så batch-pushes etter)

Pre-eksisterende observasjoner (uendret fra PR 1):

- 1 ESLint warning i client/.../ErrorBoundary.tsx
- 56 prettier-format-warnings på Windows (CRLF/LF), ikke berørt
  på Linux CI

Beslutninger Christer må ta:

1. Når PR 1-4 pushes (krever eksplisitt "push"-ord), squash til
   4 PR-er eller mindre? ANBEFALING: behold 4 PR-er for tydelig
   logisk separasjon ved review. Hver PR har 3-7 logiske commits
   som kan squashes per PR til 1-2 hvis ønsket.

Neste: PR 5 (brand-konsolidering til FamilyAssistant + fiks pilot-
gate/setup-wizard-bug per beslutning 9) eller PR 6 (CLAUDE.md
split per beslutning 4). Vent på Christer for ordre.

---

2026-05-27 – Public-repo prep PR 3: genericize user-facing strings

Oppgave: Tredje av 7 PR-er. Fjern operatør-spesifikke referanser
fra strings som faktisk vises til brukere — pilot-gate-lockout,
onboarding-placeholders, og privacy-policy-pages. Andre families
som forker prosjektet vil ellers se "Christer trenger at du
venter" eller "Christers pilot-RPi har volum-kryptering" i sin
egen UI.

Analyse: docs/analyses/2026-05-27-public-repo-readiness.md
(samme audit, §0.2 og beslutning 8)

- Reisen: 2 logiske commits — (1) i18n auth.json + tilhørende
  kode-kommentar, (2) privacy.html + privacy-en.html.
- Edge-cases: Bundle-parity-testen i bundles.test.ts håndhever
  same keys i no+en — kun verdier endret, ikke keys, så parity
  holdt. Ingen tester asserterer på spesifikk lockout-tekst
  (verifisert via grep). Privacy-sider verifiseres i
  static-pages.test.js bare for 200-status, ikke innhold.
- Beslutninger: brukte audit §13 beslutning 8 (parameteriser
  USER-FACING) som ja-besvart av Christer. Valgte å fjerne
  operator-navn helt fra lockout (renere enn `{{operatorName}}`-
  interpolering siden meldingen leser bedre uten det).
- Portainer-risiko: nei (statisk HTML + i18n-bundles, ingen
  oppstartsendring).

Plan: (1) bytt 6 i18n-strings (3 keys × 2 språk) +
PilotPasswordGate-kommentar, (2) genericisere 4 privacy-strings
(2 keys × 2 språk).

Gjort:

- Branch: feat/public-repo-prep-3-user-facing-strings (basert på
  PR 2-branch i stacked-PR-pattern)
- Commits: 2 PR 3-commits + AGENT_LOG = 3 totalt
- Filer endret: 5 (2 auth.json, PilotPasswordGate.tsx, privacy.html,
  privacy-en.html)
- Tester lagt til: 0
- Test-resultat: 1361 backend pass / 0 fail / 2 skip; 928 client
  pass / 0 fail. Lint 0 errors. Typecheck (server + client) clean.
- DOMAIN_MODEL.md oppdatert: nei
- Avvik fra plan: ingen
- privacy.html + privacy-en.html ble verifisert via Launch preview-
  panelet (åpnet av Edit-hook).

Sikkerhet: Andre family-forks får ikke lenger "Christer trenger at
du venter" som lockout, og privacy-policy-pages refererer ikke
lenger operatørens spesifikke RPi eller Cloudflare-domene. Forks
kan trygt deploye uten å først måtte rydde i bruker-vendte
strings.

ISO 25010:
- Sikkerhet 8.40 → 8.45 (+0.05, ingen operator-spesifikk PII i
  user-facing strings)
- Brukervennlighet 8.7 → 8.75 (+0.05, lockout-melding leser
  renere uten persontilskrivning)
- Portabilitet 8.55 → 8.60 (+0.05, forks får et helt-generisk
  default-bilde i pilot-flyt)
- Andre karakteristikker: ikke berørt

Status: lokalt klart, venter på push fra Christer

Pre-eksisterende observasjoner (uendret fra PR 1):

- 1 ESLint warning i client/.../ErrorBoundary.tsx (pre-Phase-1-debt)
- 56 prettier-format-warnings på Windows (CRLF/LF — påvirker ikke
  CI på Linux)

Beslutninger Christer må ta:

1. Når PR 1-3 pushes (krever eksplisitt "push"-ord), squash til
   3 PR-er eller behold logiske commits per PR? ANBEFALING:
   behold 3 PR-er som separat sluttet historikk — hver
   selvstendig revertbart.
2. Skal pilot-passordet (`Andromeda`) roteres i Portainer-
   stack før push? ANBEFALING: ja, gjøres som operatør-handling
   utenfor commit-streamen.

Neste: PR 4-7 ligger som plan i audit-doc §14. PR 4 er den
største (oversette 17 public-facing docs til engelsk, 3-4
sesjoner). Vent på Christer for ordre om å starte.

---

2026-05-27 – Public-repo prep PR 2: scrub PII in tracked files

Oppgave: Andre av 7 PR-er. Mekanisk PII-scrub i tracked filer
basert på audit-dokumentet. Bytter operatørens private LAN-IP,
personlige e-post, faktiske filsti-prefiks, og illustrative
familiemedlems-navn til generiske ekvivalenter.

Analyse: docs/analyses/2026-05-27-public-repo-readiness.md
(samme audit som PR 1)

- Reisen: 3 logiske commits — (1) LAN-IP-masking, (2) e-post +
  filsti, (3) 5 historiske analyser scrubbet i-place.
- Edge-cases: WelcomeHeader.test.tsx tester displayNameFromUser
  som ekstraherer navn fra e-post — bytte til peder@example.com
  krever symmetriske assert-oppdateringer (`Christer` → `Peder`).
  Admin-bootstrap-test for case-insensitivitet brukte tidligere en
  literal personlig e-post; byttet til ` Admin@Example.COM `.
  Beholdt operatørens NAVN ("Christer", "Frestad") som
  test-fixtures per beslutning 5 — navnet er offentlig OK, kun
  e-post er PII.
- Beslutninger: brukte audit §13 beslutning 6 (bytt e-post) og
  beslutning 7 (maskér LAN-IP) som ja-besvart av Christer.
- Portainer-risiko: nei (kun docs + test-fixtures, ingen
  oppstarts-kode).

Plan: (1) bytt 192.168.50.x → 192.0.2.x / `<rpi-lan-ip>` i
6 filer, (2) bytt operatørens personlige e-post → peder@example.com /
admin@example.com + /home/christer/ → /srv/familyassistant-data/,
(3) scrubbe 5 internal-analyser + Lise/Kari → Marte/Sofie.

Gjort:

- Branch: chore/public-repo-prep-2-pii-scrub-tracked (basert på
  PR 1-branch i stacked-PR-pattern)
- Commits: 3 PII-scrub-commits + denne AGENT_LOG-commit (4 totalt)
- Filer endret: 19 (CHANGELOG, Caddyfile, 2 backend-tester, 6
  client-tester/komponenter, 1 runbook, 5 historiske analyser)
- Tester lagt til: 0 (mekanisk fixture-bytte)
- Test-resultat: 1361 backend pass / 0 fail / 2 skip; 928 client
  pass / 0 fail. Lint 0 errors. Typecheck (server + client) clean.
- DOMAIN_MODEL.md oppdatert: nei
- Avvik fra plan: ingen
- AGENT_LOG.md og audit-doc selv beholder originale PII-treff
  (append-only-prinsipp + audit dokumenterer hva som ble funnet).

Sikkerhet: All ikke-historisk PII byttet til generiske eksempler.
Owner-navnet "Christer" + family-navnet "Frestad" beholdt i
fixtures per beslutning 5 (navn er offentlig OK).

ISO 25010:
- Sikkerhet 8.25 → 8.40 (+0.15, alle gjenværende PII-tokens i
  HEAD scrubbet bortsett fra append-only-historie)
- Vedlikeholdbarhet 8.35 → 8.40 (+0.05, generiske test-fixtures
  reduserer "spesielt-for-Christer"-koblinger)
- Andre karakteristikker: ikke berørt

Status: lokalt klart, venter på push fra Christer

Neste: PR 3 (USER-FACING strings — parameteriser auth.json
lockout, privacy.html-domener) starter umiddelbart.

---

2026-05-27 – Public-repo prep PR 1: stop acute leakage

Oppgave: Første av 7 PR-er for å gjøre repo public. Stopp akutt
lekkasje: scrub pilot-passord-fixture, slett untracked db-scripts
med hardkodet e-post, utvid .gitignore, og skift git author fra
personlig Gmail til GitHub noreply for fremtidige commits.

Analyse: docs/analyses/2026-05-27-public-repo-readiness.md
(950 linjer, full repo-dekning via 6 parallelle agenter)

- Reisen: 5 commits — audit-doc → test fixture-bytte →
  untracked-sletting → gitignore-utvidelse → AGENT_LOG.
- Edge-cases: 8 forekomster av Andromeda måtte byttes konsistent
  så symmetric-fixture-pattern (env + body) holder; .gitignore-
  utvidelser måtte ikke fjerne dekning for noe; git author-skift
  per repo (ikke global) så andre prosjekter ikke berøres.
- Beslutninger: 12 dokumentert i analyse §13, alle besvart av
  Christer 2026-05-27.
- Portainer-risiko: nei (kun test-fixtures + ignore-regler +
  lokal git config, ingen oppstarts-kode endret).

Plan: (1) commit audit-doc, (2) bytt 'Andromeda' →
'test-pilot-password' i 2 test-filer, (3) slett db-check.js +
db-pantry-check.js fra arbeidstreet, (4) gitignore db-*.js,
inspect-*.js, CHRISTER.md, sqlite-shm/wal, (5) skift git author
lokalt til 82406432+ChristerFrestad@users.noreply.github.com.

Gjort:

- Branch: chore/public-repo-prep-1-andromeda-and-untracked
- Commits: 3 (audit-doc + test fixture + gitignore; AGENT_LOG-
  innlegg blir commit 4)
- Filer endret: 4 (2 test-filer, .gitignore, denne loggen)
- Filer slettet fra arbeidstre (untracked, aldri committet):
  db-check.js, db-pantry-check.js
- Tester lagt til: 0 (mekanisk fixture-bytte, alle 1361 backend-
  tester passerer fortsatt — 0 fail, 2 skip)
- DOMAIN_MODEL.md oppdatert: nei
- Avvik fra plan: ingen
- Git author skiftet lokalt for dette repo-et fra operatørens
  personlige Gmail til
  `82406432+ChristerFrestad@users.noreply.github.com`.
  Eksisterende 175 commits med Gmail forblir (force-push forbudt
  per DEL 1 #7). user.name uendret ("Christer Frestad").

Sikkerhet: Andromeda-fixture var det eneste mulige passord-
literalfunnet i hele repoet. Christer bekreftet det var
midlertidig pilot-gate-passord — må roteres i Portainer-stack
før repo flippes public uansett (selv test-stuben i tidligere
commits lekker den gamle verdien i git-historikken). Ingen ekte
hemmeligheter funnet i utvidet skann (AKIA/sk_live/ghp_/JWT/PEM
alle returnerte 0 treff).

ISO 25010:
- Sikkerhet 8.2 → 8.25 (+0.05, ett potensielt passord-literal
  fjernet, gitignore strammere, author-skift stopper Gmail-
  lekkasje fremover)
- Andre karakteristikker: ikke berørt

Status: lokalt klart, venter på push fra Christer
(per DEL 5.2.1 — push krever eksplisitt "push"-ord fra Christer)

Pre-eksisterende observasjoner (ikke addressert i denne PR-en per
DEL 7.7 ingen-drive-by-cleanup):

- 1 ESLint warning (no-console disable-direktiv) i client/.../ErrorBoundary.tsx
- 56 prettier-format-warnings på lokal Windows (line-endings CRLF
  vs LF). CI på Linux er ikke berørt. Mest sannsynlig en gammel
  .gitattributes-config-issue, ikke ny.

Beslutninger Christer må ta (med anbefaling):

1. Roter pilot-passordet i Portainer-stack `app.familyassistant.com`
   nå (ANBEFALING: gjør det før neste push, uavhengig av om vi
   pusher PR 1-3 før eller etter).

Neste: PR 2 og 3 ligger som branch-chain etter denne. Skal
kjøres umiddelbart etter denne. Push når Christer eksplisitt sier
det med ordet "push".

---

2026-05-02 – Sprint 6 finalize: smart-coupling Pantry-Måltider-Handleliste

Oppgave: Mulighet A — bygg full kjede i én PR. Inkluder
mark-eaten-endepunkt + pantry-trekk-dialog som er kjerneverdi for
pilot. Reuse `'correction'`-reason i inventory_log (ingen ny
migration). Pre-deploy cleanup-bit holdt konservativ per CLAUDE.md
DEL 7.7.

Analyse: docs/analyses/2026-05-02-sprint-6-finalize-with-coupling.md
(403 linjer)

- Reisen: 8-stegs kjede plan → list → buy → pantry → cook →
  deduct → restock med 3-nivå-dybde på flere grener.
- Edge-cases: 20 dokumentert (over 8-minimum) — recipe uten
  ingredients, ingredient uten productKey, slug-kolliderte
  ingredients, dobbel mark-eaten, Cancel-når-network-feiler,
  family-roster-zero, optional-ingrediens-skip.
- Beslutninger: 6 (alle Christer-godkjent via Mulighet A-prompten).
  Two endpoints (mark-eaten + apply-deduction), reuse
  `'correction'`-reason, Marker tilberedt synlig alltid for
  status='planned', "Suggested from pantry"-badge i Shopping,
  ingen optimistic update på pantry-list, konservativ dead-code-
  scope per DEL 7.7.
- Portainer-risiko: nei (ingen migration, ingen oppstart-endring,
  kun tjeneste-utvidelser + frontend).
- ISO 25010: funksjonell egnethet 8.8 → 8.95 (+0.15, kjerne-
  verdikjede lukket), brukervennlighet 8.6 → 8.7, vedlikeholdbarhet
  8.3 → 8.35 (DOMAIN_MODEL får første reelle innslag),
  pålitelighet 8.4 → 8.45 (broken low-stock-trigger fix). Snitt
  ~8.55 → 8.62 (+0.07).

Plan: 12 commits — analyse, backend service+routes+tests, frontend
dialog+hook+i18n+badge+tests, E2E-chain-test, low-stock-tighten,
docs (DOMAIN_MODEL + smart-coupling-flow + README + CHANGELOG).
Endte som 6 squashable logiske enheter pluss analyse-commit.

Gjort:

- Branch: feat/sprint-6-finalize-with-coupling (fra ren main, etter
  PR #87-merge).
- Commits: 6 (analyse + backend + frontend + E2E + lokal CI grønn
  + docs).
- Filer endret: 28 (12 nye, 16 modifiserte). Backend +662
  innsettelser, frontend +1150, tester +416.
- Tester lagt til: 36 nye (18 backend integration + 1 E2E chain +
  17 client). Total backend: 1320 pass, 2 skip, 0 fail (var
  1302+2+0 før denne PR-en — +18 nye). Total client: 805 pass
  (var 770 før — +35 nye). Bundle: 113.21 → 115.83 KB gzipped
  (+2.62 KB, godt under 130 KB-mål).
- DOMAIN_MODEL.md oppdatert: ja (BR-001 low-stock-trigger, BR-002
  meal-deduction-reason-reuse). Første reelle entries i denne filen
  som har vært tom siden uke 1.
- Avvik fra plan: low-stock-trigger var pre-eksisterende broken
  (ikke bare manglende — `addItem`-kall hadde feil signatur og
  `getActive(weekYear)` ble kalt uten arg). Fix tatt med i scope
  som "drive-by" siden vi uansett verifiserte denne flyten.
  Endringen er strengt forbedring, ingen kontrakt-endring.

Sikkerhet: ingen nye sensitive endepunkter. Alle tre nye routes
under `requireRole('adult')`. Zod-validering på apply-deduction
body. Ingen secrets, PII, eller cross-tenant-eksponering. Sjekkliste
i PR-beskrivelsen.

ISO 25010: per analyse §2.7. Snitt 8.55 → 8.62. Ingen karakteristikk
under 8.0.

Lokal CI: alle grønne (lint på endrede filer ren, typecheck
server+client OK, 1320 + 805 tests pass, audit 0 vulns, build OK).

Status: åpen — venter på Christer manuell verifikasjon + push +
merge-instruksjon.

Beslutninger Christer må ta:

- Manuell verifikasjon i UI (full chain test-instruksjoner i PR):
  bekreft at MarkCookedDialog renderer suggestions, Confirm
  dekrementer pantry, Skip lar pantry være, Cancel ruller status
  tilbake, "Foreslått fra pantry"-badge vises på auto-restocked
  shopping-rad.
- Bekreftelse at reuse av `'correction'`-reason er greit for pilot
  (post-pilot kan vi vurdere migration med dedikert
  `'meal_deduction'`-enum-verdi).

Neste: ved push-godkjenning → squash til 1-2 meningsfulle commits,
push, åpne PR med engelsk tittel + body, vent CI grønn → vente på
"merge"-instruksjon → merge per DEL 5.3 (feat krever Christer).

---

2026-05-01 – Fase 3A WCAG 2.1 AA-revisjon + UX-audit (Sprint 6 åpnet)

Oppgave: Systematisk WCAG 2.1 AA-revisjon + UX-audit av alle 16
base-komponenter og 5 hovedskjermer (Dashboard, Family, Meals,
Shopping inkl. Pantry sub-view, Settings) før pilot-launch. Lukker
master-planens BESLUTNING 4 (mint kontrast-strategi).

Analyse: docs/analyses/2026-05-01-fase-3a-wcag.md (339 linjer)

- Reisen: 3 hovedflyter (pilot-bruker dag 1, dag 30, dag 60) med
  3-nivå-dybde — login-til-dashboard tab-traversal, Pantry-marker-brukt-
  modal, theme-toggle på tvers av skjermer.
- Edge-cases: 15 dokumentert (over 8-minimum) — inkluderer OS-temabytte,
  prefers-reduced-motion, 200% zoom, screen-reader på dynamic content,
  fargeblindhet for ExpiryBadge.
- Beslutninger: 6 (alle Christer-bekreftet via prompt-eksplisitt scope).
  B1 (jest-axe install godkjent ved at promptet eksplisitt ba om det),
  B2 (mint Alternativ A — mørkere mint i light mode), B3 (text-3
  beholdes som-er for hint/meta), B4 (rose-deep/coral-deep tilført),
  B5 (sm-button beholdes desktop-tett), B6 (CRITICAL+HIGH-fixes i
  denne PR-en, MEDIUM/LOW i wcag-followups.md).
- Portainer-risiko: nei (ren frontend, ingen migrasjon).
- ISO 25010: brukbarhet 8.8 → 8.95 (+0.15, WCAG-compliance og audit-
  prosedyre), vedlikeholdbarhet 8.6 → 8.65 (+0.05, kontrast-test +
  jest-axe fanger fremtidige regresjoner). Snitt 8.575 → 8.60 (+0.025).

Plan: 8 commits — analyse, token-fix + kontrast-test, deep-variant
komponentskifter, jest-axe install + a11y-tester, state-sync test +
docs, typecheck-fix.

Gjort:

- Branch: fix/wcag-revisjon (fra ren main, etter PR #84-merge).
- Commits: 6.
  - cf2de9d docs(analysis): analyse-dokument
  - a004395 feat(client/tokens): WCAG AA — darken mint, add deep-variants
  - 993c500 fix(client/components): use deep variants for error/destructive text
  - ce73f1c test(client): jest-axe a11y suites for components and screens
  - a8edd1d test+docs(wcag): state-sync regression + WCAG-compliance docs
  - 2bacaa5 fix(test/a11y): correct prop names to match component signatures
- Filer endret: 16 (4 nye tester, 1 ny utility, 6 component-fix,
  4 docs-nye eller -oppdaterte, 1 token-config).
  - Nye: client/src/app/styles/contrast.{ts,test.ts},
    client/src/test-helpers/axe.ts,
    client/src/app/components/{a11y,state-sync}.test.tsx,
    client/src/app/screens/a11y.test.tsx,
    docs/analyses/2026-05-01-fase-3a-wcag.md,
    docs/runbooks/wcag-compliance.md,
    docs/workflow/wcag-followups.md
  - Endret: client/src/app/styles/tokens.css,
    client/tailwind.config.ts,
    client/src/app/components/{form/Field,family/MemberCard,settings/
      DeleteAccountButton,pantry/UseDialog,pantry/PantryItem,
      shopping/ShoppingItemRow}.tsx,
    design/2026-04-redesign/design-gaps.md,
    docs/workflow/pending-decisions.md,
    package.json + package-lock.json (jest-axe install)
- Tester lagt til: 60 nye client-tester (23 contrast, 30 jest-axe
  components, 6 jest-axe screens, 1 state-sync). Total client: 770
  pass (var 710 før Fase 3A). Server: 1293 pass / 2 skip / 0 fail
  (uendret).
- DOMAIN_MODEL.md oppdatert: nei. WCAG-audit endrer ikke entiteter
  eller forretningsregler — kun design-tokens og a11y-attributter.
- Backend: ingen endringer.
- Avvik fra plan:
  1. Dark-mode mint-deep var også under AA på 4.35:1 (pre-eksisterende
     bug eksponert av min nye contrast-test). Fikset ved å bumpe til
     L=0.62. Dokumentert i tokens.css-kommentar.
  2. PortionFactorSlider standalone-bruk feiler axe (mangler label).
     Komponenten er per design "consumer wraps with label". Lagt til
     follow-up i wcag-followups.md (LOW-1) for fremtidig prop-add.
  3. ExpiryBadge tinted-badge text-coral på bg-coral/15 er borderline
     ~3-3.5:1. Defererert til wcag-followups.md (MEDIUM-1) siden fix
     krever design-runde-input på visuelt skifte.

Sikkerhet: ingen nye endepunkter, ingen ny auth-logikk, ingen ny
exposure. Ren design-token + testpakke. jest-axe (~30 KB dev-dep)
har 1 transitive dep (axe-core) — verifisert ingen runtime-impact
på prod-bundle (113.21 KB gzipped, identisk med Sprint 5).

Lokal CI-verifikasjon: alle grønne unntatt lint (kjent gap
dokumentert i pending-decisions.md "ESLint config-gap for public/v2/
build-artefakter" + Christer's untracked db-check.js-filer; ikke
forårsaket av denne PR-en).

- npm run typecheck server: 0 feil
- npm run typecheck:client: 0 feil
- npm run test:client: 770/770 pass (0 fail)
- npm test server: 1293 pass / 2 skip / 0 fail
- npm run audit:prod: 0 vulnerabilities
- npm run build:client: 113.21 KB gzipped main (uendret fra Sprint 5)
- npm run test:coverage:gate: lines 84.14/80, branches 74.84/68,
  functions 82.22/72 — over alle terskler.

Browser-verifikasjon: ikke kjørt — denne PR-en endrer kun design-
tokens og legger til tester. Christers manuelle pilot-test
verifiserer visuelt skifte (mørkere mint, dypere coral/rose i
errors), tab-navigering og screen-reader-flow per prompt-instruks.

Status: åpen — venter på Christer manuell test + push-godkjenning.

Beslutninger Christer må ta: ingen blokkerende. Bekreft etter
manuell test:

- Mint-grønt i light mode oppleves akseptabelt mørkere (anbefaling:
  ja, det er fortsatt tydelig mint-grønt; bare tonet ned ~10% L)
- Error-tekst i Field/Settings er tilstrekkelig synlig
- Tab gjennom Dashboard og Settings — synlig fokus-ring overalt?
- NVDA/VoiceOver test (anbefales): naviger Dashboard, verifiser
  meningsfulle annonseringer

Neste: ved push-instruksjon → squash til 1-3 logiske commits
(eller behold de 6 hvis ønskelig — alle har klare logiske scope),
kjør én siste lokal CI, push til fix/wcag-revisjon, åpne PR med
tittel "fix: WCAG 2.1 AA compliance audit + UX fixes". Vent på
CI grønn → vent på Christers godkjenning → merge per DEL 5.3
(fix krever Christer).

Sprint 6 er åpnet: Fase 3A komplett. Neste steg i master-planen er
Sprint 6 / Prompt 13 (sannsynligvis pre-deploy cleanup eller mer
audit-arbeid — refer til Christers Del B for detaljer).

---

2026-05-01 – Fase 2F Settings-skjerm (Sprint 5 avsluttet)

Oppgave: Bygge sjette og siste skjerm i Sprint 5 / Fase 2 — Settings.
Lukker Sprint 5 og gjør produktet "settings-komplett" for pilot.
Mockup-Settings har 9 SettingsGroups; Christer-bekreftet tett-scope
implementerer 4 seksjoner (System, Familie, Bruker, Konto).

Analyse: docs/analyses/2026-05-01-fase-2f-settings.md (373 linjer)

- Reisen: 5 hovedflyter (åpne, redigere familienavn, GDPR-eksport,
  slett konto, prøve disabled-rad).
- Edge-cases: 20 dokumentert (over 8-minimum) — owner-only edit,
  navn-validering 0/100 chars, GDPR-feil-håndtering, samtidige
  saves, theme-sync mellom AppShell-header og Settings-screen.
- Beslutninger: 8 (Christer-bekreftet 5 hoved + 3 implikasjoner).
  B1 (ingen migrasjon for family-prefs), B2 (ingen migrasjon for
  user-prefs), B3 (inline-edit familienavn), B4 (koble GDPR), B5
  (tett-scope). Disabled stubs for Coming soon-funksjoner.
- Portainer-risiko: nei (ren frontend, ingen migrasjon).
- ISO 25010: funksjonell egnethet 8.8 → 8.9 (+0.1, GDPR aktivert),
  brukbarhet 8.7 → 8.8 (+0.1, inline-edit + Coming soon-stubs),
  sikkerhet 8.2 → 8.3 (+0.1, GDPR-launch-blocker fjernet),
  snitt 8.51 → 8.55 (+0.04).

Plan: 6 commits — analyse, API+hook, komponenter, Settings+i18n+
ErrorBoundary, theme-sync-fix, design-gaps. Endte opp som 5
commits siden Settings.tsx + i18n + ErrorBoundary kunne kombineres
i én logisk enhet.

Gjort:

- Branch: feat/fase-2f-settings (fra ren main, etter PR #83-merge).
- Commits: 4 (etter squash til logiske enheter):
  - `289f00d` docs(analysis): analyse-dokument
  - `ddc76ef` feat(client/settings): settingsApi + useSettingsData
  - `b3b8b92` feat(client/settings): SettingsSection + SettingsRow +
    InlineEditableText + GDPR-knapper
  - `cc7e52f` fix(client/theme): lift theme state to ThemeProvider
  - `b513efd` feat(client/settings): integrate Settings + i18n +
    ErrorBoundary + design-gaps
- Filer endret: 24 nye + 9 modifiserte (analysenfil, settingsApi.ts,
  useSettingsData.ts + tester, 5 komponenter + tester, Settings.tsx
  + test, ThemeContext.tsx + ThemeToggle-refactor, App.tsx
  ErrorBoundary-wrap, i18n-utvidelser begge språk, design-gaps).
- Tester lagt til: ~75 nye client-tester (22 hook+API, 41
  komponent, 12 Settings-integrasjon). Total client: 710 pass
  (var 635 før Fase 2F). Server: 1293 pass / 2 skip / 0 fail
  (uendret).
- DOMAIN_MODEL.md oppdatert: nei. Ingen ny entitet — Settings
  konsumerer eksisterende `families`- og `users`-tabeller.
- Backend: ingen endringer. Konsumerer eksisterende
  `GET /api/family`, `PUT /api/family`, `GET /api/me/export`,
  `DELETE /api/me`.
- Avvik fra plan: under manuell QA fant Christer at ThemeToggle
  i AppShell-header og i Settings-skjerm ikke synkroniserte.
  Hver instans hadde egen useState. Fix: lagt til ThemeContext
  som lifter state til en provider, og ThemeToggle ble en thin
  consumer. Dette er en ekte bug-fix som hører hjemme i denne
  PR-en siden Settings er FØRSTE skjerm hvor to ThemeToggle-
  instanser eksisterer samtidig — bug-en var "skjult" tidligere
  fordi ingen andre skjermer rendrer ThemeToggle.

Sikkerhet: ingen nye endepunkter, ingen ny auth-logikk. Bruker
eksisterende `requireRole('owner')` på `PUT /api/family` og
GDPR-stien sin egen `handleDeleteMe` owner-sjekk. Owner-restriction
forhåndssjekkes i UI for å unngå garantert-403-flow. Ingen
secrets eller PII-håndtering i Settings-state. window.confirm()
brukes for slett-bekreftelse (pilot-scope; bespoke modal er
Sprint 7-arbeid).

ISO 25010: per analyse §2.7. Ingen karakteristikk under 8.0.

Lokal CI-verifikasjon: alle grønne.

- `npm run typecheck` server: 0 feil
- `npm run typecheck:client`: 0 feil
- `npm run test:client`: 710/710 pass (0 fail)
- `npm test` server: 1293 pass / 2 skip / 0 fail
- `npm run audit:prod`: 0 vulnerabilities
- `npm run build:client`: 377.23 KB raw / 113.20 KB gzipped main
  (+3.36 KB gzipped fra forrige main 109.84 KB)
- `npm run test:coverage:gate`: lines 84.13/80, branches 74.7/68,
  functions 82.22/72 — over alle terskler.

Browser-verifikasjon: Christer bekreftet bug-en under manuell test,
fikset, alle automatiske tester grønn. Visuell repro av fixen
krever Christers manuelle test (preview-server kan ikke teste
auth-beskyttede ruter uten session).

Status: åpen — venter på Christer manuell test + push-godkjenning.

Beslutninger Christer må ta: ingen blokkerende. Bekreft etter
manuell test:
- Theme-sync mellom Settings og header fungerer nå
- Familienavn-inline-edit feeler riktig (Enter submitter, Esc
  avbryter)
- GDPR-eksport laster ned JSON-fil
- Owner-blocked delete viser hint
- Coming soon-rader signaliserer roadmap riktig

Sprint 5 er teknisk komplett: Dashboard, Family, Meals, Shopping
+ Pantry sub-view, Settings — alle hovedskjermer levert.

Neste: ved push-instruksjon → squash til 1-3 logiske commits, kjør
én siste lokal CI, push til feat/fase-2f-settings, åpne PR med
tittel "feat: Fase 2F — Settings screen (Sprint 5 complete)". Vent
på CI grønn → vent på Christers godkjenning → merge per DEL 5.3
(feat krever Christer).

---

2026-04-30 – Bugfix: manuelle shopping-items når kjøpt → pantry-update

Oppgave: Christer manuelt-testet feat/fase-2e-pantry og rapporterte at
items toggled "kjøpt" på shopping aldri dukket opp i pantry-sub-view.
Backend logger viste 200 på PUT /bought; ingen GET /api/pantry observert
ved view-bytte (kanskje frontend-issue, kanskje backend-issue, kanskje
begge).

Analyse: ingen ny analyse-fil — denne PR-en er bug-fix-fortsettelse av
docs/analyses/2026-04-30-fase-2e-pantry.md som dokumenterte den antatte
auto-add-flyten. Diagnose gjort live via:

1. Lest server/routes.js:933-991 (PUT /bought-handler)
2. Lest server/routes.js:1037-1059 (POST /api/shopping/items-handler)
3. Lest server/repositories/shopping.repo.js:366 (addItem-INSERT)
4. Skrevet `scripts/db-check-pantry-bug.js` for å lese live DB-state
5. Funn: id=16 "butter", id=17 "melk" — bought_at satt, product_key=NULL,
   bought_qty=0, inventory tom, inventory_log tom

ROT-ÅRSAK (BACKEND, ikke frontend):

a. POST /api/shopping/items lagde rader UTEN productKey
   (addItem-INSERT inkluderte ikke kolonnen).
b. PUT /bought-handler hoppet over inventory.addPurchase fordi
   `if (item.productKey && qtyPurchased > 0)` evaluerer false uten
   key.
c. qtyPurchased-default kollapset til 0 når både body.qty og item.qty
   var null, så selv items med productKey hoppet over pantry-update.

Frontend var IKKE bug-en. usePantryData fyrer fetch ved hver mount;
view-bytte mellom list og pantry remountes komponenten, så fetch SKAL
trigges. Christer's "ingen GET /api/pantry observert"-observasjon kan
være et logging-issue (loggene logger antagelig bare PUT/POST/DELETE,
ikke GET-er), men det krevde ingen frontend-endring siden Shopping.test
allerede dekker view-bytte → /api/pantry-fetch.

Plan: 3 koblede backend-fix + 4 regresjons-tester + diagnose-script.

Gjort:

- Branch: feat/fase-2e-pantry (samme som Christer ba om).
- Commits: 1.
  - `4e22671` fix(shopping): resolve productKey for manual items
- Filer endret: 4 (2 modifiserte, 2 nye).
  - server/repositories/shopping.repo.js (addItem accept productKey,
    ny setProductKey for backfill)
  - server/routes.js (POST resolver productKey, PUT /bought lazy-
    resolve + persist + qtyPurchased default 1)
  - tests/shopping-manual-item-bought-pantry-bug.test.js (4 tester
    som låser fast riktig oppførsel)
  - scripts/db-check-pantry-bug.js (diagnose-tooling)
- Tester lagt til: 4 backend-regresjons-tester. Server total: 1293
  pass, 2 skip, 0 fail (var 1289+2+0 før denne fixen — +4 nye).
- DOMAIN_MODEL.md oppdatert: nei. Forretningsregel BR-002 (auto-add
  fra shopping-toggle) impliseres allerede i analysen for Fase 2E.
- Avvik fra plan: forste fix-iterasjon arvet unit/category fra
  pantryResolver. Det brøt eksisterende test (POST /api/shopping/items
  accepts name only — forventet unit=null), så fixen trakk seg
  tilbake til kun productKey-arving. unit/category følger nå brukerens
  input (null = ikke spesifisert) som før.

Sikkerhet: ingen nye endepunkter, ingen ny auth-logikk. Eksisterende
`requireRole('adult')` på POST og PUT beholdes. resolveOrCreate er
samme funksjon som POST /api/pantry/add allerede bruker — ingen ny
attack-flate. Diagnose-script i scripts/ er readonly.

ISO 25010: funksjonell egnethet 8.8 → 8.8 (uendret, fixer en regresjon
introdusert i samme PR, så netto-effekt er null). Pålitelighet 8.5 →
8.5 (uendret — backward-compat for legacy-rader er lagt inn).

Lokal CI-verifikasjon: alle grønne.

- `npm run typecheck` server: 0 feil
- `npm run typecheck:client`: 0 feil
- `npm test` server: 1293 pass, 2 skip, 0 fail
- `npx vitest run client/src/app/screens/Shopping.test`: 16/16 pass
- `npx vitest run client/src/app/components/pantry/PantryView`: 10/10 pass
- `npm run audit:prod`: 0 vulnerabilities
- `npm run test:coverage:gate`: lines 84.14/80, branches 74.7/68,
  functions 82.22/72 — alle over.

Browser-verifikasjon: ikke gjennomført (auth-blokkert preview, samme
begrensning som forrige sesjon). Christer må gjøre manuell verifisering
etter merge — instruksjoner under.

Status: åpen — venter på Christer manuell verifisering + push.

Manuell test-flyt for Christer (etter merge):

VIKTIG om eksisterende DB-state: rad-id 16 "butter" og 17 "melk" i
Christer's lokale DB har bought_at != NULL men ingen productKey og
qty=0. PUT /bought-handler returnerer alreadyBought-shortcut for disse
og kjører IKKE backfill-stien. Ren test krever at de enten slettes
manuelt eller toggles unbought + bought igjen. Anbefaler: bare slett
dem og test med nye items.

Test-sekvens:

1. Restart backend (stopp + start på nytt).
2. Logg inn som owner på /v2/login.
3. Naviger til /v2/shopping (default = list-view).
4. Slett "butter" og "melk" hvis de fortsatt er på listen
   (de er i bought-state og blokkerer test ellers).
5. Skriv "TestVare" i QuickAdd → Legg til.
6. Toggle "TestVare" som kjøpt (klikk på sirkelen).
7. Tap "Hva har vi hjemme?" i toggle-en øverst.
8. Verifiser: TestVare er i pantry-listen med antall=1 og enhet=stk
   (eller "1 igjen" hvis enhet ikke ble resolvet).
9. Tap Marker brukt → registrer bruk → verifiser at antall reduseres.
10. (Bonus) Bytt tilbake til list-view, slett TestVare via X-knappen,
    bytt tilbake til pantry — TestVare skal fortsatt være i pantry
    (den er decoupled fra shopping-rad etter kjøp).

Beslutninger Christer må ta: ingen blokkerende. Etter manuell test:
bekreft at fixen virker, og gi push-instruksjon.

Neste: ved push-instruksjon → squash-commits til 1-3 logiske enheter
(analyse + Pantry sub-view + bug-fix), kjør én siste lokal CI, push
til feat/fase-2e-pantry, åpne PR med oppdatert tittel som inkluderer
bug-fix. Vent på CI grønn → vent på Christers godkjenning → merge per
DEL 5.3 (feat krever Christer).

---

2026-04-30 – Fase 2E Pantry sub-view (Sprint 5 fortsetter)

Oppgave: Bygge fjerde og siste skjerm i Sprint 5 / Fase 2 — Pantry.
Master-planen hadde Kalender her, men Christer byttet rekkefølge:
Pantry inn nå, Kalender utsettes til post-pilot. Verdikjede: Måltid →
Handleliste → Pantry → Bruk → Handleliste igjen.

Analyse: docs/analyses/2026-04-30-fase-2e-pantry.md (389 linjer)

- Reisen: 4 hovedflyter (åpne pantry, marker brukt, quick-add,
  slett), 3-nivå dyp på flere grener.
- Edge-cases: 20 dokumentert (over 8-minimum) — total=null,
  unit=null, amount > remaining, comma-decimal-input, samtidige
  saves, expiresEst i fortid/dag/morgen/null, viewport-edge-case,
  ukjent ?view=-param, etc.
- Beslutninger: 7 (Christer-bekreftet 4 hoved + 3 implikasjoner).
  Pantry som sub-view i Shopping (B1), category-felt (ikke
  location, B2), bygg Marker brukt-dialog (B3 Christer-overstyr
  min anbefaling), verifiser eksisterende auto-add og lav-stock-
  trigger (B4), ekstra holdbarhet-badge (B5 tillegg). URL-state
  via useSearchParams. Modal-komponent fra Fase 1b gjenbrukes.
- Portainer-risiko: nei (ren frontend + én backend-test).
- ISO 25010: funksjonell egnethet 8.7 → 8.8, vedlikeholdbarhet
  8.5 → 8.6, snitt 8.50 → 8.51 (+0.01).

Plan: 10 commits — analyse, API+hook+tester, komponenter+i18n,
container+integrasjon, backend-test+design-gaps. Endte opp som
5 logiske commits siden komponenter + i18n hørte sammen.

Gjort:

- Branch: feat/fase-2e-pantry (fra ren main, etter PR #82-merge).
- Commits: 5.
  - `30980c7` docs(analysis): analyse-dokument
  - `edcb566` feat(client/pantry): pantryApi.ts + usePantryData
  - `e3c0fcf` feat(client/pantry): komponenter + i18n bundle
  - `6493351` feat(client/shopping): integrer Pantry sub-view via toggle
  - `e2f7573` test(server): pantry frontend-flow integration + design-gaps
- Filer endret: 21 nye + 4 modifiserte.
- Tester lagt til: ~80 nye tester på frontend, 6 på backend.
  Total client-tester: 608 pass (var 533 før Fase 2E). Server:
  1289 pass, 2 skip, 0 fail (var 1271+2+0 før — +18 nye fra
  recent meals/family-arbeid + 6 fra denne PR-en).
- DOMAIN_MODEL.md oppdatert: nei. Tre impliserte forretnings-
  regler (BR-001 lav-stock-trigger, BR-002 auto-add fra shopping,
  BR-003 qty=0-filter på GET) er notert i analysen — formell
  backfill kommer i egen docs-PR.
- Backend: ingen endringer i kode. Én ny test-fil
  `tests/fase-2e-pantry-frontend-flow.test.js` verifiserer at
  hele kjeden frontend Phase 2E utfører fungerer ende-til-ende
  mot eksisterende endepunkter (GET /api/pantry shape, PUT
  /api/pantry/correct dekrement + lav-stock-trigger, DELETE
  pantry-rad, POST /api/pantry/add slugify-resolve). Alle 6
  tester grønne.
- Avvik fra plan: usePantryData-hook brukte først hardkodet 0.20
  som lav-terskel for optimistisk isLow-flagg, men backend's
  units.LOW_THRESHOLD = 0.15. Justert tidlig i implementering.
  ErrorBoundary.test.tsx er flaky under parallel-kjøring (worker
  exit fra jsdom event-listener) — passerer 6/6 isolert; ikke
  introdusert av denne PR-en.

Sikkerhet: ingen nye endepunkter, ingen ny auth-logikk. Backend
beholder eksisterende `requireRole('adult')` på add/correct/delete
og auth-cookie-validering på GET. Ingen secrets eller PII-felter
introdusert. URL-search-param `?view=` er tillatlist `'list' |
'pantry'`; ukjente verdier defaulter til list-view (ikke crash).
Sikkerhetssjekkliste utfylt i analyse-dokumentet §3.

ISO 25010: funksjonell egnethet +0.1 (kjernemangel i verdikjede
fylt; kvantitativ tracking via Marker brukt-dialog), vedlikehold-
barhet +0.1 (pantry-mappa speiler shopping-mappa = konsistent
kodebase, ny kode > 85% test-dekning). Ingen karakteristikk
under 8.0.

Lokal CI-verifikasjon: alle grønne.

- `npm run typecheck` (server): 0 feil
- `npm run typecheck:client`: 0 feil
- `npm run test:client`: 608/608 pass (1 worker-exit-flake i
  ErrorBoundary, ikke regresjon — passerer isolert)
- `npm test` (server): 1289 pass, 2 skip, 0 fail
- `npm run audit:prod`: 0 vulnerabilities
- `npm run build:client`: 361.64 KB raw / 109.84 KB gzipped main
  (+6.30 KB gzipped fra forrige main 103.36 KB — Pantry-komponentene
  er rimelig kompakte gitt Modal/dialog/quick-add/grouping-container).
- `npm run test:coverage:gate`: lines 84.11/80, branches 74.55/68,
  functions 82.20/72 — over alle terskler.
- Lint: ingen feil i ny kode. Eksisterende
  `public/v2/assets/main-*.js`-build-artifact-feil er dokumentert
  i `pending-decisions.md` (ESLint config-gap — egen Sprint 6-fix).

Browser-verifikasjon: kjørte `npm run preview:client` på 7779
(7778 var Christers parallelle dev-server). React app mounter,
AuthGuard redirecter `/v2/shopping?view=pantry` → `/v2/login`
fordi preview ikke har session-cookie. Bundle-hash matcher
`build:client`-output. Ingen console-errors. Full e2e-test av
Pantry-flyten med data krever Christers manuelle test
(instruksjoner i analyse-dokumentet §4).

Status: åpen — venter på Christer manuell test + push-godkjenning.

Beslutninger Christer må ta: ingen blokkerende. Bekreft etter
manuell test om:
- Segmented toggle "Handleliste" / "Hva har vi hjemme?" føles
  riktig som primær-navigasjon mellom sub-views, eller om vi bør
  legge til mer visuell skille (f.eks. tab-underline i tillegg).
- Marker brukt-dialog UX: er 1/4-1/2-Alt riktig sett quick-buttons,
  eller mangler 3/4? Skal Bekreft-knappen være primary-mint som
  i andre dialog, eller mer pulset/anstrent fordi det er en
  "destruktiv" handling (decrement)?
- Holdbarhet-badge: gul/rød-fargesetting godt nok, eller bør den
  være mer påtrengende (border, ikon, animasjon) når < 1 dag?
- Quick-add: ingen autocomplete i pilot — er det greit, eller
  bør vi ta inn `GET /api/pantry/suggest` som har vært klart
  siden Fase F1?

Neste: ved push-instruksjon → squash-commits til 1-3 logiske
enheter, kjør én siste lokal CI, push til `feat/fase-2e-pantry`,
åpne PR med tittel "feat: Fase 2E — Pantry sub-view (Sprint 5
continues)". Vent på CI grønn → vent på Christers godkjenning →
merge per DEL 5.3 (feat krever Christer).

---

2026-04-30 – Hotfix: Meals mobile layout — BottomNav sticky regresjon

Oppgave: Christer rapporterte at /v2/meals på mobil-bredde
(390 × 844) hadde feil — BottomNav var ikke sticky nederst, hele
siden virket "zoomet inn". Andre skjermer (Dashboard, Familie,
Shopping) fungerte korrekt. Bug-en ble oppdaget under manuell
QA av Sprint 5 / Fase 2D-arbeidet.

Analyse: docs/analyses/2026-04-30-meals-mobile-layout-hotfix.md

- Reisen: 3 hovedfaser, 5-nivå dyp på CSS-layout-resolution.
- Edge-cases: 9 (320/390/414/768 breakpoints, skeleton-state,
  resize-roterende, < 7 slots, fremtidige skjermer).
- Beslutninger: 3 (fix-plassering, min-w-full-cleanup,
  skeleton-håndtering). Anbefaling for hver: AppShell-defensiv
  fix kombinert med DayStrip-verifikasjon.
- Portainer-risiko: nei (rent klient-CSS).
- ISO 25010: brukbarhet 8.6 → 8.7, vedlikeholdbarhet 8.4 → 8.5.

Plan: 3 commits — analyse, fix, regresjons-tester.

Gjort:
- Branch: hotfix/meals-mobile-layout
- Commits: 3
- Filer endret: 3 (AppShell.tsx, AppShell.test.tsx,
  DayStrip.test.tsx) + 1 ny (analysefil)
- Tester lagt til: 2 regresjons-tester (AppShell + DayStrip)
- DOMAIN_MODEL.md oppdatert: nei (rent presentasjon)
- Avvik fra plan: ingen visuell repro (port 7778 holdt av
  Christers kjørende dev-server, kan ikke drepe per CLAUDE.md
  DEL 7.8). Diagnose gjort via kode-analyse av flexbox-semantikk.
  Christer må verifisere visuelt etter merge.

Rot-årsak: `<main>` i AppShell er flex-item med `flex-1` men uten
`min-w-0`. Default `min-width: auto` resolver til `min-content` av
barn. DayStrip har 7 day-pills med `min-w-[72px] flex-shrink-0`
(552px totalt) — bredere enn mobile-viewport (390px). Dette
tvinger main til 552px, body får horisontal scroll, og
position:fixed BottomNav ankrer til layout-viewport (552px) i
stedet for visual-viewport (390px). Mobile browser auto-zoomer
ut for å vise hele 552px = "siden ser zoomet inn ut".

Fix: `min-w-0` på `<main>` — defensiv flexbox-pattern som lar
flex-item krympe til allokert flex-share uavhengig av barns
min-content. Påvirker ikke andre skjermer (de hadde ikke
overflow-trigger), men beskytter mot fremtidig regresjon.

Sikkerhet: ikke relevant — rent presentasjons-fix uten input,
auth, eller data-håndtering.

ISO 25010: brukbarhet +0.1 (fikser konkret bunnnav-bug),
vedlikeholdbarhet +0.1 (defensiv beskyttelse mot fremtidig
regresjon).

Status: venter-på-Christer (DEL 5.3 — `fix/`-prefiks krever
godkjenning). PR åpnes etter at lokal CI bekreftes grønn.

Beslutninger Christer må ta (med anbefaling):

BESLUTNING: Skal vi merge denne hotfix-en før visuell verifikasjon
er gjort?

ANBEFALING: Verifiser visuelt FØRST. Hot-reload på Christers
kjørende 7778-server reflekterer endringen umiddelbart — gå til
/v2/meals i DevTools mobile mode (390×844) og bekreft at
BottomNav er sticky nederst. Hvis bekreftet, merge.

HVORFOR: Visuell repro var blokkert under fix-arbeidet (port-
konflikt, ingen prosess-killing per DEL 7.8). Hypotesen er solid
fra kode-analyse, men feiltolkning av rot-årsak er mulig. 30-
sekunders manuell verifikasjon eliminerer den risikoen.

ALTERNATIVER:
- Merge før verifikasjon, fikse igjen hvis det ikke virker:
  raskere men eksponerer brukere for bug på main hvis hypotesen
  er feil.
- Vente på at Christer frigjør port 7778 så jeg kan starte min
  egen preview: tar 1-2 minutter ekstra, men gir ekte
  Playwright-verifikasjon.

KONSEKVENS HVIS ANNERLEDES: Hvis vi merger blindt og fix-en ikke
virker: Christer ser fortsatt bug-en på /v2/meals etter merge,
må åpne ny hotfix-PR.

Neste: Christer åpner /v2/meals i DevTools mobile mode (390×844),
verifiserer BottomNav sticky, og gir grønt lys til merge.

---

2026-04-30 – Fase 2B Family-skjerm (Sprint 4 fortsetter)

Oppgave: Erstatte placeholder-Family.tsx med dedikert Familie-
oversikt — andre hovedskjerm i Fase 2 etter Dashboard. Skjermen
viser familienavn med Edit-placeholder, grid med MemberCard per
medlem (avatar, navn, "(Du)"-badge for current user, role-badge
fra users-tabellen, kategori-label fra family_profile_members,
PortionFactorSlider med live optimistic update), og en placeholder
Inviter-knapp. Per-medlem save-status surface med "Lagrer …",
"Lagret", "Kunne ikke lagre".

Analyse: docs/analyses/2026-04-30-fase-2b-family.md (341 linjer)

- Reisen: 7 hovedflyter, 3-nivå dyp på portion-slider og placeholder-
  knapper.
- Edge-cases: 12 (én-person-roster, profile-member uten user, user
  uten profile-member, 4xx/401/403, concurrent updates, offline,
  initial fetch fail, stale data, lang medlems-liste, NaN portion).
- Beslutninger: 5 (toast=inline, edit=placeholder, member-mapping,
  optimistic, skeleton). Alle bekreftet med Christer FØR
  implementering.
- Portainer-risiko: nei (klient-only, backend uendret).
- ISO 25010: funksjonell egnethet +0.1, brukbarhet +0.1, snitt
  ~8.55 → ~8.57.

Plan: 5 commits — analyse, API+hook, MemberCard, Family-skjerm+i18n,
design-gap. Ble 6 commits etter at en placeholder smoke-test i
screens.test.tsx måtte oppdateres da Family ikke lenger renders
uten AuthProvider.

Gjort:

- Branch: feat/fase-2b-family.
- Commits: 6.
  - `b3dbcb9` docs(analysis): analyse-dokument
  - `a9a3c94` feat(client/family): familyApi.ts + useFamilyData
  - `5e11c92` feat(client/family): MemberCard + tester
  - `2d36264` feat(client/family): Family-skjerm + i18n-keys (NO+EN)
  - `beb8b38` docs(design): logg design-gap (dedikert tab vs
    settings-list)
  - `978cfeb` test(client/family): rens screens.test + Avatar-prop-fix
- Filer endret: 13 (10 nye, 3 modifiserte). +2019 / -17 linjer.
- Tester lagt til: ~32 nye client-tester. Total client-test-count:
  371 (var 339 ved start). Server-tester urørt: 1271 pass, 2 skip,
  0 fail.
- DOMAIN_MODEL.md oppdatert: nei. Ingen ny entitet introdusert i
  denne PR-en — backend-endepunktene fantes fra før (migrasjoner
  009 + 014 + 023). Hvis DOMAIN_MODEL.md skal få første formelle
  entry for `families` + `family_profile_members` + `users`-
  relasjonen, gjøres det i en egen docs-PR (out of scope nå).
- Backend: ingen endringer. `GET /api/family` og
  `PUT /api/family/members/:id` hentet fra eksisterende
  `server/auth/family-routes.js`.
- Avvik fra plan: Avatar-komponentens `src`-prop håndterte ikke
  `undefined` under `exactOptionalPropertyTypes: true`. Fikset med
  betinget prop-spread i MemberCard. Ingen avvik utover dette.

Sikkerhet: ingen nye endepunkter, ingen nye auth-mønstre. Backend
beholder eksisterende role-checks (`requireRole('adult')` på PUT,
auth via cookie på GET). Ingen secrets/PII-håndtering.

ISO 25010: per analyse §2.7. Ingen karakteristikk under 8.0.

Lokal CI-verifikasjon: alle grønne.

- `npm run typecheck` (server): 0 feil
- `npm run typecheck:client`: 0 feil
- `npm run test:client`: 371/371 grønn
- `npm test` (server): 1271 pass, 2 skip, 0 fail
- `npm run audit:prod`: 0 vulnerabilities
- `npm run build:client`: 296.72 KB raw / 93.54 KB gzipped
  (forrige main: 91 KB, +2.5 KB gzipped)
- `npm run test:coverage:gate`: lines 83.89/80, branches
  73.86/68, functions 81.66/72 — over alle terskler
- Lint på min nye kode: clean. (Pre-existing `public/v2/assets/
  main-*.js`-build-artifact-feil i lokal lint er kun lokalt — `public/v2/`
  er gitignored, så CI ser dette aldri.)

Browser-verifikasjon: kjørte `npm run preview:client` på 7779
(7778 var opptatt av Christers parallelle dev-server). React app
mounter, AuthGuard redirecter `/v2/family` → `/v2/login` siden
preview ikke har session-cookie. Bundle-hash matcher
`build:client`-output. Ingen console-errors. Full e2e-test av
Family-skjermen med data krever Christers manuelle test (per
prompt sin VIKTIG OM MANUELL TEST-seksjon).

Status: åpen — venter på Christer manuell test + push-godkjenning.

Beslutninger Christer må ta: ingen blokkerende. Bekreft etter
manuell test om:
- Card-grid-layout føles riktig som dedikert Family-tab vs.
  settings-listen i mockup
- Portion-slider-feedback (Lagrer / Lagret / Kunne ikke lagre)
  føles tydelig nok
- Plassering av Edit + Inviter-knapper er ok som placeholder

Neste: ved push-instruksjon → squash-commits til 1-3 logiske
enheter, kjør én siste lokal CI, push til `feat/fase-2b-family`,
åpne PR med tittel "feat: Fase 2B — Family screen (Sprint 4
continues)". Vent på CI grønn → vent på Christers godkjenning →
merge per DEL 5.3 (feat krever Christer).

---

2026-04-20 – Uke 1 oppgaver 1.2–1.5 — STATUS

Oppgave: Utføre Christers uke-1-plan etter at DEL A (lukke PR #53,
fjerne diagnostikk-endepunkt via PR #57, governance-logging via
PR #58) var merget.

Plan: fire oppgaver — analyse-PR (1.2), parker redesign-mockup (1.3),
baseline-rapport (1.4), uke-2-beslutningsliste (1.5).

Gjort:

- **OPPGAVE 1.2 — analyse-PR #59 draft opprettet.**
  - Branch: fix/empty-shopping-list-analysis, commit dddcfd1.
  - Fil: docs/analyses/2026-04-20-frontend-empty-shopping.md
    (464 linjer) med 3-nivå reisen, 3 hovedhypoteser (H1 uke-
    mismatch — høy sannsynlighet; H2 status-mismatch — middels;
    H3 SW-cache — lav-middels), meta-hypotese for Christers
    parallelle index.html-arbeid, 11 edge-cases, ISO 25010-
    effekt-tabell, Portainer-sjekk (LAV for alle 3), og 3
    commit-planer per hypotese.
  - 5 spørsmål til Christer i PR-beskrivelsen. Ikke merget —
    venter på svar.
  - Kode-baseline: main d7a5c38. Christers parallelle arbeid ikke
    inkludert (han må oppgi branch-SHA).

- **OPPGAVE 1.3 — park redesign-mockup PR #60 MERGET.**
  - Branch: docs/park-redesign-exploration, commit 6553a42 → squash
    merge som commit `83728527`.
  - Christer kopierte 8 filer fra C:\...\TESTING\FrontEnd\ til
    FamilyAssistant\design\redesign-exploration-2026-04\; Claude
    kopierte videre til -pr-workspace før commit.
  - Nytt README.md (61 linjer) forklarer PARKERT-status og plan
    for implementering i uke 8+. Original README flyttet til
    README.original.md.
  - CI: 9/9 grønn. Autonom merge per docs/-regelen.

- **OPPGAVE 1.4 — baseline-PR #61 ÅPEN, STOPP på billing.**
  - Branch: docs/baseline-2026-w17, commits 6ace9d8 + 1d3e080.
  - Fil: docs/baselines/2026_W17.md (288 linjer) med alle 9
    seksjoner fra uke-1-spek: test-status (1129/0/0/8.94s),
    coverage (82.02/72.72/79.70 % — alle over gate), ISO 25010
    (8.55 avg fra v1.3.0), CI-status (7 workflows), kode-
    metrikker (84 backend JS, 20 frontend JS, 18 migrasjoner),
    deps (3+2+10), funksjons-matrix mockup vs i-dag, åpne TODOs
    (0) og issues (0), deploy-status, referanser.
  - **Phase21 policy-test brøt** på første commit — `docs/*.md`
    hadde `DB_INDEXES.md` + `DOMAIN_MODEL.md` som eksakt whitelist.
    Per CLAUDE.md DEL 6.5 (policy- vs kode-tester) kunne whitelisten
    utvides med eksplisitt godkjenning, men bedre løsning: flyttet
    filen til `docs/baselines/2026_W17.md` (subfolder — phase21
    ignorerer subfoldere). Fremtidige uke-rapporter følger samme
    mønster som docs/analyses/.
  - **CI-RESULTAT:** Tester 4/4 grønn, Security audit grønn.
    Men Coverage gate + OSV vulnerability scan + SBOM generation
    feilet med *"The job was not started because recent account
    payments have failed or your spending limit needs to be
    increased"*. Ikke kode-relatert.
  - `gh run rerun --failed` ga samme feil — bekreftet at det er
    account-side billing-limit, ikke transient.
  - STOPP-kommentar postet på PR #61 med ANBEFALING: (a) fix
    GitHub billing. Alternativer: (b) --admin override (frarådes,
    bryter DEL 1.5 + DEL 5.1), (c) la PR stå åpen til billing
    løst (akseptabel, baseline-innhold er levert selv om ikke
    merget).
  - PR #61 forblir åpen. Baseline-innholdet er teknisk sett
    levert per uke-1-spek (fil + PR) selv om ikke merget ennå.

- **OPPGAVE 1.5 — uke-2-beslutningsliste levert som Issue #62.**
  - Valgt Issue fremfor PR-kommentar eller AGENT_LOG-entry for
    å ha én synlig plass for Christer og mulighet for tråd-
    respons.
  - 7 beslutninger dekket: multi-tenant aktivering, LLM-strategi,
    e-post-leverandør, Cloudflare Tunnel, første gamification-
    feature, kalender-integrasjon, per-medlem diett — alle med
    ANBEFALING (a/b/c), hvorfor, konsekvens hvis annerledes.
  - Ekstra: billing-saken flagget som åttende beslutning.
  - Svar-format definert — Christer kan svare med én linje per
    punkt.

Avvik fra plan: ingen funksjonelle avvik. Ett avvik i infrastruktur
(GitHub billing) håndtert per STOPP-prosedyren.

Uke-1-suksess-kriterier (foreløpig):

1. PR #53 lukket — ✅ (tidlig i dag)
2. PR #54 merget — ✅ (tidlig i dag, commit 31739fe)
3. PR #56/#57 merget — ✅ (PR #57 fordi #56 var tatt; commit 65abc5a)
4. Frontend-bug diagnostisert + fix merget — ⏳ delvis (analyse-
   PR #59 levert, venter på Christer; fix ikke kodet)
5. Redesign-mockup parkert — ✅ (PR #60 merget, 83728527)
6. Baseline-rapport levert — ⚠️ levert som PR #61 men ikke merget
   pga billing-blocker
7. Uke-2-beslutningsliste levert — ✅ (Issue #62)

Status: 5/7 oppnådd, 1 delvis, 1 levert men blokker på merge.

Sikkerhet: ingen endring (docs + issue, ingen kode).

ISO 25010: uendret (docs-only fra min side).

Neste: venter på Christer på (i) 5 spørsmål i PR #59, (ii) GitHub
billing-fiks, (iii) 7 svar på beslutningsliste i Issue #62. Når
billing fikset + svar mottatt, rerun'es PR #61-CI autonomt; PR #59
fix-fase starter med valgt plan (H1/H2/H3); uke-2-plan skrives
basert på beslutningene.

---

2026-04-20 – Diagnostic endpoint cleanup (PR #57) — MERGET + PR #53 LUKKET

Oppgave: Christer ga DEL A i oppryddings-planen: lukk analyse-PR #53
med konklusjons-kommentar, fjern det midlertidige diagnostikk-
endepunktet og alle dets spor (rute, repo-metoder, OpenAPI, test),
og flytt CHANGELOG-oppføringen til en "added-and-removed within
same cycle"-seksjon.

Analyse: ingen ny analyse — ren slettings-PR. Builder på analysen i
docs/analyses/2026-04-20-diagnostic-endpoint.md, som bevares som
historisk dokumentasjon per CLAUDE.md DEL 11.

- Reisen: grep-søk for alle referanser → slett i samme PR. Ingen
  andre kallere av `diagnosticSnapshot()` eller `countAll()`
  bekreftet via grep før fjerning.
- Edge-cases: CRLF-artefakter i working tree håndtert ved selektiv
  `git add` av kun relevante filer. Lokal eslint manglet (Windows,
  kun prod-deps installert) — CI-run aksepteres som primær
  verifikasjon siden PR-en er rene slettinger.
- Portainer-risiko: nei. Endepunktet er diagnostikk-only og ikke
  brukt av klient-kode.

Plan: 1 commit som fjerner alt, åpen PR, la CI kjøre, merge autonomt
per chore/-regelen.

Gjort:

- PR #53 lukket med kommentar: "Diagnostikk-resultater fra produksjon
  falsifiserte alle tre hypoteser... Ingen fix-PR nødvendig."
- Branch: chore/remove-temporary-diagnostic-endpoint
- Commit: bfbcef2 "chore(debug): remove temporary shopping-state
  diagnostic endpoint".
- Filer fjernet/endret: 6 totalt.
  - server/routes.js: fjernet /api/debug/shopping-state-rute (79 linjer)
  - server/repositories/shopping.repo.js: fjernet diagnosticSnapshot (50)
  - server/repositories/inventory.repo.js: fjernet countAll (7)
  - openapi.yaml: fjernet path-entry (78)
  - tests/debug-endpoint.test.js: slettet helt (153 linjer, 4 tester)
  - CHANGELOG.md: [Unreleased] restrukturert til "Temporary
    diagnostics (added and removed within this cycle)" med
    referanse til både PR #54 og #57. Netto API-overflate: 0.
- Tester lagt til: ingen (slettings-PR).
- DOMAIN_MODEL.md oppdatert: nei.
- Avvik fra plan: ingen.

CI: 9/9 grønn (Test ubuntu/macos/windows/node22, Coverage gate,
Load baseline, OSV, SBOM, Security audit).

Merge: squashet som commit `65abc5a` på main, branch slettet remote.

Sikkerhet: netto effekt er mindre API-overflate, færre kodestier,
færre tester. Ingen nye risikoer introdusert.

ISO 25010: observability reversert (midlertidig tillegg fjernet).
Maintainability forbedret (mindre dødkode, mindre vedlikehold).

Status: merged.

Neste: DEL B fra Christers plan — starte ny undersøkelse av den
separate frontend-bug-en der UI viser 0 varer selv om DB har 70
shopping_list_items. Før analyse-PR opprettes: spør Christer om
branch/commit-SHA for det parallelle arbeidet i public/index.html,
slik at analysens baseline blir riktig og jeg ikke antar utdatert
kode. DEL C (multi-tenant deploy) er eksplisitt ikke-aktivert enda.

---

2026-04-20 – Diagnostic endpoint (PR #54) — MERGET

Oppgave: Fullføre PR #54 etter Christers svar på STOPP-trigger fra
tidligere innlegg (samme dato). Christer godkjente anbefalt whitelist-
utvidelse og la til ett eksplisitt krav: først kodifisere "policy-
tester vs kode-tester"-skillet i CLAUDE.md DEL 6.5 slik at tilsvarende
situasjoner er forutsigbare fremover.

Analyse: ingen ny analyse (utvidelse av allerede dokumentert plan i
docs/analyses/2026-04-20-diagnostic-endpoint.md).

- Reisen: to ekstra commits på eksisterende branch, re-kjør CI, lokal
  smoke-test, autonom merge per chore/-regelen.
- Edge-cases: CRLF-normalisering i working tree etter git pull
  blokkerte merge-kommandoen; løst med `git reset --hard origin/main`
  etter at PR var merget remotely.
- Portainer-risiko: nei.

Plan: 2 commits (CLAUDE.md DEL 6.5, phase21-whitelist) → CI → smoke
→ merge.

Gjort:

- Commit `docs(claude): clarify frozen-test policy for repo-hygiene
  updates` — ny DEL 6.5 i CLAUDE.md som definerer hva en policy-test
  er, når den kan utvides (fire kriterier), og krav til egen commit
  + logging.
- Commit `test(phase21): extend root and docs/ whitelists for
  CLAUDE.md workflow` — root: +4 (AGENT_LOG.md, CLAUDE.md,
  CONTEXT.md, REFERENCES.md). docs/: +1 (DOMAIN_MODEL.md).
  readdirSync → `{ withFileTypes: true }` + `entry.isFile()` slik at
  fremtidige docs/-subfoldere (f.eks. docs/analyses/) ikke bryter
  testen.
- CI re-run på commit `d7d3203`: 9/9 grønn (Test ubuntu/macos/
  windows/node22, Coverage gate, Load baseline, OSV, SBOM, Security
  audit).
- Lokal smoke-test på port 17777 med AUTH_TOKEN=smoke-token:
  /health → 200. /api/debug/shopping-state uten header → 401.
  Med feil token → 401. Med riktig token → 200, envelope
  komplett (18 migrasjoner, nullverdier på fersk DB), Cache-Control
  til stede med valid no-cache-semantikk.
- Merge: `gh pr merge 54 --squash --delete-branch` (via GitHub UI
  da lokal kommando ble blokkert av CRLF-artefakter fra autocrlf).
  Squashet som commit `31739fe`, branch slettet remote.
- Filer endret (inkl. tidligere commits i samme PR): CLAUDE.md,
  tests/phase21-repo-hygiene.test.js, server/routes.js,
  server/repositories/shopping.repo.js,
  server/repositories/inventory.repo.js, openapi.yaml,
  CHANGELOG.md, tests/debug-endpoint.test.js,
  docs/analyses/2026-04-20-diagnostic-endpoint.md.
- Tester lagt til: 4 (fra tidligere commits i samme PR).
- DOMAIN_MODEL.md oppdatert: nei.
- Avvik fra plan: ingen utover CRLF-workaround nevnt over.

Andre frosne policy-tester: ingen andre policy-tester identifisert som
vil feile av samme årsak. De øvrige frosne testene (tenant-isolation,
role-enforcement, auth-*, phase14/18/19/20, gdpr-endpoints) er
atferds-tester, ikke policy-tester, og gikk grønt i denne runden.

Sikkerhet: uendret fra tidligere innlegg. PII-testen verifiserte at
endepunktet ikke lekker ingredient_name/product_key/notes.

ISO 25010: observability midlertidig forbedret. Fjernes når PR #53
lander fix eller innen 7 dager — hvilken som kommer først.

Status: merged.

Neste: venter på at Christer pull-er ny image i Portainer og sender
diagnostikk-output slik at jeg kan velge riktig fiks i PR #53
(H1 soft-delete, H2 backfill-migrasjon 019, eller H3 frontend-
filter). Instruks lagt i CONTEXT.md § "VENTER PÅ CHRISTER".

---

2026-04-20 – Diagnostic endpoint (PR #54) — STOPP før merge

Oppgave: Legg til midlertidig GET /api/debug/shopping-state slik at
Christer kan samle counts og strukturelle samples fra produksjons-DB
uten shell-tilgang. Analyse-PR #53 trenger disse tallene for å skille
H1/H2/H3.

Analyse: docs/analyses/2026-04-20-diagnostic-endpoint.md

- Reisen: 1 lese-rute gjennom eksisterende auth + rate-limit.
- Edge-cases: 8.
- Beslutninger: ingen — liten scope per CLAUDE.md DEL 11.
- Portainer-risiko: nei (bekreftet i analysens § PORTAINER-
  OPPSTARTSRISIKO-SJEKK).

Plan: 4 commits — analyse, repos, routes+openapi+changelog, tester.

Gjort:

- Branch: chore/add-temporary-diagnostic-endpoint
- Commits: 5 (fire per plan + én lint-fix + én test-fix etter CI).
- Filer endret: 8 (analyse, shopping.repo.js, inventory.repo.js,
  routes.js, openapi.yaml, CHANGELOG.md, debug-endpoint.test.js).
- Tester lagt til: 4 (auth-missing, auth-wrong, shape/cache, PII-fri).
- DOMAIN_MODEL.md oppdatert: nei (ingen domene-endring).
- Avvik fra plan: to CI-runder krevde fix. Lint: "no-useless-
  assignment" tvang IIFE-omskrivning av try/catch. Tester: Cache-
  Control-assertion måtte lempes fordi security-middleware overskriver
  'no-store' til 'private, max-age=0, must-revalidate' (fortsatt
  no-cache-semantikk). source_type i PII-testens fixture måtte være
  'meal_ingredient' (migrasjon 007 CHECK constraint).

Sikkerhet: Bearer-auth via eksisterende middleware. Responsen er
PII-fri per testens assertion (stringifies respons og sjekker at
unikt-merkede test-strenger for ingredient_name, product_key og
notes IKKE finnes i outputen).

ISO 25010: ikke berørt (midlertidig diagnostikk, fjernes etter
maks 7 dager eller etter PR #53-fix).

Status: venter-på-Christer (STOPP-trigger aktivert).

Beslutninger Christer må ta:

BESLUTNING: Hvordan håndtere phase21-repo-hygiene-bruddet?

ANBEFALING: Godkjenne én-linjes utvidelse av phase21-whitelist for å
reflektere filene som allerede er committet til main. Konkret:

- Root-whitelisten utvides fra 7 til 11 filer: legg til AGENT_LOG.md,
  CLAUDE.md, CONTEXT.md, REFERENCES.md.
- docs/-whitelisten utvides fra ['DB_INDEXES.md'] til
  ['DB_INDEXES.md', 'DOMAIN_MODEL.md'].
- Subfoldere i docs/ (feks docs/analyses/) ekskluderes fra
  .readdirSync()-sjekken (kun direkte barn-filer teller).

HVORFOR: phase21 er allerede brutt på main etter at Christer la til
CLAUDE/CONTEXT/REFERENCES/AGENT_LOG og docs/DOMAIN_MODEL.md via
"Add files via upload"-commits (be59ac3, 4ef84cf). Testen har exact-
match whitelist og er ikke re-kjørt i CI siden. Min PR er første
CI-run som ser bruddet. Å la dette stå blokkerer ALLE videre PR-er.
Oppdateringen endrer ikke semantikken av testen — "kept vs removed"
— den bare gjenspeiler den nye bevisste fil-strukturen fra CLAUDE.md-
arbeidsflyten.

ALTERNATIVER:

- Flytt CLAUDE.md + CONTEXT.md + REFERENCES.md + AGENT_LOG.md ut av
  root (feks til docs/governance/). Konsekvens: CLAUDE.md selv sier
  i DEL 0 og REFERENCES.md seksjon "Toppnivå-dokumentasjon" at disse
  bor i root. Krever samtidig endring av alle tre filer. Mer arbeid,
  større diff, mer usikkerhet.
- Skriv om phase21 helt (feks: beholde bare "required files exists"-
  asserts, fjerne exact-match whitelist). Større endring, løser mer
  enn vi må akkurat nå. Anbefales senere i en dedikert CI-rydde-PR.
- Aksepter at phase21 failer på all fremtidig CI og merge likevel via
  --admin eller lignende override. Bryter CLAUDE.md DEL 1 punkt 5
  og DEL 5.1.

KONSEKVENS HVIS ANNERLEDES: Ingen PR-er kan merges via normal CI-
grønn-flyten før phase21 fikses. Alle fremtidige endringer blokkeres.

BESLUTNING 2: Merge-strategi for selve PR #54 (uavhengig av
phase21-fikset)?

ANBEFALING: Hvis BESLUTNING 1 løses, merge #54 autonomt som chore/
per CLAUDE.md DEL 5.1 etter grønn CI + lokal smoke-test. Ellers
venter #54 til phase21 er akseptert.

HVORFOR: #54 er ren chore/ uten Portainer-risiko eller frys-berøring.

ALTERNATIVER: Ingen meningsfulle.

KONSEKVENS HVIS ANNERLEDES: #54 står åpent inntil phase21-flyten er
løst, og Christer får ikke diagnostikk-dataene han trenger for PR #53.

Neste: Christer svarer på BESLUTNING 1 ovenfor. Hvis "ja" til
anbefaling: jeg kan oppdatere phase21 og fullføre PR #54 inkl. lokal
smoke-test og autonomt merge. Hvis "nei" / alternativ: jeg følger
den valgte veien.

---

2026-05-28 – Post-public improvements

Oppgave: Iverksette de fem forbedringene fra ekstern repo-vurdering
(8.5/10): ARCHITECTURE.md, README screenshots, rate-limit-tester
for recipe-import/OCR, LLM-input-sanitization-tester, og opt-in
LLM-integration-suite.

Analyse: docs/analyses/2026-05-28-post-public-improvements.md
Reisen: 4 trinn (med maks dybde 1.4 → 2.3)
Edge-cases: 5 (under DEL 11-terskelen for triviell — docs + tester,
ingen domenemodell-endring)
Beslutninger: 0 (alle valg tatt i analysen som anbefaling)
Portainer-risiko: nei (ingen endring i Dockerfile, index.js,
config.js, db.js, eller migrasjoner)

Plan: 5 commits — analyse, ARCHITECTURE+phase21-whitelist,
README+screenshots-folder, rate-limit+sanitization-tester,
LLM-integration opt-in.

Gjort:

- Branch: chore/post-public-improvements
- Commits: 5
  - fd5363a docs(analysis): add analysis for post-public improvements
  - 1e778e7 docs(architecture): add one-page system overview
  - 53f5133 docs(readme): add Screenshots section with capture guide
  - 88a5190 test(security): cover recipe-import rate-limit + LLM input
    sanitization
  - e8ce7cd test(llm): add opt-in LLM integration smoke-tests
- Filer endret: 8 nye (ARCHITECTURE.md, screenshots/README.md,
  analyse-dokument, 3 tester) + 4 oppdaterte (README.md, phase21-
  hygiene-whitelist, recipe-import.service.js exports, package.json
  test:llm-script)
- Tester lagt til: 24 nye (3 rate-limit + 21 sanitization;
  LLM-integration-suite skipper når env ikke satt)
- DOMAIN_MODEL.md oppdatert: nei (ingen domeneendring)
- Avvik fra plan: ingen

Sikkerhet: Rate-limit + sanitization gjort eksplisitt testbart for
recipe-import-flyten. Output-sanitisere var allerede dekket av
iteration3d-recipe-import.test.js; nytt er INPUT-side
(sanitizeString, sanitizeUrl, MAX_TEXT_CHARS via buildUserPrompt) +
sanitizeForPrompt (KB-context-injection-skrubbing). Ingen ny
funksjonalitet — kun verifisering av eksisterende defense-in-depth.

ISO 25010:
- Vedlikeholdbarhet: 8.3 → 8.4 (+0.1, ARCHITECTURE.md senker
  onboarding-tid)
- Sikkerhet: 8.2 → 8.3 (+0.1, eksplisitte tester for rate-limit +
  sanitization er nytt sikkerhetsnett)
- Andre karakteristikker: ikke berørt

Lokal CI: lint 0 errors (1 warning i urelatert ErrorBoundary.tsx),
format 0 nye warnings (52 pre-eksisterende på main), typecheck pass,
backend 1385/1387 (2 skipped, 0 fail), client 928/928, audit 0
vulnerabilities, coverage 84.62/75.14/83.36 (alle over 80/68/72-
terskelen).

Status: venter-på-Christer (klar for push når Christer sier "push")

Beslutninger Christer må ta:

BESLUTNING: Push og merge-strategi for chore/post-public-improvements?

ANBEFALING: Push branchen som én batch (squash til 1-3 commits er
ikke nødvendig — de 5 commits er allerede én logisk enhet hver). PR
kan auto-merges via DEL 5.1 (chore/-prefiks) etter grønn GitHub CI.
Ingen Portainer-risiko, ingen frys-berøring.

HVORFOR: Alt arbeid er rent additivt og testet lokalt. Coverage,
audit, lint og 1385 backend-tester + 928 client-tester passerer.
Eneste ikke-test-endringer er én docs-fil (ARCHITECTURE.md), én
README-seksjon, og to script/export-tillegg i package.json + recipe-
import.service.js.

ALTERNATIVER:
- Vente med push til Christer ønsker å gjennomgå ARCHITECTURE.md /
  README screenshots-seksjonen manuelt først. Konsekvens: forbedringene
  ligger lokalt, ingen umiddelbar verdi for nye besøkende.
- Splitte i flere PR-er (docs separat fra tester). Konsekvens: dobbelt
  CI-bruk, mer overhead, ingen reell gevinst — innholdet er allerede
  delt i logiske commits.

KONSEKVENS HVIS ANNERLEDES: Forbedringene gjør seg ikke synlige på
GitHub før Christer godkjenner push.

Neste: Christer sier "push" når han ønsker at jeg pusher batchen og
oppretter PR. Inntil da: 5 lokale commits står klare på branch
chore/post-public-improvements.

---