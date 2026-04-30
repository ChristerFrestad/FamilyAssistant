# Fase 2C — Meals-skjerm (Sprint 4 avsluttes)

**Dato:** 2026-04-30
**Forfatter:** Claude (Sonnet/Opus)
**Branch:** `feat/fase-2c-meals` (åpnes etter Christer-godkjenning)
**Estimat:** 1 dag (avhengig av valgt scope, se §6)

---

## 1. Oppgave

Erstatte `client/src/app/screens/Meals.tsx`-placeholderen med en
dedikert ukesmeny-skjerm — siste hovedskjerm i Fase 2 / Sprint 4.
Etter Dashboard (PR #78) og Familie (PR #79) er dette tredje og
siste store skjerm før Sprint 5 starter på Shopping/Calendar.

Mockup-referanse: `design/2026-04-redesign/source/Familieassistenten.html`,
`WeekMenu()`-komponenten linje 696-802.

---

## 2. Reisen

### 2.1 Bruker åpner Måltider-skjerm

1. Bruker klikker "Måltider" i nav (BottomNav mobile / SideNav desktop)
   1.1. Router navigerer til `/v2/meals`
   1.2. AuthGuard verifiserer cookie → forbi
   1.3. AppShell renderer Meals
2. Meals mounter
   2.1. `useMealsData()` starter to parallelle fetch:
        2.1.1. `GET /api/meals/current` → ukens 7 dager + recipe per dag
        2.1.2. `GET /api/family` → portionSum (for ingrediens-skalering)
   2.2. Skjerm viser skeleton-strip (7 day-pills) + skeleton hero-card
3. Begge svarer
   3.1. Hvis begge OK → state = `data`, render full-skjerm
   3.2. Hvis én/begge feiler → state = `error`, vis retry-card
   3.3. Hvis 401 fra /api/family eller /api/meals → AuthGuard fanger
        på neste navigasjon; vi rapporterer som `error` for nå

### 2.2 Bruker velger en dag

1. Default-valgt: **i dag** (computed fra Date.now() → ISO mandag=0..søndag=6)
2. Bruker klikker en day-pill → `setSelectedDay(idx)`
   2.1. Hero-card oppdaterer instant (data ligger lokalt allerede)
   2.2. "Hele uka"-list highlighter den nye raden
   2.3. URL endres ikke (deep-link kommer eventuelt i Sprint 5)
3. Hvis ny valgt dag har `recipe`: vis recipe-detalj med skalering
4. Hvis ny valgt dag har `recipe == null`: vis tom-tilstand m/ placeholder-CTA

### 2.3 Bruker ser oppskrift-detaljer

1. Hero-card viser:
   1.1. Kategori-tag (Rask/Comfort/Helg) — fra `recipe.category`
   1.2. Prep-time-tag fra `recipe.prep_time` (string, eks "25 min")
   1.3. Dag-navn + dato i mint
   1.4. Recipe-name som display
2. Under hero-card vises ingrediens-liste (når valgt dag har recipe):
   2.1. For hver ingrediens: skalert qty + unit + name
   2.2. Skalering: `qty * (portionSum / recipe.servings)`
   2.3. Round qty til 1 desimal hvis < 10, ellers heltall
   2.4. Vis original-servings og effective-portions ("4 porsjoner")
3. Sekundær-knapp "Åpne kilde" hvis `recipe.url` finnes
   3.1. `target="_blank" rel="noopener noreferrer"` per DEL 4
4. Når valgt dag har `status === 'away'`: vis info-tekst
   ("Borte denne dagen") i stedet for recipe-detaljer

### 2.4 Placeholder-actions (utsatt til Sprint 5)

1. "Bytt middag" / "Planlegg middag"-knapp på hero-card
   1.1. Trykk → inline status "Kommer i Sprint 5" i 3 sek
   1.2. Samme mønster som Family-skjermens edit/invite-placeholder
2. "Generer manglende"-link (mockup-element) — placeholder identisk
3. Status-toggle (away/skipped) — ikke i denne PR-en

---

## 3. Domenemodell-påvirkning

### 3.1 Ingen nye entiteter

All data hentes fra eksisterende endepunkter. Ingen migrasjoner.
Ingen DOMAIN_MODEL.md-oppdatering nødvendig.

### 3.2 Berørte filer

**Nye filer (klient):**
- `client/src/app/meals/mealsApi.ts` — typed wrapper rundt
  `/api/meals/current`. Speiler dashboardApi.ts-mønsteret.
- `client/src/app/meals/mealsApi.test.ts` — fetch-mønstre, error-mapping
- `client/src/app/meals/useMealsData.ts` — hook som henter meals + family
  parallelt og returnerer normalisert state. Returnerer også
  `selectedDayIndex`, `selectDay()`, `todayIndex`, og scaling-helpers.
- `client/src/app/meals/useMealsData.test.tsx` — hook-tester
- `client/src/app/components/meals/DayStrip.tsx` — horisontal 7-dagers
  navigasjon med "I dag"-uthevelse
- `client/src/app/components/meals/DayStrip.test.tsx`
- `client/src/app/components/meals/MealHero.tsx` — feature-card for
  valgt dag (kategori-tag, prep-time, navn, status)
- `client/src/app/components/meals/MealHero.test.tsx`
- `client/src/app/components/meals/RecipeIngredients.tsx` —
  ingredient-liste med portion-skalering
- `client/src/app/components/meals/RecipeIngredients.test.tsx`
- `client/src/app/components/meals/WeekList.tsx` — sekundær liste
  som viser alle 7 dager kompakt
- `client/src/app/components/meals/WeekList.test.tsx`

**Modifiserte filer:**
- `client/src/app/screens/Meals.tsx` — full implementation, ikke
  placeholder
- `client/src/app/screens/Meals.test.tsx` — utvides fra smoke-test
- `client/src/app/i18n/locales/no/meals.json` — utvides
- `client/src/app/i18n/locales/en/meals.json` — utvides (bundle parity)

**Backend uendret.** Ingen route-endring, ingen service-endring,
ingen migrasjon, ingen ny avhengighet.

### 3.3 Datamodell-bruk (lese-only)

Endepunkter brukt:
- `GET /api/meals/current` → `{ weekYear, meals: [{ dayOfWeek,
  dayName, recipeId, status, recipe }] }`. `recipe` er allerede
  full annotert med per-member-filter (B7) — vi trenger ikke
  re-annotere klient-side.
- `GET /api/family` → `{ portionSum, profileMembers, users, family }`.
  Bare `portionSum` brukes for skalering i denne PR-en.

Recipe-shape som vi støtter på klient (ikke alle felter brukes):
```ts
{ id, name, category, prep_time, servings, url?, ingredients: [{ name, qty, unit, productKey? }] }
```

---

## 4. Edge-cases (12)

1. **Tom uke (ingen middager planlagt)** — alle 7 `recipe === null`.
   DayStrip rendres uten dot-indikatorer, hero viser tom-tilstand,
   WeekList viser "+ Legg til middag"-placeholder per rad.
2. **Delvis uke (noen dager planlagt)** — DayStrip viser dot bare på
   planlagte dager, andre er udimmet uten dot.
3. **Status `away`** — recipe kan være satt OG status='away'. Vi
   prioriterer status: viser "Borte denne dagen" istedenfor recipe,
   men beholder recipe-name som lite metadata.
4. **Status `skipped`** — vis "Hopp over" badge.
5. **Status `removed`** — behandles som tom (recipe = null effektivt).
6. **portionSum = 0** (tom roster) — skalering fall-back til 1.0;
   vis original-servings uten warning. Sjeldent (krever multi-tenant
   uten members).
7. **portionSum = NaN/null** — defensiv: `1.0`. Logget i console.
8. **Recipe.servings = 0/null** — defensiv: skip skalering, vis
   ingredients som-er.
9. **Recipe.ingredients = []** — vis "Ingen ingredienser registrert"
   under detaljer.
10. **/api/meals/current 401** — vis error-card med retry; ny navigasjon
    trigger AuthGuard hvis cookie er utløpt.
11. **/api/family 4xx** — degraderer til ikke-skalert visning;
    vis subtil hint "Familie-data utilgjengelig — viser oppskriftens
    standardporsjoner". Ikke blokkerende for hovedskjermen.
12. **Recipe.url er null** — skjul "Åpne kilde"-knappen.

---

## 5. Konsekvenser på tvers

### 5.1 Frontend
- Nytt tre på 9 nye filer + 4 modifiserte.
- Ingen endring i nav-items (Meals var allerede i nav).
- AppShell uendret.

### 5.2 Backend
- Ingen endringer.

### 5.3 i18n
- Ny keys i `meals.json` for begge språk. Speiler eksisterende
  `family.json`-mønster (heading + actions + empty + errors).
- Bundle-parity-test skal forbli grønn (allerede dekket av
  `client/src/app/i18n/bundles.test.ts`).

### 5.4 Bundle-impact
Forventet: ~3-4 KB gzipped pga. 4 nye komponenter, hook, API-wrapper.
Estimat: 93.5 KB → ~96-98 KB gzipped main. Innenfor akseptable
rammer (Family-PR la til 2.5 KB; denne er litt større pga. flere
komponenter).

### 5.5 Tester
~30-40 nye client-tester forventet. Total client-test-count:
371 → ~410. Server-tester urørt.

### 5.6 OpenAPI / DOMAIN_MODEL.md
Ingen endring. Endepunktene `/api/meals/current` og `/api/family`
er allerede dokumentert i `openapi.yaml` (verifisert tidligere).

---

## 6. Beslutninger (med anbefaling)

### B1 — Scope: minimum (read-only) vs utvidet (read + write)

**ANBEFALING:** **Minimum (read-only) for denne PR-en.** Mutasjoner
utsettes til Sprint 5 som dedikerte sub-prompts.

**HVORFOR:** Måltider er den mest komplekse Fase-2-skjermen.
Backend har 7 mutating-endepunkter (swap, status, reorder,
pantry-suggestions, pantry-suggestions/accept). Hver av dem
trenger sin egen UX-flyt — modal/picker, optimistic updates,
shelf-warnings, allergi-dialoger. Å klemme alt inn i én PR vil
enten produsere svak UX (hver knapp halv-implementert) eller en
PR som vokser fra 1 dag til 3-4 dager og blir vanskelig å reviewe.
Sprint 4 er den siste sprinten i ukens scope; bedre å lande
solid read-only enn å sluttføre med en stor halv-ferdig PR.

**ALTERNATIVER:**
- **(a) Minimum read-only** (anbefales): View week, view recipe,
  view scaled ingredients. Placeholder-knapper for swap/plan
  (samme mønster som Family-skjermens edit-knapp). 1 dag.
- **(b) Read + swap-modal**: Legg til "Bytt middag"-modal med
  recipe-picker som leser /api/recipes. ~2 dager. Større PR-diff,
  må håndtere 88 oppskrifter i picker (søk eller scroll).
- **(c) Full scope**: Read + alle mutasjoner. ~3-4 dager. Sprint 4
  glir over til Sprint 5.

**KONSEKVENS HVIS ANNERLEDES:** (b) eller (c) krever Christers
eksplisitte aksept av lengre tidslinje og at Sprint 4-rammen
strekkes. (a) lar Sprint 4 lukkes etter denne PR-en og gir
naturlig sub-scope for Sprint 5-prompts.

### B2 — Tag-felt på hero/list-card (mockup viser "Fisk", "Mexican")

**ANBEFALING:** Vis `recipe.category` ('rask'/'comfort'/'helg' →
"Rask"/"Hverdagskos"/"Helg") som tag, ikke fri-tekst-tags.

**HVORFOR:** Mockupens `weekMeals.tag` er "Fisk", "Mexican",
"Italiensk" — fri-tekst-kategorier som ikke matcher backend-
schemaet. `recipes.tags`-feltet ble planlagt i locked-decisions
§4.2 til migrasjon 022, men migrasjon 022 ble omdisponert til
magic-link-token-hashing (Sprint 3). `recipes.tags` finnes ikke
i nåværende schema. Bruke `category` er ærlig representasjon av
backend-data; "tags-på-oppskrifter" er en separat feature som
hører i en senere sprint.

**ALTERNATIVER:**
- (a) Vis `category` (anbefales) — krever bare label-mapping i i18n
- (b) Bygg ny migrasjon for `recipes.tags`-kolonne — out of scope,
  trigger Stopp-prosedyre
- (c) Skjul tag-feltet helt — taper visuell variasjon, hero-card
  blir tom over recipe-name

**KONSEKVENS HVIS ANNERLEDES:** (b) krever ANALYSE av tag-source,
tags-editor-UI, og data-migrasjon. (c) er teknisk OK men gjør
hero-card mindre interessant; kan vurderes hvis category-mapping
føles påklint.

### B3 — Kcal-felt (mockup viser "620 kcal/porsjon")

**ANBEFALING:** **Skjul.** Ikke i datamodell, ikke i UI.

**HVORFOR:** locked-decisions §4.1 sier eksplisitt "Kcal-felter
fjernet fra v1. Ikke i datamodell, ikke i UI." Mockupens kcal er
fra et tidligere designforslag før beslutningen ble låst.

**ALTERNATIVER:** Ingen relevante. Beslutningen er låst.

**KONSEKVENS HVIS ANNERLEDES:** Ville krevd ny migrasjon, ny seed-
data, og bryte locked-decisions-frysen.

### B4 — "Hele uka"-liste under hero (mockup viser begge)

**ANBEFALING:** **Inkluder.** WeekList rendres under hero.

**HVORFOR:** Mockupens layout er smart — DayStrip øverst er for
**bytting** av aktiv dag, mens "Hele uka"-listen gir
**oversikt** over hele uka samtidig (én rad per dag med navn,
prep-time, status). På mobile er dette viktig; DayStrip alene
gir ikke kontekst på hva neste dager inneholder. Komponenten er
liten (~50 linjer) og ikke kostbar bundle-messig.

**ALTERNATIVER:**
- (a) Inkluder begge (anbefales) — matcher mockup
- (b) Bare DayStrip — sparer ~50 linjer, men taper kontekst
- (c) Bare WeekList — taper "I dag"-uthevelse-mønster fra mockup

**KONSEKVENS HVIS ANNERLEDES:** (b)/(c) ville avvike fra mockup
uten god grunn. Bedre å levere komplett mønster nå.

### B5 — Skalering: vis original eller skalert?

**ANBEFALING:** Vis **skalerte** ingredient-mengder pluss en
liten meta-tekst "Skalert til X porsjoner (av Y i original)".

**HVORFOR:** Brukeren handler/lager mat — skalert er det relevante.
Men det er nyttig å se at skalering har skjedd, ellers virker tall
mystiske. Match til shopping-list-tjenestens regnemodell
(`effectiveScale`-funksjonen i family.service.js).

**ALTERNATIVER:**
- (a) Vis skalert + meta (anbefales)
- (b) Vis bare original — krever brukeren mente-regne; rart at
  Family-skjermens portion-slider da ikke har effekt på Meals
- (c) Toggle mellom original/skalert — over-engineered for v1

**KONSEKVENS HVIS ANNERLEDES:** (b) ville gjøre portion-slider
nytteløs i Meals-konteksten. (c) krever ekstra UI-state.

---

## 7. Portainer-oppstartsrisiko-sjekk (DEL 3 §2.6)

| Punkt | Berøres? |
|---|---|
| Dockerfile / .dockerignore | nei |
| docker-compose.yml | nei |
| server/http/bootstrap.js | nei |
| server/config.js oppstartsvalidering | nei |
| server/index.js startup-sekvens | nei |
| server/db.js eller migrations/** | nei |
| install.sh | nei |
| bootstrap.json-lesning eller -skriving | nei |
| Miljøvariabel-krav for oppstart | nei |

**Resultat:** Ingen Portainer-risiko. Dette er en ren klient-PR.
PORTAINER-RISIKO-prosedyre ikke utløst.

---

## 8. ISO 25010-påvirkning

| Karakteristikk | Før | Etter | Endring |
|---|---|---|---|
| Funksjonell egnethet | 8.8 | 8.9 | +0.1 (siste hovedskjerm levert) |
| Pålitelighet | 8.4 | 8.4 | uendret |
| Brukbarhet | 8.6 | 8.7 | +0.1 (ukesoversikt + skalert ingrediens-visning) |
| Sikkerhet | 8.3 | 8.3 | uendret (ingen nye endepunkter) |
| Vedlikeholdbarhet | 8.5 | 8.5 | uendret (følger etablert komponent-mønster) |
| Portabilitet | 8.5 | 8.5 | uendret |
| Effektivitet | 8.4 | 8.4 | uendret (parallelle fetches, cache-headere fra backend) |
| Kompatibilitet | 8.4 | 8.4 | uendret |

**Snitt:** ~8.55 → ~8.58. Ingen karakteristikk under 8.0. Innenfor
DEL 7.5-grensene.

---

## 9. Plan (commit-rekkefølge)

1. **`docs(analysis): add analysis for fase-2c-meals`** — denne filen.
2. **`feat(client/meals): mealsApi + useMealsData hook + tests`** —
   API-wrapper med fetchMealsCurrent(), hook som returnerer
   `{ data, isLoading, error, selectedDayIndex, selectDay, todayIndex,
   scale, retry }`. Bygger på dashboard- og family-mønstrene.
3. **`feat(client/meals): DayStrip + MealHero + RecipeIngredients + WeekList components`** —
   fire stand-alone presenterende komponenter med tester. Ingen
   side-effects; alt input via props.
4. **`feat(client/meals): Meals screen + i18n keys (NO+EN)`** —
   replace placeholder, bind hook + komponenter, legg til
   ~25 i18n-keys med bundle parity.
5. **`test(client/meals): smoke + integration test for screen`** —
   utvid `Meals.test.tsx` til full integration mot mocked endpoints.

Hver commit ≤200 linjer diff (tester + kode kombinert) eller har
forklaring i commit-body. Etter hver commit: lokal CI-pyramide
(lint → typecheck → tests).

---

## 10. Sikkerhetssjekkliste-pekere (full check i PR)

- [ ] Ingen ny brukerinput → ingen ny Zod-schema
- [ ] Ingen nye endepunkter → ingen ny auth-sjekk
- [ ] Ingen secrets, ingen PII-logging — vi viser bare meal-data som
  bruker selv har lagt inn
- [ ] `recipe.url` rendres som `<a target="_blank" rel="noopener noreferrer">`
- [ ] Recipe-name og ingredient-name rendres som tekst, ikke
  `dangerouslySetInnerHTML` — React eskaperer per default
- [ ] Ingen CSP-svekkelse — server/http/security.js urørt
- [ ] Ingen nye dependencies

---

## 11. Kompleksitet-vurdering (DEL 3 §2.9)

Christer's CONTEXT.md-estimat: ikke spesifisert (master-plan-prompt).
Min vurdering: **medium-stor**. 9 nye filer, 12 edge-cases, 5
beslutninger. Ikke triviell — full analyse er begrunnet.

Sammenlignet med Fase 2B (Family) som hadde 12 edge-cases og 5
beslutninger: omtrent samme størrelse, men Meals har mer
spennvidde i komponenter (4 vs 1) og litt enklere state
(read-only vs optimistic). Forventet gjennomføringstid: 1 dag
hvis B1-anbefaling (minimum read-only) godkjennes.

---

## 12. Spørsmål til Christer FØR implementering

1. **B1 (scope)** — godkjenner du minimum read-only? Eller skal
   swap-modal eller andre mutasjoner inkluderes i samme PR?
2. **B2 (tag-felt)** — bekrefter du at vi viser `category` som tag,
   og at recipes.tags-migrasjon utsettes til en senere sprint?
3. **B5 (skalering)** — godkjenner du "skalert + meta" som
   default-visning?

Ingen blokkerende stoppere ble utløst i analysen. Alle B1/B2/B5-
beslutninger lå innenfor frihetsgraden gitt i prompten, så jeg
kan i prinsippet starte på minimum read-only-scope direkte hvis
du foretrekker det. Men siden B1 er en scope-beslutning som
påvirker Sprint 5, vil jeg bekrefte den eksplisitt før
implementering.
