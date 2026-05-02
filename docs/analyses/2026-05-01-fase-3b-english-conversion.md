# Fase 3B — Engelsk-konvertering av kode

**Dato:** 2026-05-01
**Sprint:** 6 av 8 (Fase 3B)
**Forrige fase:** Fase 3A WCAG (PR #85 merget)
**Branch:** `refactor/english-codebase` (opprettes etter scope-godkjenning)

---

## Reisen

Bakgrunn: CLAUDE.md DEL 7.1 + 7.7 spesifiserer engelsk codebase. Tidlig
prosjektfase aksepterte norske kommentarer som tech debt. Master-planen
har Fase 3B som dedikert pass for å rydde opp før pilot. Fase 3A
(WCAG) er ferdig — Fase 3B er nå.

Reisen for en fremtidig leser/bidragsyter (LLM eller menneske):

1. Åpner et tilfeldig kjerne-modul (f.eks. `pantry-resolver.service.js`)
   1.1. Ser kommentar-headers — hvis norsk, må parse mentalt eller bruke oversettelses-verktøy
   1.2. Ser logger-meldinger i norsk — vanskelig å søke i prod-logger
   1.3. Ser `throw new Error` i norsk — uklart om det er bruker- eller dev-vendt
2. Skriver ny kode i samme fil
   2.1. Følger eksisterende stil → produserer mer norsk → debt vokser
3. Eller skifter til engelsk → kodebase blir blandet → enda dårligere
4. Test-rapporter i CI viser describe/it-titler på norsk
   4.1. Vanskelig å lese i CLI hvis terminal ikke håndterer æøå
   4.2. Søk i test-output blir tungvint

Etter konvertering:

1. Alle kommentarer, logger og interne errors er på engelsk
2. Test-titler er på engelsk → CI-output blir konsistent
3. Variabel-/funksjons-navn forblir engelske (allerede sånn)
4. Bruker-vendt tekst forblir norsk via i18n (uberørt)
5. Seed-data og LLM-prompts forblir norske (funksjonell norsk)

---

## Audit-resultater

### Total norsk-tegn-omfang (æ/ø/å)

| Område | Tegn-hits | Filer |
|---|---:|---:|
| `server/` | 1020 | 71 |
| `client/src/` | 281 | 69 |
| `tests/` | 496 | 53 |
| `scripts/` | 22 | 7 |
| `public/` (legacy v1) | 243 | 23 |
| **Totalt** | **2062** | **223** |

### Kategorisering — hva skal konverteres

#### KRITISK (høyest prioritet)

| Kategori | Antall | Filer |
|---|---:|---:|
| `logger.*()` med norsk | 2 forekomster | 2 filer |
| `throw new Error()` med norsk | 11 forekomster | 5 filer |
| **Sub-total KRITISK** | **13 forekomster** | **5–7 filer** |

Filer:
- `server/services/kassal-client.service.js` (logger)
- `server/services/price-reference.service.js` (logger)
- `server/index.js` (Error)
- `server/services/circuit-breaker.js` (Error)
- `server/services/env-store.service.js` (Error × 4)
- `server/services/pantry.service.js` (Error × 2)
- `server/services/recipe-url-import.service.js` (Error × 3)

#### VIKTIG (kjerne-arbeid)

| Kategori | Antall linjer | Filer |
|---|---:|---:|
| Kommentar-linjer i `server/` | 413 | 52 |
| Kommentar-linjer i `client/src/` | 35 | 18 |
| Kommentar-linjer i `tests/` | 189 | 39 |
| Kommentar-linjer i `scripts/` | 14 | 5 |
| Inline-kommentarer (`code(); // norsk`) | 13 | 10 |
| Test `describe`/`it`/`test`-blokker med norsk | 80 forekomster | 30 |
| **Sub-total VIKTIG** | **~744 linjer/forekomster** | **~110 filer (overlapp)** |

#### LAVT (skal IKKE konverteres)

| Kategori | Antall | Begrunnelse |
|---|---:|---|
| i18n locale-filer (`no/*.json`) | ~93 hits, 8 filer | Locale-data, definert som norsk |
| Seed-data (`server/seed.js`) | ~269 hits, 1 fil | Bruker-vendt produktnavn/kategorier |
| LLM-prompt-strenger (`server/llm.js`) | ~34 hits, 1 fil | Funksjonelle norske LLM-instruksjoner |
| Migration SQL-kommentarer | ~65 linjer, 13 filer | **Sjekksum-risiko ved Portainer-oppstart** |
| Public/v1 legacy (`public/**`) | ~243 hits, 23 filer | Skal erstattes av v2 — utenfor scope |
| Test-fixturer med norske produktnavn | mange | Test-data er norsk per design |
| Avatar.tsx demo-data (`'Æsop'`, `'åse øystein'`) | 2 linjer, 1 fil | Demonstrerer æøå-støtte i avatar-initialer |
| **Sub-total LAVT** | **~706 hits** | **Bevares** |

### Variable/funksjons-navn

**0 funn** med æøå i identifikatorer på tvers av server/, client/src/,
tests/ og scripts/. Bekrefter forrige audit (2026-04-29) — kjerne-
identifikatorer er allerede engelske.

### Database-skjema

- 0 kolonner med æøå
- 0 tabeller med æøå
- 0 ENV-vars med æøå
- Alle DB-felt er engelske (`family_id`, `created_at`, `expires_at`, …)

**Konklusjon:** Ingen migration trengs. Ingen Portainer-risiko fra DB-
endringer.

### API-felt

- 0 API-felt-navn på norsk
- Alle JSON-respons-felt er engelske
- Alle request-validering-schemas (Zod) bruker engelske keys

**Konklusjon:** Ingen breaking change for API-konsumenter.

---

## Edge-cases

1. **`throw new Error('Verdi må være en streng')`** bobler opp til
   klient via routes. Konvertering til engelsk = klient ser engelsk
   feilmelding hvis den ikke fanges av i18n-fallback.
   - **Mitigering:** Verifiser at v2-frontend håndterer disse via
     generisk error-toast, ikke direkte visning. Loggfør som
     i18n-kandidater i `docs/workflow/i18n-error-candidates.md`.

2. **Inline-kommentar `// Lørdag: helg-retter` i `seed.js`**
   refererer til ukedag-indeks 5 (lørdag = lokalisert begrep).
   - **Mitigering:** Konverter kommentar (`// Saturday: weekend dishes`)
     selv om dataen er norsk — kommentaren er developer-leselig.

3. **Test-titler refererer til norske domene-begreper**
   (`'Lørdag'`, `'helgeretter'`).
   - **Mitigering:** Konverter til engelsk metadata, behold norske
     test-fixturer som data-input.

4. **`server/llm.js` har norske prompt-strenger** for å instruere
   LLM-en om å svare på norsk.
   - **Mitigering:** IKKE konverter prompt-tekst — den er funksjonelt
     norsk. Konverter kun JS-kommentarer rundt prompten.

5. **Migration-filer kan endres i tekst-kommentar uten å påvirke SQL-
   binæren**, men `server/migrations/index.js` kan validere via
   sjekksum.
   - **Mitigering:** Sjekk migrations-validering. Hvis sjekksum
     valideres → IKKE konverter migrations. Hvis ikke validert → kan
     konverteres lavrisiko, men anbefaler å la være pga sporbarhet.

6. **Avatar.tsx demo-data `'Æsop'`, `'åse øystein'`** demonstrerer
   æøå-håndtering i avatar-initialer.
   - **Mitigering:** IKKE konverter — eksempelet er nettopp meningen
     å vise norsk-støtte.

7. **Pre-existing ESLint-warnings i `routes.js`** (3 stk fra B7-arbeid).
   - **Mitigering:** Ikke i scope for 3B. Kan håndteres separat senere.

8. **Multi-tenant frys (DEL 6) gjelder `server/auth/`**.
   - **Mitigering:** Endringer her (selv kommentar-konvertering) krever
     DEL 5.3-flyt (Christer-godkjent merge). Per audit har bare
     `server/auth/routes.js` 1 hit — minimal kontakt med frosset kode.
     Anbefaler å ekskludere `server/auth/` fra denne PR-en.

---

## Konsekvenser på tvers

### Frontend (`client/src/`)
- 35 kommentar-linjer i 18 filer — minimal scope
- Ingen i18n-key-endringer (bevares)
- Ingen runtime-effekt
- Tester må fortsatt passere

### Backend (`server/`)
- 413 kommentar-linjer i 52 filer
- 13 KRITISKE forekomster (logger + Error)
- Ingen API-kontrakt-endringer
- Tester må fortsatt passere

### Tester (`tests/`)
- 189 kommentar-linjer i 39 filer
- 80 `describe`/`it`/`test`-titler i 30 filer
- Tester selv må fortsatt passere

### Scripts (`scripts/`)
- 14 kommentar-linjer i 5 filer
- Smale CI/dev-script — minimal risiko

### Bevart (utenfor scope)
- `public/` legacy v1 (243 hits)
- `server/seed.js` produktdata (269 hits)
- `server/llm.js` LLM-prompts (34 hits)
- `server/migrations/*.sql` (65 hits, sjekksum-risiko)
- `client/src/app/i18n/locales/no/*.json` (locale-data)
- `client/src/dev/preview/sections/components/Avatar.tsx` demo-data
- `server/auth/` (DEL 6 frys)

---

## Beslutninger

### BESLUTNING 1: Scope for konvertering

**ANBEFALING:** Tier 1 + Tier 2 (KRITISK + VIKTIG) i én PR.

**Konkret scope:**
- 13 KRITISKE forekomster (logger + Error)
- 651 kommentar-linjer over 114 filer (alle 4 områder, utenom unntak)
- 13 inline-kommentarer
- 80 test-titler

**HVORFOR:** Hele Fase 3B er definert som engelsk-konvertering.
Splitting i flere PR-er fragmenterer arbeidet. Endringene er mekaniske
(ingen logikk-endring) → lavrisiko å samle. Tester verifiserer at
ingen oppførsel endres.

**ALTERNATIVER:**
- A: Bare KRITISK (13 forekomster) — for lite, rester av norsk forblir
  som debt
- B: Alt inkludert migrations + legacy public/ — for mye risiko
  (sjekksum + scope-utvidelse)
- C: Splitt i tre PR-er (KRITISK / kommentarer / tester) — overhead
  uten risiko-gevinst

**KONSEKVENS HVIS ANNERLEDES:** Hvis bare KRITISK velges, må
fremtidig PR rydde resten — dobbel review og dobbel CI-kost.

### BESLUTNING 2: Migration-kommentarer

**ANBEFALING:** IKKE konverter migration SQL-kommentarer.

**HVORFOR:** Migration-filer behandles som immutable historisk
artifact. Edits kan endre fil-sjekksum og påvirke
`server/migrations/index.js` sin run-once-tracking. Risiko = Portainer-
oppstartsfeil ved deploy.

**ALTERNATIVER:**
- A: Konverter alle 65 SQL-kommentarer i 13 migrations — sjekksum-
  risiko, ikke verdt det
- B: Tilføy nye migrations som "kommentar-only" — meningsløst
- C: La være (anbefalt)

**KONSEKVENS HVIS ANNERLEDES:** Risiko for at deploy feiler i
Portainer hvis sjekksum-validering trigger på endrede filer.

### BESLUTNING 3: `throw new Error` i services

**ANBEFALING:** Konverter til engelsk + loggfør som i18n-kandidater
i `docs/workflow/i18n-error-candidates.md`.

**HVORFOR:** Strenger i `throw new Error` er ikke i klar i18n-fil
ennå. Engelsk er developer-konvensjon (DEL 7.1). Hvis disse senere
skal vises bruker-vendt, må de gjennom i18n — det er en separat
oppgave fra denne PR.

**ALTERNATIVER:**
- A: La det være på norsk — bryter konvensjon
- B: Konverter direkte til i18n-keys i samme PR — utvider scope og
  krever frontend-håndtering
- C: Konverter til engelsk + loggfør i18n-kandidat (anbefalt)

**KONSEKVENS HVIS ANNERLEDES:** Hvis kun (B), denne PR-en blir
betydelig større og mer risikabel. Hvis (A), bryter vi DEL 7.7
("ingen ny tech debt fra dette punktet").

### BESLUTNING 4: `server/auth/` — DEL 6 frys

**ANBEFALING:** Inkluder kun `server/auth/routes.js` (1 norsk hit) og
behandle som DEL 5.3-flyt (Christer-godkjent merge).

**HVORFOR:** Soft-thaw per 6.1b tillater endringer i `server/auth/`,
men krever Christer-godkjenning. Konvertering av 1 norsk tegn (line-
start `*`-kommentar) er trivielt og ikke verdt egen PR.

**ALTERNATIVER:**
- A: Inkluder hele `server/auth/` — minimal kontakt, men krever
  godkjenning
- B: Ekskluder fra denne PR — gir 1 line med norsk debt igjen
- C: Inkluder bare den ene linjen i `routes.js` (anbefalt)

**KONSEKVENS HVIS ANNERLEDES:** Trivielt — vi snakker om 1 linje.
Hvis ekskludert, en fremtidig "rydde opp resten"-PR må håndtere
dette uansett.

### BESLUTNING 5: Test-fixturer med norske produktnavn

**ANBEFALING:** Behold norske produktnavn i test-fixturer.

**HVORFOR:** Test-data simulerer norsk-pilot-bruk. Engelske
produktnavn ville være urealistisk. CLAUDE.md 7.1 sier "Tester:
engelsk" om kode/struktur, ikke fixture-data.

**ALTERNATIVER:**
- A: Konverter også fixturer — urealistiske test-scenarier
- B: Behold fixturer (anbefalt)

**KONSEKVENS HVIS ANNERLEDES:** Tester kan miste sin domene-realisme.

---

## Portainer-oppstartsrisiko-sjekk

Berører endringen:
- `Dockerfile` eller `.dockerignore`? **Nei**
- `docker-compose.yml`? **Nei**
- `server/http/bootstrap.js`? **Nei** (filen finnes ikke i denne kodebasen)
- `server/config.js` oppstartsvalidering? **Mulig** (hvis kommentarer
  konverteres). Kun kommentarer, ingen logikk-endring. Lavrisiko.
- `server/index.js` startup-sekvens? **Nei** (kun 1 Error-melding +
  3 kommentarer endres, oppstart-flyt urørt)
- `server/db.js` eller `server/migrations/**`? **Nei** (eksplisitt
  ekskludert per BESLUTNING 2)
- `install.sh`? **Nei**
- `bootstrap.json`-lesning eller -skriving? **Nei**
- Miljøvariabel-krav? **Nei**

**Konklusjon:** Ingen Portainer-risiko. Ingen DEL 3 Steg 3b-prosedyre
trengs.

---

## ISO 25010-påvirkning

| Karakteristikk | Før | Etter | Endring |
|---|---:|---:|---|
| Maintainability — readability | 8.5 | 8.7 | +0.2 (engelsk er konvensjon for FOSS-bidrag) |
| Maintainability — analyzability | 8.4 | 8.5 | +0.1 (CI-output mer søkbart) |
| Functional suitability | 8.7 | 8.7 | uendret (ingen logikk-endring) |
| Reliability | 8.6 | 8.6 | uendret (tester urørt) |
| Security | 8.4 | 8.4 | uendret (auth/Sentry urørt) |
| Performance | 8.5 | 8.5 | uendret |
| Compatibility | 8.4 | 8.4 | uendret (i18n bevart) |
| Portability | 8.5 | 8.5 | uendret |
| Usability | 8.6 | 8.6 | uendret (bruker-vendt tekst urørt) |

**Snitt:** ~8.55 → ~8.58 (+0.03). Ingen karakteristikk trekkes
under 8.0.

---

## Plan (commits)

Forutsatt scope-godkjenning fra Christer:

1. **`docs(analysis): add Fase 3B English conversion analysis`**
   — denne filen som analyse-commit (under 200 linjer er ikke
   relevant for analyse-doc).

2. **`refactor(server/services): translate logger and Error
   strings to English`**
   — 13 KRITISKE forekomster i 5–7 service-filer.

3. **`refactor(server): translate code comments to English`**
   — 413 linjer kommentar-konvertering i 52 filer (utenom seed.js
   prompts og llm.js prompts som er funksjonelt norske).

4. **`refactor(client/src): translate code comments to English`**
   — 35 linjer i 18 filer.

5. **`refactor(tests): translate describe/it titles and comments
   to English`**
   — 189 kommentarer + 80 titler i 30+39 filer.

6. **`refactor(scripts): translate code comments to English`**
   — 14 linjer i 5 filer.

7. **`docs(workflow): log i18n error-string candidates for future
   migration`**
   — Opprett `docs/workflow/i18n-error-candidates.md` med liste
   over Error-strenger som kan vurderes i18n-migrert senere.

8. **`docs(log): add Fase 3B sluttrapport to AGENT_LOG.md`**
   — Sluttrapport per DEL 8.

**Estimat:** 1–1.5 dager grundig oversettelse + verifikasjon.

---

## Kompleksitet-vurdering

Christer's `CONTEXT.md` har ikke eksplisitt estimat for denne fasen,
men master-planen lister Fase 3B som dedikert pass. Audit bekrefter at
arbeidet er omfattende (~110 filer) men mekanisk (ingen logikk-endring).

**Klassifisering:** Mellomstor — rettferdiggjør egen branch + PR
(ikke "liten"-kategori per DEL 11).

---

## Test-strategi

- Ingen nye tester trengs (mekanisk konvertering, ingen ny logikk)
- Eksisterende tester må passere på samme måte før og etter
- Spesifikt: `tests/phase21-repo-hygiene.test.js` (policy-test) sjekker
  ikke språk på kommentarer — kun fil-struktur
- `client/src/**/*.test.tsx` — alle 770+ tester må passere
- `tests/**/*.test.js` — alle 1293+ tester må passere
- Test-titler kan endres (engelsk) uten å bryte test-løperen

---

## Sikkerhets-sjekkliste

- [x] Ingen ny brukerinput-sti
- [x] Ingen auth-endringer (utenom 1 kommentar-linje i `routes.js`)
- [x] Ingen nye hemmeligheter
- [x] Ingen PII-eksponering
- [x] Ingen frontend-XSS-vektorer
- [x] CSP urørt
- [x] Multi-tenant-isolasjon urørt

---

## Kompetanse-/dømme-kall

- Norsk → engelsk er kontekst-bevarende oversettelse, ikke ord-for-ord.
  Kommentarer skal forklare *hvorfor*, og oversettelsen må bevare det.
- Tekniske termer (Norwegian fagspråk → engelsk fagspråk):
  - "spiskammers" → "pantry"
  - "handleliste" → "shopping list"
  - "måltidsplan" → "meal plan"
  - "familie-medlem" → "family member"
  - "gjøremål" → "chore"
  - "kategori" → "category"
  - "produkt" → "product"
  - "oppskrift" → "recipe"
  - "ingrediens" → "ingredient"
- Bevare hver kommentars rytme — ikke utvid eller forkort meningsløst.
