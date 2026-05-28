# Pending decisions — venter på Christer

**Sist oppdatert:** 2026-05-01 (BESLUTNING 4 — Mint kontrast-strategi —
markert RESOLVED etter Phase 3A WCAG-revisjon. Tre design-gaps oppfølginger
(MEDIUM tinted-badge, MEDIUM sm-button-touch, LOW PortionFactorSlider-label)
flyttet til `wcag-followups.md`. Tidligere oppdateringer: 2026-04-29
legacy `LOCAL_USER`-fallback i `server/auth/middleware.js` notert som
backend cleanup-arbeid for Sprint 6 / pre-Sprint 8 deploy etter rot-årsak-
funn under PR #77 hotfix; backup-arkitektur-utvidbarhet for fremtidig
ekstern backup notert til Sprint 8 ved oppstart av Sprint 3 / Fase 1e;
ESLint config-gap for `public/v2/`-build-artefakter notert etter
domain-rename-oppdagelse; audit-trail-utvidelse skjerpet til pre-pilot-
launch etter Christer-tilbakemelding på PR #71; Sprint 1 / Prompt 1
status-refresh tidligere samme dag — batch-2 markert merget, PR #59/#61
markert lukket; user-scoping + settings-arkitektur + AI-tier-entries lagt
til 2026-04-28 etter PR #56-lukking; kalender-arkitektur lagt til samme dag)

Dette dokumentet er en lokal huskelapp for beslutninger Christer må
ta. Primær-lokasjon for Master-plan-beslutninger er
`docs/master-plan-til-pilot-2026.md` (Christer-eid Del A) +
fase-spesifikke prompter i Del B (1-18). Tidligere uke-2-
beslutninger (Issue #62) og frontend-bug-analyse (PR #59) er
nå lukket — listet i historikk-seksjon nedenfor.

---

## ✅ BESLUTNING 4 — Mint kontrast-strategi (RESOLVED 2026-05-01)

**Master-plan-referanse:** Sprint 6 / Prompt 12 (WCAG 2.1 AA-revisjon).
**Branch:** `fix/wcag-revisjon`.

**Spørsmål:** Primary Button bruker `bg-mint text-ink-contrast` som
gir ~3:1 kontrast i light mode — under WCAG AA 4.5:1 for body-text.
Tre alternativer ble vurdert:

- **A: Mørkere mint i light mode** ← VALGT
- B: Bytte primary-button til mint-deep
- C: Hardkodet mørk tekstfarge på primary

**Beslutning:** Alternativ A. Bevarer visuell identitet (mint-grønt
forblir mint-grønt), fixer kontrast systemisk uten å endre design-
system-pattern.

**Implementasjon:**
- `--mint` light mode: L=0.58 → L=0.50
- `--mint-deep` light mode: L=0.45 → L=0.38 (hover)
- `--mint-deep` dark mode: L=0.55 → L=0.62 (også fikset, hover-state
  i dark mode var også under AA på 4.35:1)
- Tilført `--coral-deep` og `--rose-deep` i light mode for error/
  destructive tekst på canvas
- 23 matematiske kontrast-tester låser tokens i `client/src/app/
  styles/contrast.test.ts`
- 35 jest-axe-tester låser komponenter og skjermer

**Krysslenker:**
- Analyse: `docs/analyses/2026-05-01-fase-3a-wcag.md`
- Compliance-status: `docs/runbooks/wcag-compliance.md`
- Oppfølginger (MEDIUM/LOW): `docs/workflow/wcag-followups.md`
- Design-gaps: oppdatert (entry flyttet til Løste gaps)

---

## ✅ Batch 2 — merget i PR #65 (2026-04-22)

**Status:** Avsluttet. Branchen `batch-2` ble merget via PR #65
*"Batch 2: B7 per-member diet + PR #59 fix + B2/Portainer docs"*
2026-04-22T20:51:46Z. Lokal-branchen ble slettet under repo-
cleanup Runde C (2026-04-28).

**Innhold som landet:**
- Gruppe A: Portainer SESSION_SECRET deploy-gate (docs)
- Gruppe B: B2 LLM felles Ollama (RUNBOOK §13)
- Gruppe C: PR #59 frontend empty-cart fix (3-lags defensiv)
- Gruppe D: B7 per-medlem diett backend (migrasjon 020 + tre-lags
  filter + endpoints)

Den eksakte push-frasen "nå pusher vi batch 2" ble brukt av
Christer for å utløse pushen, og PR #65 ble merget av Christer
samme dag.

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

## ✅ Frontend-bug-fix landet i PR #65 (2026-04-22)

PR #59 (`[ANALYSE] empty shopping list UI bug`) ble lukket etter
at fixen landet i Batch 2 (PR #65). De 5 opprinnelige spørsmålene
ble besvart i analyse-arbeidet, hypotesen ble valgt, og en
3-lags-defensiv fix ble inkludert i Gruppe C av batch-2.

Full historikk: https://github.com/ChristerFrestad/FamilyAssistant/pull/59

---

## ✅ Uke-2-sekvens utført (Sprint 0)

Den opprinnelige uke-2-planen (B1-B7) er nå avsluttet:

1. ✅ **B1 multi-tenant aktivering** — landet i PR #64 (Batch 1).
2. ✅ **B5 `chore_completions`-tabell** — landet i PR #64.
3. ✅ **B7 per-medlem diett-datamodell** — landet i PR #65 (Batch 2).
4. **B3 Resend e-post** — utsatt til Sprint 7 / Prompt 16 i
   Master-planen til pilot.
5. **B4 Cloudflare Tunnel** — utsatt til Sprint 7 / Prompt 15.
6. **B6 Google Calendar** — bekreftet "kun Google" valg, men
   kalender-implementasjonen er utsatt til Sprint 5 / Prompt 10
   (med ny anbefaling om "kun familie-events" for pilot).
7. ✅ **B2 Ollama som felles LLM** — bekreftet, ingen kode-endring
   nødvendig, dokumentert i RUNBOOK §13 via Batch 2.

Master-plan-en (Sprint 1-8 mot pilot 24. juni 2026) tok over fra
2026-04-29 etter Fase 1b ble merget (PR #68).

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
    allerede på utviklermaskin per AGENTS.md DEL 7.8) — enklere,
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

---

## User-scoping innenfor Family (Fase 1e / Fase 2)

Notert 2026-04-28 etter lukking av PR #56 ("feat(users): per-user
scoping within Family (planning stage)") som bare inneholdt CRLF-
line-ending-normalisering. PR-bodyen skisserte 5 fremtidige tema —
kalender-arkitektur og gamification (`chore_completions`) er
allerede dekket andre steder; user-scoping, settings-arkitektur og
AI-tier-modell formaliseres her som egne pending-decisions.

**Spørsmål:** Hvordan skiller vi data som er felles for hele
familien (handleliste, ukemeny, husholdnings-events) fra data som
er knyttet til ett enkelt familiemedlem (personlige preferanser,
diett-tagger, gamification-progresjon, AI-historikk)?

### Foreløpige observasjoner

- **Per-medlem-diett er allerede implementert** (B7-arbeidet,
  `migration 020`, `family_profile_members`-tabell). Det er
  presedens for at "familien har medlemmer hver med sine egne
  attributter".
- **Ingen `users`-tabell ennå.** Dagens auth-modell bruker en
  `family_id` per innloggings-sesjon, ikke en `user_id`. Multi-
  tenant-arkitekturen (B1) skiller på `family_id`-nivå.
- **`chore_completions`-tabellen** (B5/gamification-fundament)
  trenger en `member_id` eller `user_id` for å spore hvem som
  faktisk gjorde hva. Dette tvinger fram beslutningen i nær
  fremtid.
- **Auth-frys i `AGENTS.md` DEL 6** krever eksplisitt unntak for
  ny user-scoping — beslutningen må tas før implementasjon.

### Tre alternativer

- **A: Hold `family_id` som eneste enhet** — tilføy `member_id`
  som lett FK-referanse i tabeller som trenger det
  (`chore_completions.completed_by_member_id`, etc.). Ingen
  `users`-tabell. Enkleste vei, men begrenser hva en "personlig
  innstilling" kan være.
- **B: Innfør `users`-tabell med login-credentials per medlem** —
  hver person har egen e-post/magic-link, egne preferanser, egen
  gamification-progresjon. Krever auth-flyt-utvidelse i Fase 1e
  og tett samspill med RLS-arkitekturen.
- **C: Hybrid** — beholde delte family-credentials (én magic-link
  per familie), men la hver familie velge egen "stemme/avatar"
  ved login (medlem-velger). Personlig data sporer mot
  `member_id`, ikke `user_id`. Lavere onboarding-friksjon, men
  introduserer "rolle-bytting"-konsept som er uvanlig for
  husholdnings-apper.

**Status:** Ikke besluttet. Krever beslutning før Fase 1e (auth)
ferdigstilles, og senest når gamification-features skal vise
"hvem fullførte oppgaven".

**Timing:** Anbefalt diskusjon under planleggings-fasen for Fase
1e (~2-3 uker fra nå).

---

## Settings-arkitektur: system / family / user (Fase 2)

Notert 2026-04-28 (samme bakgrunn som user-scoping ovenfor).

**Spørsmål:** På hvilket nivå lagres en gitt innstilling, og
hvordan presenteres innstillinger i UI-et slik at brukeren forstår
hva de endrer?

### Tre nivåer

- **System-nivå** — administrert av Christer/host, gjelder hele
  installasjonen (f.eks. LLM-endepunkt, default backup-policy,
  feature-flagg).
- **Family-nivå** — gjelder hele husholdningen (f.eks. valgt
  meal-plan-strategi, Kassal.app-API-nøkkel,
  `chores_allowed_days` per migration 017, dietary preferences
  som er familiens "default").
- **User-nivå** — kun gyldig for den innloggede brukeren
  (personlige notifikasjons-preferanser, individuelle
  diett-tagger, theme-preferanse, språk-preferanse for i18n).

### Beslutninger som må tas

1. **Hvor flytter Kassal.app-nøkkelen?** Den er i dag
   family-konfig per `family_profile.kassalapp_token`. Bør den
   forbli der, eller flyttes til system-nivå (Christer setter for
   alle) eller user-nivå (hver person har egen)?
2. **Hvilke innstillinger MÅ være user-nivå** for å unngå at en
   person overskriver en annen sin preferanse? (Kandidater:
   theme, varslings-modus, språk, individuell diett.)
3. **UI-modell:** Én Settings-side med tre tabs (System / Family
   / Min profil)? Eller tre helt separate inngangsporter? Påvirker
   informasjonsarkitektur i AppShell (Fase 1d).

**Status:** Ikke besluttet. Avhengig av user-scoping-beslutningen
ovenfor.

**Timing:** Settings-UI er Fase 2-arbeid, men datamodellen må
låses før Fase 1e (auth) for å unngå migrasjons-rebuild.

---

## AI-tilgang og tier-modell (post-pilot)

Notert 2026-04-28 (samme bakgrunn).

**Spørsmål:** Hvordan håndterer vi LLM-tilgang når vi går fra
single-pilot-deploy til flere familier, særlig hvis Christers
private Ollama ikke kan bære last fra alle?

### Tre nivåer av tilgang

- **A: Hver familie eier sin egen LLM-konfig** — krever at
  brukeren har Ollama lokalt eller egen API-nøkkel. Høyest
  tekniske kostnad for brukeren, men lavest drift-kostnad for
  Christer. Per-family-LLM-config eksisterer allerede i
  `migration 014`.
- **B: Felles Ollama hostet av Christer** — som per **B2**-
  beslutningen i uke 2 (Issue #62 — `LLM-strategi → (a) min Ollama
  som felles ressurs`). Vurdert som passende for 5 pilot-familier
  med moderat bruk. Skalering ukjent.
- **C: Tier-modell** — gratis (Ollama, lavere kvalitet, kvota)
  vs betalt (ekstern API som GPT-4/Claude, høyere kvalitet, ingen
  kvota). Krever betalings-integrasjon (Stripe?) og kvota-
  håndtering.

**Status:** B er valgt for pilot (uke 2-beslutninger). C er en
post-pilot-vurdering hvis pilot-data viser at:
1. Kvaliteten på Ollama er utilstrekkelig for noen brukere, eller
2. Lasten på Christers RPI/server blir uholdbar med vekst.

**Timing:** Vurderes etter pilot-fase (uke ~12+ per
`pre-deploy-cleanup-plan.md`). Krever betalings-leverandør-
beslutning og kvota-tall.

**Krysslenker:**
- **B2** (uke 2-beslutninger ovenfor): nåværende valg av Ollama
  som felles ressurs.
- `migration 014` (per-family LLM-config): datamodell-fundament
  hvis tier-modellen velger å tillate familie-spesifikk override.

---

## Audit-trail-utvidelse — kreves før pilot-launch

Notert 2026-04-29 etter Christers tilbakemelding på PR #71
("Backend security foundation"). Audit-rapporten i
`docs/workflow/backend-security-audit-2026-04.md` flagget at fem
kritiske handlinger pino-logges men ikke er wrapped i `withAudit()`
mot `audit_log`-tabellen. Originalt forslag var å adressere dette
i pre-deploy-cleanup uke 10-11. Christer har overstyrt: dette skal
være på plass **før pilot-launch**, uavhengig av at pilot kun har
én familie. Sikkerhets-disiplin gjelder uansett pilot-størrelse.

### Konkret arbeid før pilot-launch (Sprint 8 / Prompt 18)

Wrap eller introducer-equivalent for fem auth/family/GDPR-routes
slik at de skriver til `audit_log`-tabellen (migration 012):

| Handling | Endpoint | Entity-type |
|----------|----------|-------------|
| Login (success) | `GET /api/auth/magic-link/verify`, `GET /api/auth/google/callback` (post-pilot) | `session` (id = nye sessionId) |
| Login (fail) | Samme to endepunkter ved 401-respons | `session_attempt` (id = email-hash) |
| Logout | `POST /api/auth/logout`, `POST /api/auth/logout-all`, `DELETE /api/auth/sessions/:id` | `session` (id = invalidert sessionId) |
| Magic-link generert | `POST /api/auth/magic-link/start` ved 200-respons | `magic_link` (id = token-hash) |
| Family-data eksportert | `GET /api/me/export` | `gdpr_export` (id = user-id) |

For hver av disse: `withAudit({ entityType, getEntityId, ...})`-
wrapping eller direkte `repos.auditLog.record(...)`-kall i handler-
laget. Mønsteret eksisterer allerede via 5 wrappet routes i
`server/routes.js`, så det er reproduksjon av etablert struktur,
ikke ny arkitektur.

### Hvorfor strengere timing enn pre-deploy

- **GDPR Art. 30 record-of-processing** krever strukturert logg av
  personverns-relaterte handlinger (login, sletting, eksport). Pino-
  logger med ad-hoc-format dekker incident-response-formål, men
  `audit_log` er filteret som inspektør får når de ber om revisjons-
  underlag.
- **Pre-pilot security-disiplin** (Christers prinsipp): én familie er
  fortsatt en familie med personvern-rettigheter. Senere familier
  arver feilen hvis vi venter.
- **Design-konsistens med eksisterende pattern**: 5 routes wrappes
  allerede i `routes.js`. Å la auth/GDPR-routes gå unna pattern er
  inkonsistent.

### Estimert arbeid

Halvdag per route × 5 = ~3 dager. Kan splittes opp eller landes som
del av selve pilot-launch-PR-en (Sprint 8 / Prompt 18).

### Akseptansekriterier

- [ ] `audit_log`-tabellen har rader for hver av de fem hendelses-
      typene etter en pilot-test-runde
- [ ] Tester verifiserer at hver wrapped route legger inn en
      audit-row på success (og failure for login-fail-tilfellet)
- [ ] Pino-logger fjernes ikke — de fortsetter som operativ
      observability; `audit_log` er for compliance og forensics

### Status

**Aktiv beslutning.** Skjerpet timing kommunisert mot original
audit-rapport. Inn i Sprint 8 (Prompt 18, pilot-launch).

**Krysslenker:**
- `docs/workflow/backend-security-audit-2026-04.md` §3 — audit-trail-
  seksjonen som spesifiserer dagens dekning og gap.
- `server/migrations/012_audit_log.sql` — `audit_log`-tabell.
- `server/routes.js:87` — `withAudit()`-pattern.
- `server/repositories/system.repo.js:464` — `auditLog.record(...)`-
  implementasjon.

---

## ESLint config-gap for `public/v2/` build-artefakter

Notert 2026-04-29 etter domain-rename-fix (commit `bc5df48`). Ble
oppdaget da lokalt `npm run lint` returnerte 223 errors mot
`public/v2/assets/main-*.js` mens CI samtidig var grønn — fordi
build-artefaktene ikke finnes i CI før lint kjøres.

**Problem:** `public/v2/assets/main-*.js` er minified produksjons-
bundle generert av `npm run build:client`. Filen er gitignored (se
`.gitignore`-blokken `# Kilde er client/; bygget er midlertidig og
skal ikke i git.` + `public/v2/`), men ESLint leser ikke `.gitignore`
og har ikke `public/v2/**` i sin egen `ignores`-liste i
`eslint.config.mjs`.

**Konsekvens:** Falske lint-feil forurenser `npm run lint`-output
lokalt etter hver `build:client`-kjøring (som skjer både ved
manuelle smoke-tester og som CI-verifisering før commit). Utvikleren
må enten (a) slette `public/v2/`-bygget før hver lint-kjøring, eller
(b) lære å ignorere de spesifikke artefakt-feilene visuelt — begge
deler er friksjon som ikke burde eksistere.

### Fix

Legg `public/v2/**` til `ignores`-listen i `eslint.config.mjs` (linje
13-21):

```js
ignores: [
  'node_modules/**',
  'data/**',
  'backups/**',
  'coverage/**',
  'public/index.html',
  'public/dist/**',
  'public/v2/**',  // ← LEGG TIL
  '.claude/**',
],
```

Trivialt to-linjers diff. Ingen test-impact.

### Status

**Notert.** Fixes som del av Sprint 6 pre-deploy cleanup (Prompt 14),
eller tidligere hvis det blir irriterende under løpende utvikling.

### Krysslenker

- `eslint.config.mjs` linje 13-21 (ignores-blokken)
- `.gitignore` (har allerede `public/v2/`)
- Domain-rename-commit `bc5df48` (avdekket gapet)

---

## Backup-arkitektur skal være utvidbar for fremtidig ekstern backup

**Notert:** 2026-04-29 ved oppstart av Sprint 3 / Fase 1e (Auth-flyt).
**Sprint:** 3 (notert) — implementeres i Sprint 8 (Prompt 17).
**Besluttet av:** Christer.

### Kontekst

For pilot kjøres backup lokalt på RPi5 (tirsdager 03:00, 14-dagers
retensjon — `BACKUP_HOUR` + `BACKUP_KEEP_DAYS` i `server/config.js`,
implementert via `server/backup.js`). Post-pilot vil vi sannsynligvis
legge til ekstern backup — cloud-tjeneste (Backblaze B2, S3, Hetzner
Object Storage), off-site RPi5 hos venner/familie, eller annen
geografi-spredt lokasjon.

### Beslutning

Backup-systemet (Sprint 8 / Prompt 17) implementeres med
**`BackupTarget`-pattern** (eller tilsvarende abstraksjon) slik at
nye targets kan legges til som config-endring, ikke
arkitektur-omskriving senere.

Konkret pattern:

```js
// Interface som hver target må implementere:
interface BackupTarget {
  upload(filePath: string, name: string): Promise<{ ok: boolean }>
  list(): Promise<Array<{ name: string; size: number; uploadedAt: string }>>
  delete(name: string): Promise<{ ok: boolean }>
}
```

Sprint 8 implementerer kun `LocalBackupTarget` (skriver til
`/app/data/backups/`). Pattern + interface gjør at fremtidige
targets — `S3BackupTarget`, `B2BackupTarget`, `RPiBackupTarget`,
`SshBackupTarget` — kan introduseres som drop-in-replacements via
env-vars (f.eks. `BACKUP_TARGETS=local,s3` med `S3_BUCKET=...`,
`S3_ACCESS_KEY=...`, etc).

### Hva som IKKE er i scope for Sprint 8

- Ingen S3-credentials, B2-credentials eller cloud-konfig i pilot-
  branch eller pilot-deploy.
- Ingen GCP-/AWS-/Backblaze-SDK-er i `dependencies` — kun pattern.
- Ingen secrets-management-flyt (Vault, AWS Secrets Manager, etc.).
- Ingen target-specific encryption beyond what already runs locally
  (SQLite-fil + 0600 permissions).

### Implementation når Sprint 8 aktiveres

- Sprint 8 implementerer `LocalBackupTarget` med pattern intakt.
- Eksisterende `server/backup.js`-kode refaktoreres til å gå
  gjennom interface-en (ikke direkte fil-skriving).
- Tester verifiserer at interface-kontrakten holder for
  `LocalBackupTarget` (insert, list, delete, prune).
- Post-pilot beslutning (separat entry når den tid kommer):
  hvilken ekstern target velges først og hvilke credentials.

### Hvorfor pattern + ikke direkte implementasjon nå

- Open-source-distinksjon: andre forks vil ha andre backup-behov
  (cloud, off-site, NAS, etc.). Pattern lar dem legge til uten
  å re-arkitektonere.
- `server/backup.js` er allerede en del av kjerne-arkitekturen;
  retro-fitting interface senere er mer arbeid enn å designe det
  rett fra start.
- Christer's pilot-RPi5 er fysisk sikret (privat bolig), men
  pattern-en sikrer at andre deploys med svakere fysisk sikkerhet
  enkelt kan legge til off-site backup.

### Status

**Notert.** Implementeres i Sprint 8 (Prompt 17). Ingen blokkering
for Sprint 3-7.

### Krysslenker

- `server/backup.js` — eksisterende implementasjon (vil
  refaktoreres i Sprint 8)
- `server/config.js` — `BACKUP_HOUR`, `BACKUP_KEEP_DAYS`,
  `BACKUP_DIR` env-vars (utvides med target-spesifikke vars)
- Master-plan Del B Prompt 17 (Sprint 8)

---

## Legacy `LOCAL_USER` fallback i auth-middleware må fjernes før prod-deploy

**Notert:** 2026-04-29 etter rot-årsak-analyse av Sprint 3 routing-bug
(PR #77 hotfix B).
**Sprint:** Notert i Sprint 3 — adresseres i Sprint 6 (pre-deploy
cleanup, Prompt 14) eller senest før Sprint 8 prod-deploy
(Prompt 17).
**Besluttet av:** Christer.

### Kontekst

`server/auth/middleware.js:144-147` har en legacy-fallback fra
single-tenant-arkitekturen:

```js
// Legacy dev fallback: no AUTH_TOKEN configured and no session →
// allow as local user. This preserves the existing
// unauthenticated local dev flow.
if (!config.AUTH_TOKEN) {
  attachLocalUser(ctx);
  return;
}
```

Når serveren kjører uten `AUTH_TOKEN` (lokal dev, eller hvis et
prod-deploy ved en feil mangler env-var-en), attaches en syntetisk
`LOCAL_USER` med `family_id=1`, `role=owner`, `_synthetic=true` på
`ctx`. `/api/auth/me` returnerer dette som `authenticated: true`,
`synthetic: true`, `onboardingCompleted: false`.

I Sprint 3 / Fase 1e oppdaget Christer under manuell test at v2-SPA-en
behandlet syntetisk bruker som ekte autentisert → OnboardingGuard
sendte til `/onboarding/family` → `POST /api/onboarding/create-family`
returnerte 401 → bruker satt fast i loop. PR #77 hotfix B la inn
frontend-filter (`AuthContext.refreshUser` ignorerer
`synthetic: true`-respons), som løser brukeropplevelsen — men selve
fallback-en finnes fremdeles på backend.

### Hvorfor fallback-en må bort før pilot/prod

1. **Defense-in-depth:** Frontend-filteret er én linje med kode som
   en fremtidig refaktor kan fjerne uten at noen ser regresjonen
   før neste manuelle test. Backend skal aldri returnere `synthetic`-
   bruker som autentisert i et auth-aware deploy.
2. **Multi-tenant-isolasjon:** `LOCAL_USER` har hardkodet `family_id=1`.
   Hvis fallback-en aktiveres ved en feil i prod (mistet env-var,
   regresjon i config-validation), får én anonym bruker tilgang til
   pilot-familiens data.
3. **Audit-trail-renhet:** Eventuelle handlinger gjort av syntetisk
   bruker logges med id=0 og familiy_id=1, som forurenser audit-
   trail (se egen entry "Audit-trail-utvidelse").
4. **Forutsigbar dev-prod-paritet:** I dag oppfører `npm start` seg
   forskjellig avhengig av om `AUTH_TOKEN` er satt — det gjør at
   bugs som denne kan slippe forbi lokal manuell test fordi dev-
   modus dekker over symptomet.

### Tre alternativer

- **A: Fjern fallback-en helt.** Hvis `AUTH_TOKEN` ikke er satt OG
  ingen session-cookie OG endpoint krever auth → 401. Mest
  konservativt, kan kreve at dev-flyten bruker `PILOT_BYPASS=true`
  eller magic-link-flyten istedenfor å treffe API-er anonymt.
  *Anbefales for prod.*
- **B: Eksplisitt opt-in via egen env-var.** F.eks.
  `LEGACY_LOCAL_USER_FALLBACK=true`. Default avslått; må eksplisitt
  skrus på ved RPi-installasjon som faktisk bruker single-tenant-
  modus. Ingen prod-deploy aktiverer den. Bevarer bakover-
  kompatibilitet for legacy single-tenant-installasjoner.
- **C: Prod-gate.** Behold fallback i `NODE_ENV !== 'production'`,
  fjern den når `NODE_ENV === 'production'`. Enkleste mulige
  fix; gjør at lokal dev fortsatt fungerer som før, men prod-
  deploy aldri har symptomet. *Lavest risiko hvis pilot kjører
  i prod-modus, hvilket den vil.*

### Sikkerhets-akseptanse-kriterium for løsningen

Uavhengig av valgt alternativ skal `/api/auth/me` returnere
`{ authenticated: false, user: null }` for en uautentisert request
i prod-modus — matcher hva frontend AuthContext forventer av en
auth-aware backend.

### Hva som IKKE er i scope for denne entryen

- Endring av eksisterende Bearer-token-flyt (RPi service mode med
  `AUTH_TOKEN`-header) — den fortsetter å fungere uavhengig av
  fallback-fjerning.
- Endring av `PILOT_BYPASS=true`-flyten — det er en separat
  eksplisitt opt-in for pilot-test og skal ikke fjernes før etter
  pilot-launch.
- Refaktor av `server/auth/middleware.js` for øvrig.

### Implementations-detaljer (når det aktiveres)

- **Tester:** legg til regresjons-test som bekrefter at
  `/api/auth/me` uten cookie OG uten `AUTH_TOKEN` returnerer
  `authenticated: false`. Tre miljø-permutasjoner:
  `NODE_ENV=development`, `NODE_ENV=production`,
  `PILOT_BYPASS=true`.
- **Audit:** kjøre fresh manuell smoke-test av v2-SPA i incognito
  etter fjerningen for å bekrefte at routing-flyten fortsatt
  fungerer (welcome → login → magic-link → onboarding → dashboard).
- **Frontend-cleanup:** etter at backend ikke lenger returnerer
  `synthetic`-bruker, kan vi vurdere om frontend-filteret i
  `AuthContext.refreshUser` skal beholdes som defense-in-depth
  eller fjernes som dødkode. Anbefaling: behold som defense-in-
  depth, kommentar oppdateres til å reflektere ny backend-
  oppførsel.

### Status

**Notert.** Planlagt for Sprint 6 / Prompt 14 (pre-deploy cleanup),
eller hvis ikke landet der, før Sprint 8 / Prompt 17 (prod-deploy).
Ingen blokkering for Sprint 4-5.

### Krysslenker

- `server/auth/middleware.js:99-152` — `createAuthenticate`-
  middleware, fallback-blokk på linje 144-147
- `server/auth/middleware.js:52-60` — `LOCAL_USER`-konstanten
- `client/src/app/auth/AuthContext.tsx:64-79` — frontend-filter
  (PR #77 hotfix B)
- `client/src/app/auth/authApi.ts:33-43` — `AuthUser`-type med
  `synthetic`-felt
- PR #77 — hotfix som la inn frontend-mitigering
- Audit-trail-utvidelse-entry (over) — relatert pre-pilot security
  cleanup
