# Batch 2 — uke 2-arbeid (B2/B7 docs/feat + PR #59 fix + Portainer deploy-gate)

**Status (før push):** 13 commits + 4 merge-commits på `batch-2` samle-
branchen, 0 pushet. Venter på Christers push-klarsignal (eksakt frase
"nå pusher vi batch 2").

**Branch ved push:** `batch-2` (tuppen).

**Merge-strategi (besluttet av Christer 2026-04-22):** **én PR,
"Create a merge commit".** Alle commits bevares på main; intern
merge-topologi via 4 merge-commits (én per logisk enhet) er bevart
så selektiv revert av én enhet = revert av den merge-commiten. Ikke
squash (ødelegger topologien), ikke rebase (ødelegger merge-commits).

---

## Hvorfor denne batchen eksisterer

Fire parallelle arbeidsenheter ble utviklet lokalt etter at batch 1
(PR #64) ble merget 2026-04-22:

1. **Portainer SESSION_SECRET deploy-gate** (docs-only):
   Container-containere som startes fra distroless-imaget uten eksisterende
   `bootstrap.json` krasjer på SESSION_SECRET-validering. Christer bevisst
   valgte å IKKE sette den manuelt i Portainer — målet er å teste realistisk
   fresh-install-flyt. Dokumentasjon med 3 mitigering-alternativer for uke 4.

2. **B2 LLM felles Ollama** (docs-only, Issue #62 B2):
   Dokumenterer gap mellom eksisterende `llm_configs`-skjema (per-familie
   override) og dagens chat-kode (global `OLLAMA_HOST`). Ingen kode-endring
   i denne omgang — dokumentasjonen fanger dagens stand og beskriver flyten
   for aktivering når kapasitet krever det.

3. **PR #59 fix** — tom handleliste UI-bug:
   Rotårsak sporet til Service Worker VERSION som ikke ble bumpet mellom PR
   #33 (phase 22) og PR #46, slik at cached `shopping.js` ble uten fix
   for shoppinglist-rendering. 3-lags defensiv fix: SW VERSION-bump (cache
   invalidering), `typeof`-guards rundt `load*`-kall, preload av
   `loadShopping()` i init.js.

4. **B7 per-medlem diett** (Issue #62 B7):
   Full backend-stack: migrasjon 020, repo-utvidelser, tre-lags filter-
   arkitektur per D7 (hard allergi, soft dislike, hard diet med override),
   2 nye endpoints, 5 oppgraderte call sites, 88 nye tester. UI-arbeid
   eksplisitt utsatt til uke 3 (dokumentert som blokker før ekstern
   invitasjon).

Alle fire er stabile individuelt og kunne teoretisk gått som separate PR-er,
men tre av dem er *docs-only* eller *tests-green-at-HEAD*, og den fjerde
(B7) har ingen runtime-effekt uten UI. Batching reduserer CI-forbruk til
én merge-trigger i stedet for fire, og git-historikken viser tydelig at de
fire enhetene landet sammen uke 2.

---

## Hva inngår — tematisk gruppering

### Gruppe A — Portainer SESSION_SECRET deploy-gate (1 commit + 1 merge)

Branch: `docs/known-issues-portainer-deploy-gate`. Docs-only.

| Commit | Innhold |
|---|---|
| `2912a96` | `docs/known-issues/portainer-session-secret-deploy-gate.md` (197 linjer). Symptom (container crash ved fresh install), rotårsak (self-heal krever eksisterende bootstrap.json; fresh installs har ingen ennå), hvorfor ingen manuell workaround (testet realistisk deploy-flyt), midlertidig workflow (lokal Node), 3 mitigering-alternativer (a/b/c). |
| `8c079e2` | **Merge-commit** for selektiv revert. |

**Effekt:** 0 runtime-endring. Ren dokumentasjon så operatør kan finne
feilen raskt neste gang (og uke 4-fiksen har klart scope-beskrivelse).

### Gruppe B — B2 LLM felles Ollama docs (1 commit + 1 merge)

Branch: `docs/b2-llm-ollama-shared`. Docs-only.

| Commit | Innhold |
|---|---|
| `e6a743c` | `RUNBOOK.md` §13 ny seksjon "LLM-backend — felles Ollama + per-familie-override" (200 linjer, 7 underseksjoner): §13.1 nåværende chat bruker global OLLAMA_HOST (ikke per-familie config), §13.2 operator-flyt via `/api/family/llm`, §13.3 fallback-scenarier, §13.4 ressurs-budsjett for RPi5 8GB, §13.5 LLM cache, §13.6 global backend-endringer, §13.7 empirisk verifikasjons-TODO (krever at Portainer-container er oppe). |
| `50ee78e` | **Merge-commit** for selektiv revert. |

**Effekt:** 0 runtime-endring. Gir Christer / fremtidig Claude klart
kart for hva `llm_configs`-tabellen faktisk gjør og hva som må endres
når/hvis per-familie-LLM skal aktiveres.

### Gruppe C — PR #59 frontend empty-cart fix (2 commits + 1 merge)

Branch: `fix/empty-shopping-list-analysis`. Minst runtime-kritiske enhet.

| Commit | Innhold |
|---|---|
| `17be935` | **Analyse** (`docs/analyses/2026-04-22-frontend-empty-shopping-resolved.md`). Diagnostisk journal: første hypotese feilet, SW-cache-sporet ledet til rotårsak (VERSION = `v1.7-phase22` siden PR #33; phase 22 + 14 endringer har sneket seg forbi uten cache-invalidering). |
| `1674e59` | **3-lags defensiv fix.** SW VERSION bumpet til `v1.8-phase23` (fanger dagens cache). `tabs.js`: `typeof X === 'function'`-guards rundt `loadToday`, `loadMeals`, `loadShopping`, `loadChores` (defensivt — beskytter mot fremtidige modul-sammenslåinger). `init.js`: preload-kall til `loadShopping()` etter boot så første klikk er varm. Ny `tests/frontend-shopping-tab-switch.test.js` (7 asserts via vm-basert mini-DOM — ingen jsdom-avhengighet). `docs/workflow/known-issues.md` (subfolder — phase21-kompatibel). |
| `d4757d7` | **Merge-commit** for selektiv revert. |

**Effekt:** `v1.8-phase23`-SW invaliderer eksisterende klient-cache ved
neste besøk. Bruker vil se oppdatert `shopping.js` og handlekurv
rendres. Deploy-trygg (ingen backend-endring).

### Gruppe D — B7 per-medlem diett backend (5 commits + 1 merge)

Branch: `feat/per-member-diet`. Størst enhet. Issue #62 B7 + D7 (tre-lags
filter besluttet 2026-04-22).

| Commit | Innhold |
|---|---|
| `97676e7` | **Pre-kode analyse** (`docs/analyses/2026-04-22-per-member-diet.md`, 339 linjer). Kartlegging av nåværende allergy-filter-flyt + 5 call sites, eksisterende `family_profile_members`-skjema (migrasjon 014), 6 design-spørsmål (D1-D6) som Christer svarte på i chat, Portainer-risiko-vurdering, test-impact-mapping. |
| `7a48801` | **Commit 1/3 — migrasjon 020 + repo.** `server/migrations/020_member_diets.sql` — 4 `ADD COLUMN`: `allergies` (NULL = arv), `dislikes` (NULL = arv), `diet_tags` (NOT NULL DEFAULT `'[]'`, ingen arv), `custom_diet_note` (valgfri fritekst). `family.repo.js` utvidet med `getMemberDiet`/`updateMemberDiet` + 13-verdi enum-validering per D3 (`diabetiker-vennlig` utelatt — diabetes krever næringsstoffinfo og per-bruker-grenseverdier, utsatt til fase 2). 22 nye repo-tester inkl. tenant-isolation. |
| `5d1e074` | **Commit 2/3 — tre-lags filter-arkitektur.** `allergy-filter.service.js` utvidet med `checkRecipeForFamily` (per-medlem `blockedFor[]`). Nye filer: `dislike-filter.service.js` (SOFT, kun warnings), `diet-filter.service.js` (HARD med `ignoreDietTags`-override), `recipe-filter.service.js` (fasade som orchestrerer alle tre). 32 filter-layer tester + 10 backward-compat regresjonstester. Legacy `checkRecipe`/`annotateRecipe` byte-kompatibelt bevart. |
| `66beb93` | **Commit 3/3 — endpoints + call-site-migrering.** Nye ruter: `GET`/`PUT /api/family/members/:id/diet` (adult-only PUT, children read-only). 5 oppgraderte call sites (4 i `routes.js` + `isRecipeSafe` i `meal-planning.service.js`). `?ignoreDietTags=true` query-param for D7-override på recipe-listen. Responser inkluderer BÅDE legacy-felter (`safeForProfile`, `blockedIngredients`) OG nye `perMember` + `hiddenByAllergy`/`hiddenByDiet`/`shownWithDislikeWarning`. 17 endpoint-tester inkl. end-to-end D7-override-verifikasjon. |
| `08fd6d2` | **Pending-decisions.md** oppdatert med B7-backend-status og UI-TODO (5 påkrevd UI-elementer før ekstern familie-invitasjon). |
| `a9d5694` | **Merge-commit** for selektiv revert. |

**Effekt:** Backend er klar, men UI ikke ennå. `UPDATE /api/family/members/:id/diet`
kan kalles manuelt (curl/dev-tools) for å registrere en pilot-families
diett-data. Filter returnerer tre-lags respons ved hvert `/api/recipes`-
kall. Override via `?ignoreDietTags=true` virker end-to-end. Per-medlem-
integrering i `meal-planning` er *eksplisitt utsatt* (bevarer dagens
oppførsel for å unngå regresjon mid-B7).

---

## Testing

```
Lokal CI full pyramide på batch-2-tuppen — grønn på alle tre nivåer.

Tier 1 (instant):   lint + format:check + typecheck      — 0 feil
Tier 2 (fast):      1240 tester, 1238 pass, 0 fail       — 2 skipped
                    2 skipped (win32-plattform)
Tier 3 (full):      coverage 82.96 % lines / 73.21 %     — alle over gate
                    branches / 80.44 % functions
                    npm audit --omit=dev                 — 0 vulnerabilities
```

**Testvekst:** 1158 (batch 1) → 1179 (frontend-tab-switch test) → 1221
(B7 commits 1-2) → 1240 (B7 commit 3). 82 nye tester totalt i batchen.

**Coverage:** 82.03/72.96/79.82 → 82.96/73.21/80.44.
Linjer +0.93, branches +0.25, functions +0.62.

**Frosne kode-tester (DEL 6.1) kjører fortsatt grønt:** `tenant-isolation`,
`role-enforcement`, `auth-*`, `gdpr-endpoints`, `phase14/18/19/20`,
`phase21-repo-hygiene`, `m-week9-safety` (legacy allergy-filter), alle
nye tester. Ingen pre-eksisterende tester ble endret.

**Ikke-kjørt på GitHub CI enda:** alle tester over er lokale. GitHub CI
kjører ved push per lokal-først-arbeidsflyten (CLAUDE.md DEL 5.2).

---

## Portainer-risiko: **LAV** samlet — med ett spesifikt forbehold

Ingen endringer i auth-middleware, session-lag, config-validering eller
bootstrap-flyt. Ingen interaksjon med SESSION_SECRET deploy-gate (som
forblir uløst til uke 4 per design).

| Gruppe | Risiko | Begrunnelse |
|---|---|---|
| A — Portainer docs | **NULL** | Ren tekst, ikke én kodelinje endret. |
| B — B2 LLM docs | **NULL** | Ren tekst, ikke én kodelinje endret. |
| C — PR #59 fix | **LAV** | Frontend-endringer: SW + 2 public/js-filer + 1 test. Ingen backend. `v1.8-phase23`-cache-bump betyr bruker vil laste ned oppdatert shopping.js første gang de åpner siden etter deploy. |
| D — B7 backend | **LAV** | Migrasjon = ren `ADD COLUMN` (idempotent, rollback via `DROP COLUMN`). Filter-services = pure functions, ingen DB-writes. Endpoints = additive. Legacy response-shape byte-kompatibel (`safeForProfile`/`blockedIngredients`/`checkedAgainst` uendret). |

**Forbehold for gruppe D:** Hvis en familie har eksisterende
`family_profile.allergies`-data OG Gruppe D merges uten at UI kommer,
vil Gruppe D fortsette å respektere familie-nivå-allergier akkurat som
før (ingen per-medlem-data = fallback-arv aktiv). Det er verifisert av
`allergy-filter-backward-compat.test.js`. Ingen adferd-endring
uten UI-arbeidet i uke 3.

**Rollback-plan samlet:** 4 merge-commits kan reverteres individuelt
(se neste seksjon). Ingen interaksjoner mellom gruppene forhindrer
dette.

---

## Selektivt revert-strategi

Merge-topologien er eksplisitt designet for selektiv revert:

| Hvis problem i | Revert merge-commit | Effekt |
|---|---|---|
| **B7 backend** (gruppe D) | `git revert -m 1 a9d5694` | Fjerner migrasjon 020, filter-services, nye endpoints. Pre-B7 allergy-filter fortsetter å kjøre. Migrasjonen er kjørt — kjør `DROP COLUMN` manuelt på RPi hvis kolonnene skal vekk (merk: nye deploys vil re-kjøre migrasjon 020 siden `IF NOT EXISTS`/SQLite-semantikk). |
| **PR #59 fix** (gruppe C) | `git revert -m 1 d4757d7` | Rulle tilbake SW VERSION til `v1.7-phase22`. OBS: klient-cachen fra oppdatert deploy vil fortsatt ha `v1.8`-versjonen og ikke hente nytt før ny bump. Rollback er derfor *server-side synlig* men klientene må force-reload. |
| **B2 LLM docs** (gruppe B) | `git revert -m 1 50ee78e` | Fjerner RUNBOOK §13. Ren docs-revert, 0 runtime-effekt. |
| **Portainer docs** (gruppe A) | `git revert -m 1 8c079e2` | Fjerner `docs/known-issues/`-dok. Ren docs-revert, 0 runtime-effekt. |

**Parametere:** `-m 1` sier "behold mainline-parenten (main)". Uten den
ville git ikke vite hvilken side av merge-en som skal bevares.

**Rekkefølge ved kaskade-revert:** Hvis flere enheter må reverteres,
gå i omvendt-chronological order (nyeste først) for å minimere konflikt-
risiko: D → C → B → A.

---

## Hva som IKKE er i denne batchen

| Arbeid | Status | Hvorfor ikke i batch 2 |
|---|---|---|
| **B7 UI** | Ikke startet | Eksplisitt dokumentert som pending (docs/workflow/pending-decisions.md). Må leveres i uke 3 FØR ekstern familie-invitasjon. Per-medlem-form, D7 override-toggle, blokkert-for-visualisering, meal-planning per-medlem-integrasjon. |
| **Diabetes-støtte** | Design pending (fase 2, tidligst uke 6-10) | Krever næringsstoffinfo per oppskrift + per-bruker karbo/sukker-grenser + warning-basert filter-lag. `diabetiker-vennlig`-enum er bevisst IKKE med i D3-listen (13 verdier). Egen seksjon i `docs/workflow/pending-decisions.md`. |
| **B7 meal-planning per-medlem-integrasjon** | Kode lagret allergy-only | `isRecipeSafe` bruker ny filter-service, men sender ikke `members[]`. Intensjonal minimum-endring for å unngå adferdsdrift i meal-planning mid-B7. UI-arbeidet i uke 3 gjør dette tryggere å aktivere samtidig. |
| **Portainer SESSION_SECRET fix** | Utsatt til uke 4 | Dokumentert (gruppe A). 3 mitigering-alternativer skissert. Beslutning på valg utsatt til Christer har tid / bestemt tilnærming. |
| **B3 Resend** | Utsatt til uke 3-4 | Per Issue #62 B3. |
| **B4 Cloudflare Tunnel** | Utsatt til uke 4-5 | Per Issue #62 B4. |
| **B6 Google Calendar** | Utsatt til uke 4-6 | Avhenger av B4. |
| **GitHub Actions-CI-verifikasjon** | Ikke kjørt | Venter på push — per lokal-først-arbeidsflyt (CLAUDE.md DEL 5.2). Lokal CI er grønn på alle 3 tiers. |

---

## Dependency-kjede og merge-strategi

**Besluttet:** én PR, "Create a merge commit" (ikke squash). Samle-
branchen `batch-2` har 4 merge-commits som viser hvordan de fire
enhetene ble kombinert.

Intern merge-topologi:

```
main ─┬─ [8c079e2] ── Gruppe A (docs/known-issues-portainer-deploy-gate)
      │     │ 2912a96 docs(known-issues): Portainer SESSION_SECRET deploy-gate
      │     ↓
      ├─ [50ee78e] ── Gruppe B (docs/b2-llm-ollama-shared)
      │     │ e6a743c docs(runbook): B2 LLM felles Ollama
      │     ↓
      ├─ [d4757d7] ── Gruppe C (fix/empty-shopping-list-analysis)
      │     │ 17be935 analysis
      │     │ 1674e59 fix(frontend): 3-lags defensiv fix
      │     ↓
      └─ [a9d5694] ── Gruppe D (feat/per-member-diet)
            │ 97676e7 docs(analysis): pre-code analysis
            │ 7a48801 feat(migration): schema + repo (1/3)
            │ 5d1e074 feat(filters): three-tier filter (2/3)
            │ 66beb93 feat(api): endpoints + call-sites (3/3)
            │ 08fd6d2 docs(pending): UI-TODO
            ↓
          batch-2 (HEAD)
```

**Rekkefølgen valgt slik:** fra minst risikabel (docs) til mest
funksjonelt omfattende (B7 backend). Gir en ren progressiv build-up
i git log ved lineær lesning.

**Funksjonelle avhengigheter mellom gruppene:** **ingen.** Hver gruppe
kan teoretisk landes uten de andre (verifisert: konflikt-fri merge i
alle fire tilfeller, ingen felles filer rørt av flere grupper).
Gruppe A + B + C er docs/frontend-only; gruppe D er backend-only.

### Fallback: splitt i fire PR-er

Forkastet i denne runden (Christer-beslutning 2026-04-22), men dokumentert
for referanse:

```
1. Gruppe A: docs/known-issues-portainer-deploy-gate → main  (1 commit)
2. Gruppe B: docs/b2-llm-ollama-shared                → main  (1 commit)
3. Gruppe C: fix/empty-shopping-list-analysis         → main  (2 commits)
4. Gruppe D: feat/per-member-diet                     → main  (5 commits)
```

**Kostnad ved split:** 4 PR-er, 4 CI-runs (4× tier 1+2+3 på GitHub
Actions), 4 merge-godkjenninger. **Gevinst:** audit-trail per gruppe +
mindre kognitiv belastning å reviewe én gruppe av gangen. **Vurderes
for batch 3+** hvis de logiske skillene er like rene.

Ved split ville rekkefølgen vært identisk (A → B → C → D) siden A+B
er docs-only og C+D er funksjonelt uavhengige.

---

## Filer endret (samlet i batch-2)

```
Backend:
  server/migrations/020_member_diets.sql                    +31   / 0
  server/repositories/family.repo.js                        +186  / -3   (B7)
  server/services/allergy-filter.service.js                 +128  / -2   (B7)
  server/services/dislike-filter.service.js                 +122  / 0    (NY)
  server/services/diet-filter.service.js                    +393  / 0    (NY)
  server/services/recipe-filter.service.js                  +158  / 0    (NY)
  server/services/meal-planning.service.js                  +13   / -5   (B7)
  server/routes.js                                          +154  / -25  (B7)
  server/auth/family-routes.js                              +60   / 0    (B7)

Frontend:
  public/sw.js                                              +6    / -3   (C)
  public/js/tabs.js                                         +10   / -6   (C)
  public/js/init.js                                         +14   / 0    (C)

Tests (82 nye asserts across 5 new files + 1 regression-guard):
  tests/per-member-diet.repo.test.js                        +352  / 0    (NY)
  tests/per-member-filter-layers.test.js                    +397  / 0    (NY)
  tests/allergy-filter-backward-compat.test.js              +169  / 0    (NY)
  tests/per-member-diet-endpoints.test.js                   +357  / 0    (NY)
  tests/frontend-shopping-tab-switch.test.js                +269  / 0    (NY)

Docs:
  docs/known-issues/portainer-session-secret-deploy-gate.md +197  / 0    (NY, A)
  RUNBOOK.md                                                +200  / 0    (B)
  docs/analyses/2026-04-22-frontend-empty-shopping-resolved.md +202 / 0  (NY, C)
  docs/analyses/2026-04-20-frontend-empty-shopping.md       +161  / 0    (NY, C)
  docs/workflow/known-issues.md                             +48   / 0    (NY, C)
  docs/analyses/2026-04-22-per-member-diet.md               +339  / 0    (NY, D)
  docs/workflow/pending-decisions.md                        +52   / -2   (D)
  docs/workflow/batch-2-pr-description.md                   +341  / 0    (NY, denne fila)
```

Omlag `+3800 / -46` på batch-2. Hoveddelene er B7 (code + tests) og
dokumentasjon (analyser + docs).

---

## Anbefaling

**Én PR, "Create a merge commit".** Alle 13 arbeidscommits + 4 merge-
commits bevart på main. Det bevarer selektiv-revert-muligheten (én merge-
commit per enhet) og gjør batch-strukturen synlig i git log for alltid.

Ikke squash (mister topologi → selektiv revert umulig).
Ikke rebase (mister merge-commits → mister enhets-attribusjon).

PR-reviewere kan gå gjennom hver gruppe isolert via merge-commit-
parents, eller lese batchen holistisk via denne beskrivelsen.

---

## Smoke-test etter merge (RPi deploy)

1. **Pre-pull:** ingen migrasjon-risiko siden 020 er ren `ADD COLUMN`.
   Backup av `bootstrap.json` anbefalt som alltid.
2. **Under pull:** verifiser migrasjon 020 applikeres i oppstartlogg
   (`[MIGRATE ...] ✓ Applikert 020_member_diets.sql`).
3. **Verifiser backend:**
   - `GET /api/family/members` returnerer medlemmer med nye felter (`allergies: null`, `dietTags: []`).
   - `GET /api/recipes` returnerer både legacy (`safeForProfile`) og nye (`perMember`, `hiddenByAllergy`) felter.
   - `GET /api/recipes?ignoreDietTags=true` har `filter.ignoreDietTags: true`.
4. **Verifiser frontend:**
   - Last inn appen (hard reload eller ny fane). Service Worker skal registrere `v1.8-phase23`.
   - Klikk gjennom Handleliste-tab — varer skal vises (fix for PR #59).
   - Ingen console-errors fra `tabs.js` eller `init.js`.
5. **Rollback hvis problem:** se § selektiv revert-strategi. Verstefalls:
   revert alle 4 merge-commits i omvendt rekkefølge (D → C → B → A).
