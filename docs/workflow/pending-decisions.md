# Pending decisions — venter på Christer

**Sist oppdatert:** 2026-04-28 (kalender-arkitektur lagt til som Fase 2-beslutning; batch-2 fortsatt konsolidert lokalt og venter push-klarsignal "nå pusher vi batch 2")

Dette dokumentet er en lokal huskelapp for beslutninger Christer må
ta. Primær-lokasjon er **GitHub Issue #62** (uke 2-beslutninger —
lukket 2026-04-20) og **PR #59** (frontend-bug analyse — åpen, fix
inkludert i batch-2).

---

## Batch 2 — venter push-klarsignal

**Branch:** `batch-2` (lokal). **Status:** 13 commits + 4 merge-commits,
tier 1+2+3 grønn, PR-beskrivelse i `docs/workflow/batch-2-pr-description.md`.

**Fire enheter:**
- Gruppe A: Portainer SESSION_SECRET deploy-gate (docs)
- Gruppe B: B2 LLM felles Ollama (RUNBOOK §13)
- Gruppe C: PR #59 frontend empty-cart fix (3-lags defensiv)
- Gruppe D: B7 per-medlem diett backend (migrasjon 020 + tre-lags filter + endpoints)

Push utløses kun av eksakt frase "nå pusher vi batch 2" fra Christer.
Ikke "ok", "push", "gå videre" eller lignende.

---

## ✅ Uke 2-beslutninger (Issue #62 — LUKKET 2026-04-20)

Christers svar, sitert for rask referanse:

- [x] **B1** — Multi-tenant aktivering → **(a)** uke 2.
      *"Testes tidlig i prod-lignende kontekst før 5 familier inviteres."*
- [x] **B2** — LLM-strategi → **(a)** min Ollama som felles ressurs.
      *"5 familier, moderat bruk, ingen support-byrde. Kan byttes senere."*
- [x] **B3** — Resend e-post → **(b)** uke 3-4.
      *"Først etter multi-tenant er testet."*
- [x] **B4** — Cloudflare Tunnel → **(b)** uke 4-5.
      *"Ikke offentlig tilgjengelighet før appen er klar."*
- [x] **B5** — Første gamification-feature → **(a)** `chore_completions`-tabell først.
      *"Datamodell-avhengighet. Alt annet bygger på denne."*
- [x] **B6** — Kalender → **(a)** bare Google.
      *"Apple CalDAV er 3-4 uker ekstra arbeid."*
- [x] **B7** — Per-medlem diett → **(a)** implementer i uke 1-7.
      *"Bygge per-medlem nå er enklere enn refaktorere senere."*
- [x] **Billing** — Løst 2026-04-20 (separat handling). Full CI
      fungerer normalt fra og med neste push.

Full issue-historikk: https://github.com/ChristerFrestad/FamilyAssistant/issues/62

---

## Blokker frontend-bug-fix: 5 spørsmål i PR #59

PR #59 (draft `[ANALYSE] empty shopping list UI bug`) venter på
svar før fix-fase kan velge hypotese.

- [ ] **Q1** — Branch/commit-SHA for parallelt `public/index.html`-arbeid
- [ ] **Q2** — Nettleser + inkognito-test (skiller H3 SW-cache)
- [ ] **Q3** — DevTools → Network-response for `GET /api/shopping/list/current`
- [ ] **Q4** — Tidspunkt for første observasjon + evt. "Ferdig handlet"-klikk (H2)
- [ ] **Q5** — Siste dato varer var synlige (skiller H1 uke-mismatch)

Full kontekst: https://github.com/ChristerFrestad/FamilyAssistant/pull/59

---

## Uke 2-sekvens (etter B1–B7-svarene)

Basert på svarene over er rekkefølgen:

1. **B1 multi-tenant aktivering** — starter nå (uke 2). Tiner frysen
   i CLAUDE.md DEL 6.1. Analyse først, så kode. Blokkerer B3, B4, B7.
2. **B5 `chore_completions`-tabell** — kan startes parallelt (rent
   datamodell-arbeid, uavhengig av multi-tenant). Gamification-fundament.
3. **B7 per-medlem diett-datamodell** — etter B1 (krever multi-tenant-
   skjema aktivt for å utvide med `user_members`-koblinger).
4. **B3 Resend e-post** — uke 3-4, etter multi-tenant er testet.
5. **B4 Cloudflare Tunnel** — uke 4-5.
6. **B6 Google Calendar** — uke 4-6 (OAuth + sync-logikk).
7. **B2 Ollama som felles LLM** — krever ingen kode-endring (eksisterende
   konfig). Kan verifiseres/dokumenteres når multi-tenant er aktiv.

PR #59-fix håndteres parallelt når Christer svarer på de 5 spørsmålene.

Claude oppdaterer denne filen når uke 2-leveransene fullføres.

---

## B7 — Per-medlem diett UI (MÅ gjøres før eksterne familier inviteres)

**Status (2026-04-22):** Backend-arbeidet er landet lokalt på
`feat/per-member-diet`-branchen i 3 commits:

- Migrasjon 020 + `updateMemberDiet`/`getMemberDiet` i `family.repo.js`
- Tre-lags filter-arkitektur (`allergy-filter` utvidet, nye
  `dislike-filter.service.js` og `diet-filter.service.js`, fasaden
  `recipe-filter.service.js`)
- `PUT`/`GET /api/family/members/:id/diet` + 5 oppgraderte call sites,
  inkludert `?ignoreDietTags=true`-query-param for D7-override

**Ikke gjort (pending UI-arbeid — må leveres i uke 3 eller ved ny
frontend-leveranse, FØR flere familier inviteres):**

- [ ] **UI for PUT /api/family/members/:id/diet** — per-medlem-form
      med allergi-liste, dislike-liste, diet_tag-chip-velger (14 enum-
      verdier fra D3) og custom_diet_note-fritekst. Uten denne kan
      operatører sette data kun via `curl`/dev-tools.
- [ ] **Override-toggle for diet_tags (D7)** — UI-komponent øverst i
      oppskrifts-visning: "Vis alle oppskrifter uansett diett". Må
      huske tilstand lokalt (localStorage eller URL-param). Setter
      `?ignoreDietTags=true` på `GET /api/recipes`-kall. Server
      persisterer ikke denne — se D7-avklaring.
- [ ] **Per-medlem-visualisering** — "Truer Lise (gluten), Kari
      (laktose)" via `perMember.allergy.blockedIngredients[].blockedFor`.
      Matrise eller chip-liste. Må også vise `perMember.dislike.warnings`
      som svakere hint (ikke rødt varsel).
- [ ] **Meal-planning per-medlem-integrering** — nåværende
      `isRecipeSafe` i meal-planning bruker KUN familie-nivå-allergier
      (intensjonalt minimum-endring i kode-fasen). Når UI er klar,
      oppgrader callers til å passere `members` → dermed respekteres
      også diet_tags i ukeplan-kandidater.

**Referanser:**
- D7-beslutning (tre-lags filter): Christers uke 2-melding 2026-04-22
- Analyse: `docs/analyses/2026-04-22-per-member-diet.md`
- Tre commits: se `git log feat/per-member-diet`

**Blokkering for ekstern invitasjon:** Inviteres en ny familie *uten*
UI landet, kan operatør-adult sette data via API, men det finnes ingen
måte for vanlig bruker å administrere sin egen diett. Det bryter
selvbetjeningsløftet fra B1-svaret.

---

## Diabetes-støtte — design pending

Diabetes-støtte krever mer enn én enum-tag. For meningsfull verdi trengs:
(1) næringsstoffinfo per oppskrift (carbs, sugars, fiber per porsjon),
(2) per-medlem karbo/sukker-grenseverdier, (3) warning-basert filter-lag
som viser avvik uten å blokkere. Utsatt til fase 2 (tidligst uke 6-10).
Ikke implementert som halv-løsning i B7.

**Status i B7 (batch-2):** `diabetiker-vennlig` ble bevisst fjernet fra
D3-enum-listen (nå 13 verdier, ikke 14). Regression-test
`updateMemberDiet rejects diabetiker-vennlig (deferred to phase 2)`
i `tests/per-member-diet.repo.test.js` sikrer at verdien ikke
stille re-introduseres uten design-prosess.

**Hva som trengs for fase 2:**
- Datamodell: `recipes.nutrition_per_serving` (carbs_g, sugars_g, fiber_g,
  protein_g, fat_g) eller referanse til ekstern næringsstoff-DB.
- Seed-data eller LLM-assistert parsing av eksisterende oppskrifter.
- `family_profile_members.carb_limit_per_meal_g`,
  `sugar_limit_per_day_g` eller lignende grenseverdi-felter.
- Nytt filter-lag (eller utvidelse av lag 2 SOFT/warning) som rapporterer
  "Høy karbo for Kari (54g vs. hennes 40g-grense)" uten å blokkere.
- UI for å sette grenseverdier + vise warnings i oppskrifts-visning.

**Hvorfor ikke som enum i B7:** En `diabetiker-vennlig` enum-tag som
trigger "sukker/honning/ris/pasta"-ingredienser gir *falsk trygghet* —
en diabetiker som stoler på at tagen filtrerer vekk problematiske måltider
vil fortsatt kunne få risottoer med 80g karbo merket som "OK". Den
medisinske verdien krever faktiske tall, ikke en ingrediens-heuristikk.

---

## Data-retensjon for inaktive familier (post-pilot)

Notert 2026-04-28 ved Fase 1b.2-oppstart. Krever fokusert vurdering
før pilot-invitering.

Fem delspørsmål som må besvares:

### 1. Anonymiseringsfilter for delte oppskrifter

- Skal oppskrifter kunne deles til en fellesbase (på tvers av
  familier)?
- Hvordan filtreres familienavn, personlige referanser, allergier
  knyttet til navngitte personer ("Pasta uten nøtter til Mats")?
- Krever filtreringssystem — hvilken tilnærming?
  - Regelbasert (NLP-tokenisering + blacklist)
  - LLM-assistert anonymisering (drift, kostnad, kvalitet)
  - Hybrid med menneskelig review-køsystem
- Estimat: separat feature, flere ukers arbeid hvis bygget.

### 2. Definisjon av "inaktiv familie"

- Én bruker som er inaktiv, eller alle brukere i familien?
- Hvor lenge før definert som inaktiv?
  - 30 dager? 60? 90? 180?
- Hvordan måles aktivitet?
  - Login (sesjonsstart)?
  - Faktisk handling (CRUD på meals/shopping/chores)?
  - Hvor logges aktivitet i dag — er noen events allerede sporet?

### 3. Hva skjer med inaktive familier

- **Soft-delete med restore-mulighet** i X dager?
- **Anonymiser og behold nyttige data** (oppskrifter, mønstre,
  handle-statistikk uten PII)?
- **Slett alt** (hard delete + cascading)?
- Konsekvens av valget for backup-strategi (reverse-engineering
  fra backup må være konsistent med valget).

### 4. Brukerregistrering og analytics

- Hva logges om bruksmønstre (sider besøkt, klikk, tids-mønstre)?
- Hvordan brukes data til produktforbedring?
- Eksplisitt opt-in eller anonyme aggregater?
- Sentry brukes allerede for feil-sporing — hvor går grensen mellom
  feil-rapport (legitimt) og bruksmønster (krever opt-in)?

### 5. Personvernerklæring

- Krever **juridisk gjennomgang** før publisering.
- Må adressere alle punkter over (1-4) eksplisitt.
- Norge-spesifikke krav:
  - GDPR (allerede dekket av eksisterende `gdpr-routes.js`-export +
    delete, men personvernerklæring må forklare det for brukerne)
  - Datatilsynet-veiledning for husholdnings-apper
- Personvernerklæringen skal lenkes fra Settings + onboarding-flyt.

### Status og timing

**Status:** Notert. Krever fokusert vurdering før pilot-invitering.

**Timing:** avklares før pilot-deploy (uke 10-11+ per
`docs/workflow/pre-deploy-cleanup-plan.md` reaktiveringsfasen).

**Anbefaling:** hent juridisk rådgivning når personvernerklæring
skrives. Ikke skriv ferdig erklæring uten review — kostnadsmessig
billig forsikring mot GDPR-bot ved deploy.

**Hvor er dette krysslinket fra:**
- `design/2026-04-redesign/extracted/locked-decisions.md` §10
  (peker til denne entryen for å sikre at temaet ikke glemmes
  når implementering rulles ut).

---

## Oppskrifts-import via bilde (post-pilot feature)

Notert 2026-04-28. Ikke i scope for v1.

**Scope:** La bruker importere oppskrifter ved å ta bilde av kokebok,
matblogg, eller skjermbilde. AI konverterer bilde til strukturert
oppskrift som lagres i `recipes`-tabellen på lik linje med manuelt
opprettede oppskrifter.

**Foreløpige tanker:**

- **Maks 25 bilder per import** for å begrense lagringsbehov og
  konverteringskost. Bruker ser progress og kan avbryte.
- **Bilde slettes etter konvertering** — kun den ekstraherte teksten
  lagres. Ingen bilde-lagring i database eller filesystem ut over
  konverterings-vinduet.
- **Søk i eksisterende database FØR lagring** (duplikat-deteksjon).
  Hindrer at samme oppskrift-side i en kokebok produserer flere rader
  hvis bruker importerer stk for stk.
- **Inspirasjon:**
  - [Mealie](https://mealie.io/) (eksisterende open-source
    oppskrifts-app — har URL-import, har vært diskutert som
    referanse for v1)
  - LightRAG (lokalt RAG-system, sannsynligvis brukt for det
    semantiske duplikat-søket)
  - Blokk-basert oppskrifts-modell (en oppskrift som sammensatt
    av enheter: ingrediens-blokk, instruksjon-blokk, metadata-
    blokk — slik at delvise treff i database kan flettes med ny
    info i stedet for å bli dropet eller duplisert)
- **Mål:** minimere manuell registrering for bruker. Pilot-familier
  har sannsynligvis kokebøker med 50-200 favoritter; manuell
  inntasting er den største friksjonsbarrieren.

**Tekniske spørsmål som må adresseres:**

- **Hvilken AI-modell konverterer bilde til tekst?**
  - Tesseract OCR + LLM-strukturering?
  - Multimodal LLM (Claude vision, GPT-4V, Llava lokalt)?
  - Hybrid (OCR for tekst, LLM for strukturering)?
- **Hvor kjører konverteringen?**
  - Lokalt via Ollama + multimodal modell (krever GPU på pi eller
    ekstern infra)
  - Ekstern API (Anthropic/OpenAI — koster penger, krever opplæring
    om hva som sendes ut)
  - Hybrid (lokal OCR, ekstern strukturering)
- **Språk-håndtering:**
  - Norsk er primær — multimodal-modeller har varierende kvalitet
    på norsk
  - Internasjonale oppskrifter (engelsk kokebok hos Christer-familien)
    må konverteres + evt. oversettes
  - Flerspråklige ingredienser (`pasta + persille + parmesan`) må
    normaliseres mot eksisterende `products`-tabell
- **Duplikat-deteksjon:**
  - Full tekst-match (rigid, fanger få treff)
  - Semantisk likhet (LightRAG / embeddings — fanger varianter)
  - Fuzzy-match på tittel + ingredienser-overlap
  - Sannsynlig: kombinasjon, brukeren bekrefter ved tvilstilfelle
- **Penger-konsekvens hvis ekstern API:**
  - Kostnadsmodell per import-batch — hvem betaler?
  - Familiekvote? Kasserolle-budget per måned?
  - Default lokalt (gratis men sakte/lavere kvalitet) med
    opt-in mot ekstern (raskt/bedre, koster)?

**Status:** Notert som fremtidig feature. Ikke i scope for v1.

**Timing:** vurderes for v1.1 eller v1.2 etter pilot. Krever post-
pilot-data om hvor smertefull manuell oppskrifts-inntasting faktisk
er for pilot-familiene.

---

## Sikkerhetsarkitektur (pre-pilot, må implementeres)

Notert 2026-04-28. Krever fokusert arbeid før pilot-invitering går
ut.

**Scope:** Sikkerhets-fundamenter som må være på plass før eksterne
brukere inviteres. Dette er ikke en valgfri "nice-to-have" — det er
forutsetningen for at multi-tenant arkitekturen ikke lekker data
mellom familier eller åpner appen for misbruk.

**Punkter som må adresseres:**

### 1. Row Level Security (RLS) i database

- Sikre at **familie A ikke kan lese/endre data fra familie B**.
- Tilnærming-valg:
  - **PostgreSQL RLS-policies:** database håndhever isolasjon
    direkte. Krever at vi flytter fra SQLite eller bruker SQLite-
    ekvivalenter (RLS er ikke tilgjengelig i SQLite — så valget
    påvirker arkitekturen vesentlig).
  - **Applikasjonslag-validering:** alle queries går gjennom et
    repository-lag som filtrerer på `family_id` automatisk via
    AsyncLocalStorage. Vi har dette mønsteret allerede etablert
    (se `server/repositories.js`-mønsteret + `getFamilyId()`-
    helper).
- **Anbefaling foreløpig:** behold app-lag, men gjør et eksplisitt
  pass for å verifisere at ingen rute lekker. Skriv negative tester
  (familie A med family_id=1 prøver å lese family_id=2-data, må
  få 403/404 — ikke 200).
- **Påvirker datamodell og spørringer** — alle nye tabeller må ha
  `family_id` enten direkte eller via en kjent join-vei.

### 2. Server-side validering

- **All input fra klient må valideres serverside.** Klient-validering
  er for UX, ikke sikkerhet.
- **Schema-validering** — vi bruker allerede **Zod** i
  `server/schemas.js`. Sjekkpunkt: alle nye endpoints i Fase 1e+
  må definere Zod-schema og kalle `parse()` før forretningslogikk.
- **Sanitisering av tekst-input** — særlig viktig for tekst som
  rendres tilbake til klient (XSS-vinkel) og for tekst som havner
  i SQL (som er parameterisert via better-sqlite3, men `LIKE`-
  queries med wildcard-userinput kan fortsatt være rare).
- **Filstørrelses-grenser** — relevant så snart vi tar imot bilder
  (oppskrifts-import, profile-bilder, eller liknende). Express
  `body-parser`-konfig + per-endpoint-limit.

### 3. Rate limiting

- **Per IP, per bruker, eller begge?**
  - Per IP fanger uautentisert misbruk (login-bruteforce).
  - Per bruker fanger autentisert misbruk (LLM-quota-spam etter
    login).
  - **Begge** anbefales — IP for pre-auth, bruker for post-auth.
- **Hvilke endepunkter?**
  - Alle har en grov default (f.eks. 100 req/min per IP).
  - Sensitive: lavere grense (login: 10 req/min per IP, LLM-kall:
    20 req/time per bruker).
- **Grenseverdier:** må kalibreres mot pilot-bruksmønster. Default
  konservativt + utvid hvis legitimate brukere blir blokkert.
- **Implementering:**
  - Middleware (`express-rate-limit` med `rate-limit-redis` for
    multi-instance) — full kontroll, krever Redis (eller in-memory
    for single-instance pilot)
  - Reverse-proxy (Nginx Proxy Manager — Christer kjører dette
    allerede på utviklermaskin per CLAUDE.md DEL 7.8) — enklere,
    mindre granular
  - **Anbefaling:** middleware for granularitet. Kan starte med
    in-memory store for pilot, flytte til Redis hvis vi går
    multi-instance.

**Status:** Notert som pre-pilot security-arbeid. Må gjøres ferdig
før pilot-invitering.

**Timing:** før pilot-invitering (uke 10-11+ per
`docs/workflow/pre-deploy-cleanup-plan.md`).

**Anbefaling:** dedikert sikkerhets-fase i prosjektplanen.
**Estimat:** 1-2 uker arbeid.

**Hvorfor dette ikke kan utsettes:** Pilot inviterer fem familier
samtidig. Et tenant-isolasjons-brudd i pilot-vinduet vil:
1. Bryte tilliten hos alle fem familier samtidig
2. Påvirke hva pilot-familiene tør dele med systemet videre
3. Lage en GDPR-eksponering før personvernerklæringen er på plass
4. Tvinge en hastig fix under press, noe som typisk introduserer
   nye bugs

Kostnaden av å ikke gjøre dette riktig er flere størrelses-orden
høyere enn de 1-2 ukene det tar å gjøre det riktig.

---

## Kalender-arkitektur (Fase 2-beslutning)

Notert 2026-04-28 ved oppstart av Fase 1b.3 Batch G (Modal). Krever
beslutning før Fase 2-kalender implementeres (uke ~5-6 fra nå).

**Spørsmål:** Hvordan håndterer appen kalender-data for å minimere
GDPR-byrde og lagring?

### Tre alternativer

- **A: Lagre alt selv** — full kontroll over data, mest funksjonalitet
  (offline, søk, historikk), men mest GDPR-byrde (hver families events
  i vår database, må kunne eksporteres + slettes per GDPR Art. 15/17).
- **B: Pass-through til Google/Apple** — minimal lagring (kun OAuth-
  tokens), men krever nett ved hver kalender-rendering, og fungerer
  ikke for familie-felles events som ikke eksisterer i en ekstern
  kalender.
- **C: Hybrid — pass-through for personlig, lokal for familie-felles** —
  personlige events leses live fra Google/Apple ved hver visning;
  familie-felles events (ukemøte, barnebursdag, felles middag) lagres
  i vår database.

**Christers preferanse:** **C (hybrid).**

### Tekniske implikasjoner

- Pass-through krever live API-kall ved hver kalender-rendering — må
  være rask nok for daglig bruk.
- **Cache-strategi** (~5 min minne-cache) trolig nødvendig for UX —
  ellers vil "I dag"-fanen og uke-visningen føles tregere enn
  forventet. Cache-invalidering ved eksplisitt refresh-handling.
- **OAuth-tokens må fortsatt lagres** (refresh + access tokens per
  bruker per provider). Det er minimal data og dekkes av ordinær
  kryptografisk lagring i database.
- **Familie-events trenger egen modell** — ny tabell
  `family_events(id, family_id, title, starts_at, ends_at, location?,
  notes?, created_by_member_id, ...)` med scoping på `family_id` på
  samme måte som øvrige tabeller.

### GDPR-implikasjoner

- Hybrid betyr at personvernerklæringen kan si **"personlige events
  lagres ikke hos oss"** — vi har kun et flyktig OAuth-token og en
  cache som tømmes per request. Det er en betydelig fordel både
  juridisk og kommunikasjonsmessig.
- **Familie-events må fortsatt dekkes** (eksport/sletting per Art. 15/17),
  men antallet er lavt (typisk få events per uke) og innholdet er
  minimalt sammenlignet med en full kalenderhistorikk.
- Krysser med entry **"Data-retensjon for inaktive familier"** ovenfor:
  hva skjer med en families lagrede `family_events` når familien
  defineres som inaktiv? Sletting-kaskade må tas med når den entryen
  besvares.

### Praktiske spørsmål for Fase 2

- **Hvordan skille personlig vs familie-felles event i UI?** Egne
  faner? Farge-koding? Toggle-filter? Dette påvirker tillit til at
  "personlige" virkelig holdes utenfor vår database.
- **Hvilken kalender-tjeneste er primær?** Google er allerede valgt
  som primær per **B6**-svaret (uke 2-beslutninger ovenfor — "bare
  Google", Apple CalDAV utsatt 3-4 uker). Hybrid-modellen påvirker
  ikke det valget; pass-through fungerer for både Google og Apple
  når den tid kommer.
- **Sync-strategi for offline-bruk?** Pass-through fungerer dårlig
  uten nett. To alternativer for offline:
  1. Service Worker cacher siste vellykkede respons (begrenset, men
     gir "siste sett" ved manglende nett).
  2. Hybrid utvides til å kopiere personlige events til lokal cache
     med kort TTL (24t?) — men det undergraver "lagres ikke hos oss"-
     fortellingen og må vurderes opp mot GDPR-kommunikasjon.

### Status og timing

**Status:** Notert. Beslutning kreves før Fase 2-kalender implementeres
(uke ~5-6 fra nå per gjeldende plan).

**Timing:** før Fase 2-kalenderarbeidet startes. Hybrid-valget påvirker
datamodell (`family_events`-tabell), API-design (egne endepunkter for
familie-events vs proxy-endepunkter for personlige), og personvern-
erklæringens ordlyd.

**Anbefaling:** Bekreft hybrid-modellen formelt før Fase 2-arbeidet
starter, og dokumenter utfallet i `design/2026-04-redesign/extracted/
locked-decisions.md` slik at den ikke mistes mellom faser.

**Krysslenker:**
- **B6** (uke 2-beslutninger ovenfor): valg av Google som primær
  kalender-tjeneste.
- **Data-retensjon for inaktive familier** (denne filen): kaskade-
  sletting av `family_events` ved familie-deaktivering.
- `design/2026-04-redesign/extracted/locked-decisions.md` (når formelt
  bekreftet): plassering av hybrid-modellen som fase-låst beslutning.
