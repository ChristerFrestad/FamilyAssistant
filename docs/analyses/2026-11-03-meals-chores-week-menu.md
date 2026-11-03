# Oppgaver, oppskrift, tom middag, bytte og ny ukemeny

**Dato:** 2026-11-03
**Branch:** `cursor/fix-meals-chores-week-menu-cd17`
**Type:** Feilretting (fem rapporterte brukerproblemer)

Brukeren rapporterer at oppgaver ikke kan
slettes, at oppskrifter ikke åpnes, at en middag ikke kan fjernes fra
en dag, at bytte av middag først virker på andre forsøk, og at ukemenyen
er den samme hver uke (de sju seed-middagene).

---

## Reisen

### 1. Slette en oppgave

1. Voksen åpner Gjøremål og ser ukens rader, inkludert standardoppgaver
   fra seed (støvsuging, søppel, bad).
1.1. Raden har fullfør, angre og utsett, men ingen slett.
1.2. Katalog-API-et kan sette `active: false` via PATCH, men ukens
     `chore_schedules`-rad blir liggende, så oppgaven vises videre.
1.3. Neste uke kjører `seedDefault` på nytt for alle aktive oppgaver,
     så en standardoppgave som bare ble skjult i katalog-lista kommer
     tilbake.
2. Bruker trykker Slett og bekrefter.
2.1. Server setter `active = 0` (historikk i `chore_completions` blir).
2.2. Server sletter planlagte rader fra inneværende uke og fremover.
2.3. Senere uker som seedes på nytt hopper over inaktive oppgaver.
3. Samme flyt gjelder en oppgave brukeren selv la til. Det finnes
   ingen egen «seed-lås».

### 2. Åpne en oppskrift

1. Bruker står på Måltider, «Hele uka», og trykker en middag.
1.1. Radknappen kaller bare `onSelect` (bytter valgt dag).
1.2. Helten med ingredienser ligger over folden på mobil, så trykket
     ser ut som ingenting.
1.3. Mockupen har «Åpne oppskrift». Den knappen finnes ikke. «Åpne
     kilde» går til et eksternt nettsted, og flere seed-URL-er er bare
     forsiden til matprat/godt.
2. Trykk på middagen, eller «Åpne oppskrift» i helten, går til
   `/recipes/:id`.
2.1. GET `/api/recipes/:id` hentes med `cache: 'no-store'`.
2.2. Tomt svar kaster feil i stedet for å lese `null.recipe` og krasje.

### 3. Ingen middag en dag

1. En dag har en oppskrift. Bruker vil markere at familien ikke skal
   spise middag den dagen.
1.1. Status `removed` finnes i skjema og i handleliste-filteret
     («eksplisitt tom»), men ingen knapp setter den.
1.2. `setStatus` lar oppskriften ligge, så ingrediensene kan fortsatt
     telle med hvis statusen ikke er en av skip-verdiene.
2. «Ingen middag» nullstiller `recipe_id` og setter `status = 'removed'`.
2.1. Helten og «Hele uka» viser tom dag, med «Planlegg middag» for å
     legge inn noe igjen.
2.2. Handlelisten hopper over dagen (`removed` er allerede et unntak).

### 4. Bytte middag på første trykk

1. Bruker trykker «Bytt middag» og velger en oppskrift.
1.1. Radene i velgeren er ikke selv knapper. Bare den lille «Velg»-
     knappen sender valget. Første trykk på raden gjør ingenting.
1.2. `useRecipePicker` leser `dayOfWeek` fra render-state. Et
     foreldet callback-kall returnerer uten å kalle API-et.
1.3. Etter suksess hentes uken på nytt. GET `/api/meals` caches i
     tjenesten (60s) og i service workeren som
     `StaleWhileRevalidate`. En GET som var i gang da byttet
     invaliderte cachen, kan skrive den gamle uken tilbake. UI-et
     viser derfor gammel middag til neste forsøk.
2. Hele raden velger oppskriften. Bytte-svaret inneholder den ferdige
   uken, og skjermen bruker den med en gang, uten å vente på en GET
   som kan være utdatert.
3. Cache skriver ikke tilbake et svar som startet før en invalidering.
   Service workeren bruker `NetworkFirst` for `/api/meals`.

### 5. Ny uke, ny meny

1. Bruker åpner neste uke (eller en ny kalenderuke).
1.1. `ensureWeek` kaller `buildDefaultWeekPlan`.
1.2. Den funksjonen mapper alltid `seed.defaultMealPlan` (oppskrift
     1–7): kylling red curry, laks i airfryer, pasta med scampi,
     mongolian beef, smashburger, pizza, nakkekoteletter.
1.3. Uker som allerede er lagret, røres ikke. Derfor er hver nye uke
     en kopi av den forrige.
1.4. `/api/meals/current` er samme URL hver uke. Gammel service
     worker-cache kan vise forrige ukes kopi selv om serveren hadde
     skrevet noe nytt.
2. En uke som ikke finnes ennå, fylles med sju ulike oppskrifter fra
   familiens aktive bibliotek.
2.1. Valget roterer med ukenummeret, så to uker på rad ikke starter
     på samme rett.
2.2. Oppskrifter brukt de siste fire ukene hoppes over når det finnes
     nok andre.
2.3. Allergifilteret gjelder. For få trygge oppskrifter gir tomme
     dager (`recipe_id` null), ikke en kopi av seed-menyen.
2.4. Bruker kan fortsatt bytte enkelt dager etterpå.
2.5. Allerede lagrede uker, inkludert den brukeren har byttet på,
     blir ikke skrevet om.

## Domenemodell

- `server/repositories/chore.repo.js`: `retire(id, fromWeekYear)`
- `server/routes.js`: `DELETE /api/chores/:id`, `PUT /api/meals/clear`,
  bytte-svar inkluderer `week`
- `server/repositories/meal.repo.js`: `clearDinner`, `recentRecipeIds`
- `server/services/meal-planning.service.js`: `chooseWeekRecipes`,
  `buildVariedWeekPlan`
- `server/services/seed.service.js`: nye uker bruker variert plan
- `server/http/cache.js`: ingen tilbakeskriving etter invalidering
- `client/src/app/screens/Meals.tsx`, `Chores.tsx` og måltidskomponentene
- `docs/DOMAIN_MODEL.md`: ukemeny-regelen og sletting av oppgave

Ingen ny tabell. Ingen migrasjon.

## Edge cases

1. Tomt oppgavenavn er allerede avvist av Zod. Slett krever positiv id.
2. Slett av ukjent id, eller en annen families id, er 404.
3. Barn kan ikke slette (403). Voksen kan slette både egen og seedet
   oppgave.
4. Fullførte poeng i `chore_completions` blir liggende.
5. Oppgave uten `default_day` (ikke på ukebrettet) kan likevel slettes
   fra katalogen hvis den har en rad. UI-et sletter fra ukebrettet.
6. Allerede seedet fremtidig uke mister den slettede oppgaven fordi
   rader med `week_year >= nå` slettes.
7. «Ingen middag» på en dag som ikke har rad ennå, oppretter raden som
   `removed` slik at senere backfill ikke fyller den med en rett.
8. Bytte og fjerning på en uke i fortiden følger eksisterende
   `resolveWeekYear` (lesing seeder ikke fortid; skriving oppdaterer
   sin egen rad).
9. Familie med færre enn sju trygge oppskrifter får de den har, resten
   av dagene står uplanlagt.
10. To uker på rad med stort bibliotek deler ingen oppskrifter når de
    fire siste ukene ekskluderes.
11. Deaktivert oppskrift (`getAll` uten inaktive) brukes ikke i en ny uke.
12. Allergi som skjuler en rett, holder den ute av den nye uken.
13. Eksisterende uke med byttet middag blir ikke overskrevet når
    brukeren åpner den på nytt.
14. Svært langt oppgavenavn i bekreftelsesdialogen er den lagrede
    teksten, ikke en ny validering.
15. Oppskriftssvar uten JSON kaster `MealsApiError` i stedet for å
    krasje editoren.
16. Samtidig GET som leser gammel meny etter et bytte, får ikke legge
    den gamle kroppen tilbake i servercachen.

## Kryssende konsekvenser

- Frontend: ChoreRow, Chores, MealHero, WeekList, Meals, RecipePicker,
  useRecipePicker, mealsApi, choresApi, i18n no+en.
- API: DELETE chore, PUT meals/clear, utvidet swap-respons.
- Ingen migrasjon.
- `openapi.yaml` får de to nye rutene, og status-enumet inkluderer
  `removed`.
- Tester: chore-crud, meals-week-seed, cache, ny household-fixes,
  klienttester for chores, hero, week list, picker, hook.
- Service worker: måltids-GET er `NetworkFirst`.

## Beslutninger

```
DECISION: Skal sletting av oppgave være hard delete?
RECOMMENDATION: Nei. active=0, fjern planlagte rader fra denne uken og
fremover, behold fullføringshistorikk.
WHY: Samme mønster som oppskrifter (skjul, ikke slett), og XP-historikk
blir meningsfull. Oppgaven forsvinner fra ukebrettet med en gang, også
standardoppgaver, fordi de ikke har en egen lås.
ALTERNATIVES:
- Hard DELETE: mister historikk og kan bryte FK fra chore_completions.
- Bare active=0: raden blir stående på inneværende uke, så brukeren
  opplever at slett ikke virker.
CONSEQUENCE IF DIFFERENT: Enten hull i historikk, eller oppgaven
synes fortsatt denne uken.
```

```
DECISION: Hva betyr «ingen middag»?
RECOMMENDATION: recipe_id NULL og status 'removed'.
WHY: Statusen finnes allerede og handlelisten ignorerer den. Tom
'planned' betyr «ikke bestemt ennå» og blokkerer generering av
handleliste. 'removed' er et bevisst valg.
ALTERNATIVES:
- status 'skipped': copyen sier «pause», ikke «ingen middag».
- Slette raden: backfill legger inn en uplanlagt dag igjen.
CONSEQUENCE IF DIFFERENT: Dagen ser ut som «ikke bestemt» eller kommer
tilbake neste gang uken leses.
```

```
DECISION: Hvordan skal en ny uke velge middager?
RECOMMENDATION: Deterministisk rotasjon på ukenummer, unngå de siste
fire ukene, behold kategori-mix (fire raske, en comfort, to helg) når
biblioteket tillater det. Ikke rør lagrede uker.
WHY: Brukeren skal få en ny meny uten å trykke «generer», og fortsatt
kunne bytte. Samme uke skal ikke kaste terning på nytt mellom to
enheter (INSERT OR IGNORE, første skriver vinner).
ALTERNATIVES:
- Alltid seed.defaultMealPlan: det er feilen.
- Ren Math.random: to faner kan se forskjellig meny, og tester blir
  flaky.
CONSEQUENCE IF DIFFERENT: Menyen forblir lik, eller samme uke kan få
ulike forslag avhengig av hvem som åpnet den først.
```

```
DECISION: Hvordan skal første bytte vises?
RECOMMENDATION: PUT-svaret inneholder den ferdige uken, og klienten
tegner den med en gang. Ingen oppfølgende GET.
WHY: Oppfølgende GET kan treffe en cache som fortsatt har forrige
meny. Da ser første bytte ut som det ikke virket.
ALTERNATIVES:
- Bare NetworkFirst: fikser service workeren, men ikke et svar som
  allerede er på vei inn i servercachen.
- Bare optimistisk UI uten server-uke: helten trenger ingredienser
  som velgeren ikke har.
CONSEQUENCE IF DIFFERENT: Første trykk kan fortsatt vise gammel rett
til neste forsøk.
```

## Portainer startup-risk

- Dockerfile / .dockerignore: nei
- docker-compose.yml: nei
- server/http/bootstrap.js: nei
- server/config.js: nei
- server/index.js: nei
- server/db.js eller migrasjoner: nei
- install.sh / bootstrap.json: nei
- Nye miljøvariabler ved oppstart: nei

Ingen PORTAINER-RISK.

## ISO 25010

- Functional suitability: bedre. De fem rapporterte handlingene virker.
- Reliability: bedre. Cache skriver ikke utdatert måltidsuke tilbake.
- Usability: bedre. Slett, åpne oppskrift og ingen middag er synlige.
- Security: ikke påvirket. Voksen-rolle og familie-scope som før.
- Maintainability: ikke påvirket på en måte som trekker noe under 8.

## Plan

1. Analyse (dette dokumentet).
2. Server: slett oppgave, fjern middag, variert uke, cache-epoke,
   bytte-svar med uke.
3. Klient: knapper, åpne oppskrift, bruk bytte-svaret, NetworkFirst.
4. Tester og domenemodell.
