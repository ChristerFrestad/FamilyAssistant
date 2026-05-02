# Multi-tenant data isolation audit — pre-pilot foundation

**Dato:** 2026-05-02
**Branch:** `chore/multi-tenant-audit-and-fix`
**Type:** Audit-rapport (ingen kode-endringer ennå)
**Driver:** Bug oppdaget under PR #89 manuell test — ny familie (Frestad,
family_id=3) har null seed-data og kan derfor ikke bruke recipe-picker.
Christer eskalerte til full multi-tenant-audit før fix.

---

## TL;DR

Runtime-isolasjonen er **solid**. Alle 98+ HTTP-endepunkter scoper
korrekt til kallende familie via `getFamilyId()`. Eksisterende suite
(33 negative tester) passerer. **Ingen aktive cross-tenant-lekkasjer.**

Den virkelige bugen er **på seed-tid, ikke på request-tid**: hele
seed-katalogen blir låst til familie 1 ved første server-oppstart.
Nye familier som onboarder etterpå starter helt tomme.

---

## 1a. Database-skjema-audit

### Tabeller med `family_id`-kolonne (per-family-data)

| Tabell | NOT NULL | DEFAULT | FK ON DELETE | Indeks | Status |
|---|---|---|---|---|---|
| ai_chat_history | ✓ | – | CASCADE | ✓ | OK |
| audit_log | ✓ | **1** | – | ✓ | M2 |
| calendar_events | ✓ | **1** | – | ✓ | M2 |
| chore_completions | ✓ | – | CASCADE | ✓ | OK |
| chore_schedules | ✓ | **1** | – | ✓ | M2 |
| chores | ✓ | **1** | – | ✓ | M2 |
| consumable_log | ✓ | **1** | – | ✓ | M2 |
| consumables | ✓ | **1** | – | ✓ | M2 |
| family_invitations | ✓ | – | CASCADE | ✓ | OK |
| family_llm_config | – | – | CASCADE | – | M3 |
| family_profile | – | – | CASCADE | – | M3 |
| family_profile_members | ✓ | – | CASCADE | ✓ | OK |
| feedback | ✓ | – | CASCADE | ✓ | OK |
| filter_usage | ✓ | – | CASCADE | autoindex | OK |
| inventory | ✓ | – | CASCADE | ✓ | OK |
| inventory_log | ✓ | **1** | – | ✓ | M2 |
| knowledge_base | ✓ | **1** | – | ✓ | M2 |
| llm_audit | ✓ | **1** | – | ✓ | M2 |
| meal_history | ✓ | **1** | – | ✓ | M2 |
| meal_plans | ✓ | – | CASCADE | ✓ | OK |
| notifications | ✓ | **1** | – | ✓ | M2 |
| product_shelf_observations | ✓ | – | – | ✓ | M3 |
| purchase_log | ✓ | **1** | – | ✓ | M2 |
| receipt_items | ✓ | **1** | – | ✓ | M2 |
| receipts | ✓ | – | CASCADE | ✓ | OK |
| recipe_feedback | ✓ | – | CASCADE | ✓ | OK |
| recipe_ingredients | ✓ | **1** | – | ✓ | M2 |
| recipe_sources | ✓ | – | CASCADE | ✓ | OK |
| recipes | ✓ | **1** | – | ✓ | M2 |
| shopping_extras | ✓ | **1** | – | ✓ | M2 |
| shopping_list_items | ✓ | **1** | – | ✓ | M2 |
| shopping_lists | ✓ | – | CASCADE | ✓ | OK |
| sunday_drafts | ✓ | – | CASCADE | autoindex | OK |
| users | – | – | SET NULL | ✓ | OK |

**M2** (HIGH-issue): `DEFAULT 1` står igjen + ingen FK CASCADE → en
INSERT uten eksplisitt `family_id` lander på family 1 silently, og en
sletting av family 1 etterlater orphan-rader. Migrasjon 016 var
ment å rydde dette, men dekker bare 4 tabeller.

**M3** (MEDIUM): mangler `family_id`-indeks (kun 3 lave-volum-tabeller).

### Tabeller UTEN `family_id` (globale eller via parent FK)

- `families` (root)
- `kassal_cache`, `kassal_products`, `products`, `price_history`,
  `price_references`, `product_resolutions` — global produktkatalog,
  bevisst delt
- `llm_cache` — global LLM-cache; cache-nøkler embedder kun generisk
  data (recipe-name, ingredient-tekst). Ingen aktiv lekkasje, men
  fremtidige cache-nøkler som embedder per-family-data ville
  introdusere tenant-cross-talk
- `knowledge_base_fts*`, `schema_migrations`, `state_snapshots` —
  metadata
- `magic_link_tokens`, `sessions` — scoped via user_id

---

## 1b. Seed-data-audit

`seedIfEmpty(repos)` kjøres ved server-startup i `server/index.js:103`,
**uten aktiv family-context**. Konsekvens: alle interne
`getFamilyId()`-kall returnerer `LEGACY_FAMILY_ID = 1`. Alt seeded
data lander på family 1 og blir aldri lagt til andre familier.

Verifisert via direkte DB-spørring (Christer's prod-DB):

| Tabell | family 1 (Default) | family 3 (Frestad) |
|---|---|---|
| recipes | 36 | **0** |
| recipe_ingredients | 203 | **0** |
| chores | 13 | **0** |
| chore_schedules | 11 | **0** |
| consumables | 39 | **0** |
| family_profile | 1 | **0** |
| meal_plans | 7 | 7 (orphan refs) |

**Orphan-rader:** `meal_plans` for family 3 (id 8-14) refererer
`recipe_id` 1-7 — disse tilhører family 1 og er ikke synlige for
family 3 via `recipes.getById()`. Dette er rot-årsaken til
"Planlegg middag"-bugen Christer rapporterte.

**ensureCurrentWeek-bug:** `seed.defaultMealPlan` har hardkodede
`recipe_id`-verdier 1..7. Dette fungerer kun hvis recipes har
auto-incrementede ID-er 1..7 for den kallende familien — som de
KUN har for family 1. Selv etter per-family-seed av recipes vil
nye familier få andre auto-IDs (37+), så `defaultMealPlan` må
oppdateres til å slå opp ID per recipe-name eller dropp hardkode.

---

## 1c. Endpoint-audit

**Ingen aktive lekkasjer.** Detaljert subagent-rapport:

- 98+ ruter i `server/routes.js` + 31 i auth/family/feedback/gdpr-routes
- Alle authenticated-requests wrappet i `runWithFamily(ctx.familyId)`
  via `server/http/server.js:206-210`
- Alle 26 per-family-repos bruker `getFamilyId()` for å binde
  `WHERE family_id = ?` på alle SELECT/INSERT/UPDATE/DELETE
- Globale tabeller (products, price_*, llm_cache, kassal_*) er
  bevisst delte og inneholder ikke PII
- Auth/family/feedback/GDPR-ruter som bypass-er repo-laget passerer
  `family_id` eksplisitt fra `ctx.user.family_id` eller
  `ctx.familyId`

**LOCAL_USER bearer-fallback:** når `AUTH_TOKEN` er satt og brukes,
kjører requesten med family_id=1. Ikke et issue for cookie-basert
multi-tenant-deploy, men relevant hvis bearer-token noensinne brukes
i prod uten ny user-mapping.

**LEGACY_FAMILY_ID = 1 fallback** i `family-context.js:36-42`: returnerer
1 stille hvis en repo kalles utenfor `runWithFamily`. Aktivt fanger
opp seed-feilen; samtidig skjuler det bugs. Filen har en TODO om å
endre til kasting senere.

---

## 1d. Cross-tenant-lekkasje-tester (eksisterende suite)

`tests/security-multi-tenant-isolation.test.js` (13 tester) +
`tests/tenant-isolation.test.js` (15 tester) +
`tests/phase14-sw-multitenant.test.js` (5 tester) = **33 tester
passerer**. Dekker:

- Family A kan ikke se/mutere Family B's family-info, members, recipes,
  shopping list, chores, notifications, pantry, member-diet
- Cookie-mangel returnerer 401
- Service-worker-cache er tenant-aware
- Repo-kall uten family-context faller tilbake til family 1 (eksplisitt
  test som låser nåværende fallback-oppførsel)

---

## 1e. Onboarding-flyt-audit

`POST /api/auth/onboarding/complete`
(`server/auth/routes.js:240-340`) gjør i én transaksjon:

1. `repos.family.createFamily(familyName, userId)` → INSERT families
2. `repos.family.addMember(newFamily.id, ...)` → INSERT
   family_profile_members
3. `repos.auth.setFamily(userId, newFamily.id, 'owner', member.id)`
   + UPDATE users (name, portion_factor, onboarding_completed=1)
4. INSERT audit_log med `family_id = newFamily.id` eksplisitt

**Ingen seed av:**

- `recipes` + `recipe_ingredients` (36 + 203 rader)
- `chores` + `chore_schedules` (13 + 11 rader)
- `consumables` (39 rader)
- `family_profile` (parent-row — kun `_members` opprettes)
- `meal_plans` (de blir lazy-seedet via `ensureCurrentWeek` på
  første meal-route, men med hardkodede recipe_id 1..7 = orphan)

---

## Identifiserte issues — prioritert

### CRITICAL (blokker pilot)

**C1. Onboarding mangler per-family seed**
- Symptom: ny familie har null recipes/chores/consumables.
  "Planlegg middag" viser tom liste; chores-skjerm tom; pantry-
  shopping-flyten har ingen prefylte forslag.
- Root: `seedIfEmpty` kjører kun ved startup uten family-context.
  `onboardingCompleteHandler` seeder ikke per-family.
- Fix: utvid onboarding-transaksjonen med en `seedFamilyDefaults`-
  funksjon som inserter recipes, chores, consumables, family_profile
  for den nye family_id-en.

**C2. `defaultMealPlan` hardkoder recipe_id 1..7**
- Symptom: `ensureCurrentWeek` for family 2+ skriver meal_plans-
  rader som peker på recipes som ikke tilhører dem.
- Root: `server/seed.js:1497-1505` bruker recipe_id-tall.
- Fix: enten drop default-mealplan helt for nye familier, eller
  gjør oppslag per recipe-name innenfor family-konteksten ved seeding.

**C3. Christer's prod-DB har orphan-data**
- 36 recipes mangler for family_id=3, og 7 meal_plans er orphans.
- Fix: en-shot script `scripts/repair-family-recipes.js` som ved
  første kjøring etter C1+C2-fix kopierer family 1's seed inn i
  family 3 og repointer meal_plans. Idempotent.

### HIGH

**H1. `DEFAULT 1` på family_id-kolonner (16 tabeller)**
- Symptom: enhver INSERT som glemmer `family_id` lander på family 1.
  Skjuler bugs og lekker data.
- Fix: migrasjon 024 som dropper `DEFAULT 1` på de gjenstående
  tabellene (recipes, recipe_ingredients, chores, chore_schedules,
  consumables, consumable_log, audit_log, calendar_events,
  inventory_log, knowledge_base, llm_audit, meal_history,
  notifications, purchase_log, receipt_items, shopping_extras,
  shopping_list_items). **NB: dette er en migration → DEL 2.4 STOPP-
  trigger; må eksplisitt godkjennes i denne PR-en**.
- Risk: aktivt avhengig kode må sjekkes — alle INSERT-er må allerede
  binde family_id. Subagent-audit konkluderte at det gjør de.

**H2. Manglende FK ON DELETE CASCADE på 16 tabeller**
- Symptom: sletter du en familie, får du orphan-rader.
- Pilot-relevans: lav, da vi ikke sletter familier i pilot.
  Likevel et lekkasje-vindu hvis en familie noensinne slettes uten
  manuell rydding.
- Fix: same migration som H1 kan legge til FK CASCADE.

**H3. Onboarding ikke dekket av eksisterende isolasjons-tester**
- Symptom: ingen test verifiserer at en nyopprettet familie får
  korrekt seed-data.
- Fix: ny test som `tests/onboarding-seed.test.js` som starter
  test-server, kjører POST /api/auth/onboarding/complete (med
  mocked auth-context), verifiserer at family_profile +
  recipes + chores + consumables-rader ble opprettet for den
  nye family_id-en.

### MEDIUM

**M1. LEGACY_FAMILY_ID-fallback skjuler stray-callers**
- TODO i koden — bytt til throw når NODE_ENV !== 'test'.
- Fix: en-linje endring i `family-context.js:36-42`.
- Kan gjøres etter pilot. Lav risiko hvis ledsages av audit-pass.

**M2. `DEFAULT 1`-kolonnene (samme som H1)**

**M3. `family_llm_config`, `family_profile`, `product_shelf_observations`
mangler family_id-indeks**
- Lav volum, lav risiko. Kan utsettes.

**M4. LLM-cache-key-pattern dokumentasjon**
- Subagent-anbefaling: dokumentér i en ADR at LLM-cache-nøkler
  ikke skal embedde per-family-data. Forebygger fremtidige bugs.

### LOW

**L1. Legacy `users.family_id ON DELETE SET NULL`**
- Hvis en familie slettes, blir users orphan men beholdes. Det er
  bevisst — bruker kan re-attache. OK for pilot.

**L2. Bearer-token LOCAL_USER fallback hardkoder family_id=1**
- Ikke et issue for cookie-basert pilot-deploy. Dokumentér.

---

## Anbefalt scope for FIX-PR-en

Tre lag, kan håndteres separat eller samlet:

### Lag A — Pilot-blokker (må gjøres før pilot kan testes)

- Implementer `seedFamilyDefaults(repos, familyId)`-helper
- Utvid `POST /api/auth/onboarding/complete` til å kalle den
- Fix `defaultMealPlan` slik at den bruker recipe-name-oppslag i
  stedet for hardkodede ID-er
- En-shot repair-script for Christer's family_id=3
- Nye tester:
  - `tests/onboarding-seed.test.js` (positive)
  - `tests/repair-family-recipes.test.js` (script idempotency)

**Estimert arbeid:** 4-6 timer
**Påvirkning:** Du kan teste smart-kobling-flyten ende-til-ende
etter denne. Pilot-onboarding fungerer.

### Lag B — Defense-in-depth (sterkt anbefalt før pilot)

- Migrasjon 024: drop `DEFAULT 1` + add FK CASCADE på de 16 tabellene
- Add `markStrayCaller`-aktivering i `family-context.js`
  (samme effekt — fanger nye stray-callers)
- Add ADR-doc om LLM-cache-key-policy

**Estimert arbeid:** 3-4 timer + Christer-godkjenning av migration
(DEL 2.4 STOPP-trigger)
**Påvirkning:** Definitiv arkitekturell hardening. Forsikrer at
fremtidige bugs ikke kan lande på family 1 ved et uhell.

### Lag C — Hygiene (kan utsettes)

- M3-indekser
- LEGACY_FAMILY_ID throw-i-prod (M1)
- L1, L2 dokumentasjon

**Estimert arbeid:** 1-2 timer
**Påvirkning:** Liten, men ryddig pre-pilot.

---

## Min anbefaling

**Lag A + Lag B i denne PR-en.**

Begrunnelse:
- Lag A blokkerer pilot (kan ikke onboarde nye familier meningsfullt).
- Lag B er den fundamentalle DEL 6 multi-tenant-isolasjon-garantien
  Christer pekte på i prompt: "Multi-tenant-isolasjon er fundamentalt
  for GDPR-compliance og personvern-løfter." `DEFAULT 1` på 16
  tabeller er en latent risiko som bør fjernes nå.
- Lag B krever en migration → DEL 2.4 godkjenning. Best å gjøre i
  samme PR mens scope er klart.
- Lag C kan utsettes til pre-deploy-cleanup-sesjonen (CLAUDE.md DEL 7.7).

**Konsekvens hvis annerledes:**

- Bare Lag A: pilot fungerer, men en latent footgun ligger igjen.
  Neste utvikler som glemmer family_id i en INSERT lander stille på
  family 1 — vanskelig å fange i review.
- Lag A + B + C: lengre PR, mer review-flate, men mest komplett.
  Foreslås kun hvis pilot-tidsplan tillater.

---

## STOPP — venter på Christer's scope-beslutning

Ingen kode endret. Dette dokumentet committet på
`chore/multi-tenant-audit-and-fix`.

Diagnose-scriptene `diag-recipes.js`, `diag-schema-audit.js`,
`diag-seed-scope.js` ligger i repo-roten — ikke committed til
git, kan slettes når audit godkjent.
