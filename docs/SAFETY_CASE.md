# Safety Case — Familieassistenten

**Versjon:** 1.3.0
**Sist oppdatert:** 2026-04-11 (uke 9 SAF-7 av ISO/IEC 25010-planen)
**Systemkategori:** Ikke-medisinsk husholdnings-assistent
**Målgruppe:** Én familie på eget hjemmenett

Dette dokumentet beskriver hvorfor Familieassistenten er **"trygt nok"**
til familiebruk, og hva systemet **IKKE** garanterer. Det er ikke en
formell safety-sertifisering (ingen slik kreves eller er mulig for denne
systemkategorien), men en transparent erklæring om forutsetninger,
begrensninger og mitigasjoner.

---

## 1. Scope og forutsetninger

### 1.1 Hva Familieassistenten ER

- En privat familie-assistent som kjører på ett enkelt hjemmenett
- Planlegger middager, handletur, husarbeid, lager lokal kunnskapsbase
- Bruker LLM (lokalt eller via sky-API) for forslag og chat
- Lagrer alt i en lokal SQLite-fil på enheten (typisk Raspberry Pi 5)

### 1.2 Hva Familieassistenten IKKE ER

- **Ikke medisinsk utstyr.** Gir ikke diagnostiske eller terapeutiske
  anbefalinger.
- **Ikke ernærings-autoritet.** Beregnet kalori-/næringsinnhold er
  estimater, ikke presise målinger.
- **Ikke allergi-garanti.** Se §3 nedenfor.
- **Ikke barne-sikker som eneste tilsyns-mekanisme.** Mindreårige skal
  ha voksen-tilsyn når de bruker systemet, spesielt for kjøpsbeslutninger.
- **Ikke godkjent for kommersiell/multi-family-bruk.** Sikkerhetsmodellen
  er bygget på single-user LAN-tillit.

### 1.3 Forutsatt miljø

- Eieren har full kontroll over LAN og har lest `SECURITY.md`
- `AUTH_TOKEN` er satt og minst 16 tegn (håndhevet av `config.js`)
- Familien har en voksen som forstår at LLM-output ikke er autoritativt
- Ingen barn under 8 år gjør matinnkjøp/oppskriftsvalg uten tilsyn

---

## 2. Safety-relevante funksjoner

Følgende funksjoner har økt safety-impact og får spesiell behandling:

### 2.1 Allergi-håndtering (kritisk)

**Kontekst:** Familieprofilen lar brukeren registrere allergier
(nøtter, laktose, gluten, egg, skalldyr, fisk, soya, sesam, m.fl.).
Systemet bruker allergi-listen til å filtrere meal-suggestions og
advare om oppskrifter som inneholder allergener.

**Mitigasjon:** Se §3 nedenfor.

### 2.2 Pantry-basert utløpsdato

**Kontekst:** Systemet sporer pantry-beholdning og kan varsle når
varer nærmer seg utløpsdato via `shelfLifeDays`.

**Mitigasjon:**
- Kun "beste gjetning" basert på kategori-gjennomsnitt
- Utløpsvarsel er informativt, ikke blokkerende
- Bruker MÅ fysisk inspisere maten selv

### 2.3 OCR av matvareetiketter

**Kontekst:** Recipe-import tar foto av oppskrift og kjører OCR.

**Mitigasjon:**
- OCR-tekst sanitiseres før den lagres (M1 XSS-hardening)
- LLM parser OCR-tekst → kan misforstå ingredient-listen
- Deterministisk allergi-filter kjøres på LLM-resultatet (§3)

---

## 3. Allergi-filter — detaljert safety-case

Dette er det **mest safety-kritiske** elementet i systemet.

### 3.1 Risk

En familie-medlem med nøtte-allergi får servert en oppskrift med
hasselnøtter fordi LLM-en glemte allergi-kontexten. Konsekvens:
mulig alvorlig allergisk reaksjon.

RPN før uke 9: **30** (S=5, L=3, D=2)
RPN etter uke 9: **12** (S=5, L=3, D=1) — reduksjonen kommer fra
deterministisk synlig flagg.

### 3.2 Arkitektur: to uavhengige lag

**Lag 1 — LLM best-effort filtrering:**
- Familieprofilen (inkl. allergier) sendes i system-prompt til LLM-en
- LLM instrueres til å unngå allergener
- Dette er **ikke tilstrekkelig alene** — LLM er probabilistisk

**Lag 2 — Deterministisk post-filter:**
`server/services/allergy-filter.service.js` er det eneste stedet i
kodebasen som gir en **hard garanti** om allergi-sjekk. Virker slik:

1. Utvid hver bruker-allergi til en synonym-liste via `ALLERGY_TRIGGERS`
   (kuratert tabell av norske triggere per allergi-kategori)
2. For hver ingrediens i oppskriften: case-insensitiv substring-sjekk
   mot hele trigger-settet
3. Første treff → `blockedIngredients` med ingrediens, allergi, trigger
4. Output: `{ safeForProfile: boolean, blockedIngredients: [...] }`

**Hvorfor deterministisk?**
- Ingen neural nets, ingen ML, ingen probabilitet
- Samme input → samme output, hver gang
- Feilmodus er "ingenting overset" (false negatives) — akseptabelt
- False positives (for mange warnings) er akseptabelt

### 3.3 Hvor gaten plasseres

Post-filteret kjøres på alle response-veier som kan bære LLM-kurert
oppskriftsdata:

- `GET /api/recipes` — batch-annotering av alle oppskrifter
- `GET /api/recipes/:id` — single-annotering
- `POST /api/recipes/import` — annotering i response FØR lagring
- `POST /api/profile/check-recipe` — eksplisitt sjekk (for client-side
  ad-hoc-kontroll)

**Frontend:** viser tydelig **rødt advarsels-kort** (`role="alert"`)
på oppskriftskortet hvis `safeForProfile === false`. Ved recipe-import
trigger vi en **explicit confirm-dialog** som brukeren må lukke før
importen anses som "godtatt".

### 3.4 Verifisert effektivitet

`tests/m-week9-safety.test.js` inneholder:

1. **25 unit-tester** for hver allergi-kategori med kjente triggere
2. **~150 regression-tester** som systematisk verifiserer at HVER
   eneste trigger i `ALLERGY_TRIGGERS` faktisk fanges opp
3. **4 API-integration-tester** som kaller `POST /api/profile/check-recipe`
   med realistisk recipe-data
4. **3 integration-tester** som verifiserer at `GET /api/recipes` og
   `GET /api/recipes/:id` returnerer safety-feltene

Alle 180+ tester er kjørt og grønne før release.

### 3.5 Kjente begrensninger

1. **Ukjente allergener:** Hvis brukeren har en svært sjelden allergi
   (f.eks. "avocado"), har `ALLERGY_TRIGGERS` ikke en kuratert synonym-
   liste. Fallback er substring-match på selve allergi-strengen, noe
   som er svakere men bedre enn ingenting. Anbefaling: operatør legger
   til egne triggere i servicen hvis nødvendig.

2. **Krysskontaminering:** "Produsert på anlegg som håndterer nøtter"
   fanges ikke — systemet har ikke tilgang til produsent-metadata.

3. **Sammensatte ingredienser:** "Pesto" inneholder ofte pinjekjerner,
   men hvis oppskriften bare skriver "pesto" uten å liste komponentene,
   fanges det ikke. Mitigasjon: LLM-en instrueres i system-prompt til
   å dele sammensatte ingredienser, og de 12 vanligste
   sammensatte-ingrediensene er eksplisitt i trigger-listen.

4. **Skrivefeil:** "hasslnøttel" (typo) matcher ikke "hasselnøtt"-triggeren.
   Substring-match er strengt. Dette er akseptabelt fordi typo er
   sjelden i LLM-output, men hvis brukeren skriver manuelt inn en
   feilstavet ingrediens kan det slippe gjennom.

**Samlet:** Filteret er god-nok til hovedrisk-scenariene (hasselnøtter
i julekake, laktose i pesto, egg i majones). Det er ikke en formell
safety-sertifisering og **erstatter ikke manuell kontroll**.

### 3.6 Brukerens ansvar (uttalt)

- Allergiker eller foresatte MÅ fortsatt lese ingrediens-listen manuelt
- Når systemet advarer (`safeForProfile: false`), skal oppskriften IKKE
  gjennomføres uten ytterligere manuell kontroll
- Når systemet sier safe, er det "beste innsats" — ikke en garanti
- Ved livstruende allergier (som epinefrin-pen-nivå), IKKE stol på
  systemet alene

Denne teksten er duplisert i `BRUKERGUIDE.md §6` som brukeren leser
under onboarding.

---

## 4. Andre safety-mitigasjoner

### 4.1 Data-integritet

- Daglig SQLite online-backup med 14 dagers retention
- Off-site backup via rsync (operatør-konfigurert)
- Weekly backup-restore-test i CI fanger korrupte backups tidlig

### 4.2 Tilgangskontroll

- AUTH_TOKEN ≥16 tegn obligatorisk i prod
- Rate-limit per IP
- CORS locked to specific origins i prod
- systemd sandboxing (ProtectSystem=strict, PrivateTmp, nonroot)
- Docker distroless runtime med UID 65532

### 4.3 Destructive ops

- Alle DELETE/PUT på sensitive ressurser wrappet i `withAudit()`
- Audit-log beholdes append-only og eksponeres via `/api/audit` (read-only)
- Frontend krever `showConfirm`-dialog før destructive handlinger

### 4.4 Recovery

- `/ready` returnerer 503 når disk <100 MB eller DB >500 MB
- Circuit breakers på alle eksterne kall (LLM, Kassal)
- Graceful shutdown via sd-notify + WatchdogSec
- RUNBOOK §4 DR-scenarier + §11 alert-runbooks

---

## 5. Hendelseshåndtering

Hvis en safety-relevant hendelse skjer (f.eks. noen får servert en
oppskrift med allergen):

1. **Umiddelbart:** Gi medisinsk hjelp (epi-pen, legevakt, etc). Dette
   er ikke et tekniske problem i øyeblikket.
2. **Etterpå:** Logg hendelsen i GitHub issues med `safety-incident`
   label. Inkluder:
   - Hva familieprofilen sa (`/api/profile`)
   - Hva oppskriften var
   - Om systemet flagget `safeForProfile: false` eller ikke
   - Hvilken LLM-backend som genererte oppskriften
3. **Analyse:** Undersøk om det er en mangel i `ALLERGY_TRIGGERS`
   som må utvides, eller om LLM-kontexten svikter, eller begge.
4. **Fiks:** Oppdater `ALLERGY_TRIGGERS`, utvid fuzz-testene, og
   dokumenter i `CHANGELOG.md` under Security / Safety.
5. **Retrospektiv:** Oppdater RISK_REGISTER.md RPN og denne filens §3.

---

## 6. Hvordan safety-casen gjennomgås

- **Ved hver minor-release** (v1.Y.0): gjennomgå dette dokumentet
- **Ved ny trigger** i `ALLERGY_TRIGGERS`: utvid fuzz-testene
- **Ved ny LLM-backend** (f.eks. lokal Gemini): retest system-prompt
  + post-filter
- **Ved konkret safety-issue**: prioriter patch innen 7 dager

Dette dokumentet er transparent og lever i git — hvert endring er
sporbar, og historikk kan revideres.

---

## 7. Deklarasjon

Familieassistenten er **"trygt nok"** for privat familiebruk på et
hjemme-nett så lenge:

1. Brukeren har lest `BRUKERGUIDE.md` og forstår at LLM-output ikke
   er autoritativt
2. Familieprofilen er oppdatert med kjente allergier
3. Brukeren respekterer `safeForProfile: false`-advarsler og leser
   ingredienslisten manuelt uansett
4. Systemet kjøres i henhold til `DEPLOY.md` (systemd eller Docker)
5. CI-en holdes grønn og CVE-patches applikeres innen 7 dager

For ethvert bruk utenfor disse forutsetningene (kommersielt, medisinsk,
flere familier, barneverntjeneste, etc.) er safety-casen **IKKE
gyldig** og systemet skal ikke brukes.

**Dokumentet er skrevet av prosjekt-eieren og er ikke revidert av
ekstern safety-auditør.**
