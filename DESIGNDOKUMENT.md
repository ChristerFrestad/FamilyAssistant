# Familieassistenten — Designdokument

**Versjon:** 1.0
**Dato:** 6. april 2026
**Familie:** Christer & Martine Frestad + Mazie (født mai 2026)
**Adresse:** Heia 9, Kristiansand
**Plattform:** Raspberry Pi 5, 8 GB RAM

---

## 1. Systemarkitektur

Familieassistenten er en lokal, selvforbedrende husholdsassistent som kjører 24/7 på en Raspberry Pi 5 (8 GB) ved siden av andre tjenester. Systemet består av fire hovedmoduler: matplanlegger (A), husarbeidplanlegger (B), kalenderintegrasjon (C), og aktivitetsforslag (D). Alt styres gjennom en mobilvennlig webapplikasjon (PWA) som legges som snarvei på iPhone.

### 1.1 Teknologivalg

| Komponent | Teknologi | Begrunnelse |
|-----------|-----------|-------------|
| Database | SQLite 3 | Én fil, null konfigurasjon, relasjonelt, fullt ut querybart, perfekt for RPI5 |
| Backend | Node.js + Express | Lett, asynkront, deler språk med frontend |
| Frontend | React (JSX) + Tailwind | Allerede bygget dashboard, PWA-støtte |
| Talegjenkjenning (v2) | NB-Whisper small via faster-whisper (INT8) | Norsk ASR, 2.2% WER, håndterbart på RPI5 |
| Kalender (v2) | HomeAssistant REST API → CalDAV → iOS | Lese/skrive kalenderhendelser til delt iPhone-kalender |
| Kvitteringsskanning (v2) | Multimodal LLM (Gemini 2.5 Flash / Claude) | OCR for norske kvitteringer, oppdaterer KB automatisk |
| Produktpriser | Kassalapp API (kassal.app) | 100k+ norske dagligvarer med priser og EAN |

### 1.2 Systemdiagram

```
┌──────────────────────────────────────────────────────┐
│                   Raspberry Pi 5 (8 GB)              │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  Express.js  │  │  SQLite DB   │  │ HomeAssist. │ │
│  │  API Server  │←→│  (KB + data) │  │  (ekstern)  │ │
│  │  :3000       │  └──────────────┘  └──────┬──────┘ │
│  └──────┬───────┘                           │        │
│         │                          REST API ↕        │
│  ┌──────┴───────┐  ┌──────────────┐  ┌──────┴──────┐ │
│  │ React PWA    │  │ faster-whisp │  │ CalDAV      │ │
│  │ Dashboard    │  │ (v2: tale)   │  │ iOS kalender│ │
│  └──────────────┘  └──────────────┘  └─────────────┘ │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │ Cron-jobber  │  │ Kassalapp    │                  │
│  │ (push/plan)  │  │ API-klient   │                  │
│  └──────────────┘  └──────────────┘                  │
└──────────────────────────────────────────────────────┘
```

### 1.3 Ressursbudsjett (RPI5 8 GB)

| Prosess | Estimert RAM | CPU |
|---------|-------------|-----|
| Node.js backend + SQLite | ~120 MB | Lav |
| React PWA (nettleser) | Klient-side | — |
| Andre tjenester (HA etc.) | ~2–4 GB | Varierende |
| NB-Whisper small INT8 (v2) | ~500 MB | Høy under transkripsjon |
| **Tilgjengelig margin** | **~3–5 GB** | — |

faster-whisper med INT8-kvantisering av NB-Whisper small bruker ~500 MB under aktiv transkripsjon og frigjør minne mellom forespørsler. Dette er innenfor budsjettet.

---

## 2. Databasedesign (SQLite)

### 2.1 ER-oversikt

Databasen er kjernen i det selvforbedrende systemet. Den lagrer alt fra produktinformasjon og oppskrifter til forbruksmønstre og husholdningsvarer.

### 2.2 Tabeller

#### `products` — Produktdatabase (butikkvarer)

```sql
CREATE TABLE products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,        -- 'kyllingfilet', 'røros_melk'
  product_name  TEXT NOT NULL,               -- 'Kyllingfilet 500g'
  category      TEXT NOT NULL,               -- 'Kjøtt & fisk', 'Meieri', 'Frukt & grønt', etc.
  pack_size     REAL NOT NULL,               -- 500
  unit          TEXT NOT NULL,               -- 'g', 'ml', 'stk'
  est_price     REAL,                        -- 89.00 (estimert pris Kiwi Vågsbygd)
  shelf_days    INTEGER,                     -- 3 (dager etter kjøp)
  store         TEXT DEFAULT 'Kiwi Vågsbygd', -- foretrukket butikk
  ean           TEXT,                        -- EAN-kode fra Kassalapp
  dairy_rule    TEXT,                        -- 'røros_only', 'røros_preferred', NULL
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Meieriregel i praksis:**
- `dairy_rule = 'røros_only'` → Melk: KUN Røros-meieriet fra Kiwi Vågsbygd
- `dairy_rule = 'røros_preferred'` → Fløte/rømme: Røros foretrukket, Anglamark (Coop) OK
- `dairy_rule = NULL` → Ost, smør, egg osv: Fritt valg

#### `inventory` — Hva vi har hjemme

```sql
CREATE TABLE inventory (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      INTEGER REFERENCES products(id),
  product_key     TEXT NOT NULL,
  qty_remaining   REAL NOT NULL DEFAULT 0,   -- estimert gjenværende mengde
  unit            TEXT NOT NULL,
  last_purchased  DATE,
  last_pack_size  REAL,                      -- størrelse på sist kjøpt pakke
  expires_est     DATE,                      -- estimert utløpsdato
  purchase_count  INTEGER DEFAULT 0,         -- antall ganger kjøpt totalt
  avg_days_between_purchase REAL,            -- snittdager mellom kjøp
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `purchase_log` — Kjøpshistorikk (selvforbedring)

```sql
CREATE TABLE purchase_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key   TEXT NOT NULL,
  qty           REAL NOT NULL,
  unit          TEXT NOT NULL,
  price_paid    REAL,                        -- faktisk pris (fra kvittering v2)
  store         TEXT,
  purchased_at  DATE NOT NULL,
  source        TEXT DEFAULT 'manual'        -- 'manual', 'receipt_scan', 'auto'
);
```

#### `recipes` — Oppskriftsdatabase

```sql
CREATE TABLE recipes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,               -- 'Kylling red curry med jasminris'
  category      TEXT NOT NULL,               -- 'rask', 'comfort', 'helg'
  prep_time     TEXT,                        -- '25 min'
  source        TEXT,                        -- 'godt.no', 'matprat.no', 'pinterest'
  url           TEXT,
  pinterest_url TEXT,                        -- bonus-lenke til Pinterest
  servings      INTEGER DEFAULT 2,           -- antall porsjoner
  notes         TEXT,                        -- spesielle notater
  times_cooked  INTEGER DEFAULT 0,           -- antall ganger laget
  last_cooked   DATE,
  rating        REAL,                        -- 1-5 stjerner (bruker-rating)
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `recipe_ingredients` — Ingredienser per oppskrift

```sql
CREATE TABLE recipe_ingredients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id   INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
  product_key TEXT,                          -- kobling til products.key
  name        TEXT NOT NULL,                 -- visningsnavn
  qty         REAL NOT NULL,                 -- mengde for oppskriften
  unit        TEXT NOT NULL,                 -- 'g', 'ml', 'stk', 'ss', 'ts', 'fedd'
  optional    BOOLEAN DEFAULT 0
);
```

#### `meal_plans` — Ukeplan

```sql
CREATE TABLE meal_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_year   TEXT NOT NULL,                 -- '2026-W15'
  day_of_week INTEGER NOT NULL,              -- 0=mandag, 6=søndag
  meal_type   TEXT DEFAULT 'middag',         -- 'frokost', 'lunsj', 'middag'
  recipe_id   INTEGER REFERENCES recipes(id),
  status      TEXT DEFAULT 'planned',        -- 'planned', 'cooked', 'skipped', 'away'
  notes       TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

`status = 'away'` brukes når familien er borte (reise, besøk) — da fjernes ingrediensene fra handlelisten.

#### `consumables` — Ikke-oppskrift-varer med forbruksmønster

```sql
CREATE TABLE consumables (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key         TEXT REFERENCES products(key),
  name                TEXT NOT NULL,           -- 'Zeroh saft', 'Bakepapir', 'Bleier'
  category            TEXT NOT NULL,           -- 'Drikkevarer', 'Kjøkken', 'Barn', 'Husholdning'
  depletion_model     TEXT NOT NULL,           -- 'daily_rate', 'per_meal', 'per_recipe_type', 'fixed_interval'
  depletion_rate      REAL,                    -- avhenger av modell (se under)
  depletion_unit      TEXT,                    -- 'ml/dag', 'stk/dag', 'ark/bruk'
  current_qty         REAL DEFAULT 0,
  unit                TEXT NOT NULL,
  reorder_threshold   REAL,                    -- bestill når under dette nivået
  auto_add_to_list    BOOLEAN DEFAULT 1,       -- legg automatisk på handleliste
  notes               TEXT,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Forbruksmodeller (depletion_model):**

| Modell | Eksempel | Beregning |
|--------|----------|-----------|
| `daily_rate` | Zeroh saft: 500 ml/dag (antar 5 glass à 200ml, middagskveld, halvparten av 1.5-3L) | `current_qty -= rate * dager` |
| `per_meal` | Bakepapir: 1 ark per ovn/airfryer-rett | Teller antall oppskrifter som bruker ovn/airfryer |
| `per_recipe_type` | Matolje: 2 ss per steking, 0 per koking | Kobler til oppskriftens tilberedningsmåte |
| `fixed_interval` | Oppvaskmiddel: 1 flaske per 14 dager | `current_qty -= 1 per intervall` |

**Saft/brus-logikk spesifikt:**
- Hvis brus er på handlelisten → saftforbruk halveres den uken
- Hvis ingen brus → saftforbruk øker til 1.5–3L per kveld
- KB lærer faktisk forbruk over tid og justerer automatisk

#### `consumable_log` — Forbrukslogg for selvforbedring

```sql
CREATE TABLE consumable_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  consumable_id   INTEGER REFERENCES consumables(id),
  qty_used        REAL NOT NULL,
  logged_at       DATE NOT NULL,
  context         TEXT                       -- 'middag', 'rengjøring', 'daglig'
);
```

#### `chores` — Husarbeid

```sql
CREATE TABLE chores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task        TEXT NOT NULL,                 -- 'Støvsuge hus + hagestue'
  details     TEXT,                          -- underpunkter
  frequency   TEXT NOT NULL,                 -- 'ukentlig', '14_dager'
  default_day INTEGER NOT NULL,              -- 0=mandag, 4=fredag
  icon        TEXT,
  active      BOOLEAN DEFAULT 1
);

-- REGEL: Ingen husarbeid på lørdag (5) eller søndag (6)!
```

#### `chore_schedule` — Ukentlig husarbeidplan

```sql
CREATE TABLE chore_schedule (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chore_id    INTEGER REFERENCES chores(id),
  week_year   TEXT NOT NULL,                 -- '2026-W15'
  scheduled_day INTEGER NOT NULL,
  status      TEXT DEFAULT 'pending',        -- 'pending', 'done', 'postponed'
  postponed_to INTEGER,                      -- ny dag (0-4), kan gå til mandag neste uke
  completed_at DATETIME,
  notes       TEXT
);
```

**Utsett-logikk:** Fredag (4) kan utsettes til mandag (0) neste uke. Aldri til lørdag/søndag.

#### `meal_history` — Historikk for matplanlegging

```sql
CREATE TABLE meal_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id   INTEGER REFERENCES recipes(id),
  cooked_at   DATE NOT NULL,
  rating      REAL,
  leftovers   BOOLEAN DEFAULT 0,
  notes       TEXT
);
```

#### `shopping_list_cache` — Generert handleliste

```sql
CREATE TABLE shopping_list_cache (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  week_year     TEXT NOT NULL,
  product_key   TEXT NOT NULL,
  needed_qty    REAL NOT NULL,
  unit          TEXT NOT NULL,
  pack_count    INTEGER,
  est_price     REAL,
  has_at_home   BOOLEAN DEFAULT 0,
  source        TEXT,                        -- 'recipe', 'consumable', 'manual'
  checked_off   BOOLEAN DEFAULT 0,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2.3 Selvforbedrings-syklus

```
1. KJØP: Bruker handler → markerer "Har hjemme" eller skanner kvittering
   → INSERT INTO purchase_log + UPDATE inventory

2. FORBRUK: Ukemeny genereres → system beregner forventet forbruk
   → UPDATE inventory SET qty_remaining = qty_remaining - beregnet_forbruk

3. PREDIKSJON: Etter N kjøp → system beregner avg_days_between_purchase
   → Neste handleliste: "Du kjøpte hvitløk for 18 dager siden,
      snitt er 21 dager — ta med denne uken?"

4. HOLDBARHET: expires_est = last_purchased + shelf_days
   → Varsel: "Kyllingfileten utløper i morgen — flytt middagen opp?"

5. PRISSPORING: Kassalapp API + kvitteringsskanning
   → Sammenlign pris mellom Kiwi og Coop for ukens varer
   → "Denne uken sparer du 47 kr på å handle X på Coop"
```

---

## 3. Modul A — Matplanlegger (v0.1.0)

### 3.1 Kjernefunksjonalitet

**Ukesmeny** med 7 middager (man–søn), kategorisert:
- Mandag–torsdag: raske retter (< 30 min)
- Fredag: comfort food (30–60 min)
- Lørdag–søndag: helgemiddager (kan ta lengre tid)

Alle oppskrifter har eksakte mengder per ingrediens, koblet til `products`-tabellen med pakkestørrelser og priser fra Kiwi Vågsbygd.

### 3.2 Bytt middag

Bruker trykker "Bytt middag" på en dag → systemet foreslår 5 alternativer + "Annet" (fritekst):

**Rangeringsalgoritme for forslag:**
1. Ingredienser du allerede har hjemme (fra `inventory`) — minimerer nyhandling
2. Holdbarhet — foreslår retter som bruker varer som snart utløper
3. Historikk — unngå retter laget siste 2 uker (fra `meal_history`)
4. Kategori-match — raske retter på hverdager, comfort/helg etter dag
5. Familieprofil — vekter mot preferansene (Martine: curry, scampi, asiatisk / Christer: grill, biff, kebab)

Ved fritekst ("Annet") søker systemet i `recipes`-tabellen og foreslår oppskrift med full ingrediensliste. Nye oppskrifter lagres automatisk.

### 3.3 Bytt rekkefølge + holdbarhetskontroll

Bruker trykker ↑/↓ for å flytte middager mellom dager. Systemet sjekker automatisk:

```
Dersom ingrediens.shelf_days + kjøpsdato < ny_dag:
  → Modal: "⚠️ Laksefilet holder maks til onsdag.
     Flytt denne middagen senest til onsdag?"
```

### 3.4 Fjern middag (borte/reise)

Bruker kan markere en dag som "Borte" → `meal_plans.status = 'away'` → ingrediensene fjernes fra handlelisten. Handlelisten oppdateres automatisk.

### 3.5 Smart handleliste

Handlelisten bygges dynamisk fra ukemenyen:

```
For hver ingrediens i ukens middager:
  1. Summer total mengde på tvers av alle retter
  2. Sjekk inventory: har vi noe hjemme?
  3. Delta = total_behov - har_hjemme
  4. Pakkekalkyle = Math.ceil(delta / pack_size)
  5. Legg til consumables som er under reorder_threshold
  6. Legg til faste husholdningsvarer (bleier, toalettpapir, etc.)

Grupper etter kategori:
  - Kjøtt & fisk
  - Meieri (Røros!)
  - Frukt & grønt
  - Tørrvarer & annet
  - Drikkevarer
  - Husholdning / Barn
```

"Har hjemme"-klikk → oppdaterer `inventory` + `purchase_log`, fjerner vare fra listen.

### 3.6 Legg til varer manuelt

Bruker kan legge til varer som ikke er i oppskrifter: saft, bakepapir, brus, bleier, osv. Disse kobles til `consumables`-tabellen med forbruksmønster.

### 3.7 Frokost & lunsj

- Frokost: Enkel brødmat (2 skiver hver) som standard. Mulighet for raske alternativer (< 15 min): egg, havregrøt, smoothie
- Lunsj: Martine spiser alene i permisjonstiden. Enkle forslag: rester, brødmat, salat
- Systemet sørger for at det alltid er nok brød, pålegg og basisvarer på handlelisten

### 3.8 Søndagsvarsel (push)

Hver søndag kl. 14:00 genererer systemet:
1. Forslag til alle middager kommende uke
2. Komplett handleliste med alle varer (inkl. consumables og husholdning)
3. Estimert totalpris
4. Anbefalt handledag (vurderer holdbarhet — ferskvarer senere i uken)
5. Frokost/lunsj-oversikt med eventuelle raske alternativer

---

## 4. Modul B — Husarbeidplanlegger (v0.1.0)

### 4.1 Oppgaveliste

| # | Oppgave | Hyppighet | Standard dag |
|---|---------|-----------|-------------|
| 1 | Ta ut søpla | Ukentlig (torsdag kveld) | Torsdag |
| 2 | Skifte sengetøy | Hver 14. dag | Onsdag |
| 3 | Støvsuge hus + hagestue | Ukentlig | Mandag |
| 4 | Tørke støv | Hver 14. dag | Tirsdag |
| 5 | Vaske det store badet | Ukentlig | Onsdag |
| 6 | Vaske det lille badet | Ukentlig | Torsdag |
| 7 | Rydde huset inne | Ukentlig | Mandag |
| 8 | Rydde hagestuen | Ukentlig | Tirsdag |
| 9 | Rydde ute (terrasse→garasje) | Hver 14. dag | Fredag |
| 10 | Vaske tøy | Etter behov | — |
| 11 | Rydding av kjøkken | Etter behov | — |
| 12 | Rydde i kjøleskapet | Ukentlig | Fredag |
| 13 | Pante flasker | Hver 14. dag | Fredag |

**REGEL: Ingen husarbeid på lørdag eller søndag!**

### 4.2 Søppelhentedag

Søppelbilen henter fredager på Heia 9. Søppeltyper (rest, matavfall, papp/papir, glass) hentes etter Avfallsør sin kalender. Systemet henter data fra avfallsor.no for adressen og viser hva som hentes denne fredagen.

### 4.3 Utsett-knapp

Hver oppgave har en "Utsett"-knapp:
- Utsetter til neste dag (mandag → tirsdag, etc.)
- **Fredag → mandag neste uke** (hopper over helgen)
- Aldri til lørdag eller søndag
- Logges i `chore_schedule` med `status = 'postponed'`

### 4.4 Vaskeplan (tøy)

Automatisk forslag basert på 2 voksne + 1 baby:
- Mandag: Hvitt/lyst (håndklær, laken)
- Onsdag: Farget (klær)
- Fredag: Babytøy + småvask
- Etter behov: Ekstra ved søl, oppgulp, etc.

---

## 5. Modul C — Kalenderintegrasjon (v2)

### 5.1 Arkitektur

```
iPhone delt kalender ←→ CalDAV ←→ HomeAssistant ←→ Familieassistenten API
```

HomeAssistant har innebygd CalDAV-integrasjon som allerede synkroniserer med iOS-kalendere. Familieassistenten bruker HA sitt REST API for å lese og skrive hendelser.

### 5.2 Lese hendelser

```
GET http://homeassistant.local:8123/api/calendars/calendar.familie
Headers: Authorization: Bearer <HA_TOKEN>

GET http://homeassistant.local:8123/api/calendars/calendar.familie?start=2026-04-06&end=2026-04-13
```

Brukes til å sjekke konflikter med middagsplanlegging, husarbeid, og aktiviteter.

### 5.3 Skrive hendelser

```
POST http://homeassistant.local:8123/api/services/calendar/create_event
{
  "entity_id": "calendar.familie",
  "summary": "Middag: Kylling red curry",
  "start_date": "2026-04-06",
  "end_date": "2026-04-06",
  "description": "25 min | Ingredients: kylling, curry paste, kokosmelk..."
}
```

Synkroniserer automatisk: middagsplan → kalenderhendelse, husarbeid → påminnelse.

### 5.4 Integrasjonspunkter

- Ukemeny genereres → alle middager legges i kalenderen med tidspunkt og oppskriftlenke
- Husarbeid → påminnelser i kalenderen
- "Borte"-markering i matplanen → sjekker mot kalenderhendelser (reise, besøk)
- Søndagspush kl. 14:00 → sammenstiller kalender + meny + handleliste

---

## 6. Modul D — Aktivitetsforslag (v2)

Hver mandag kl. 10:00: Hent og presenter aktiviteter i Kristiansand kommune for kommende uke. Kilder: kommunens arrangementskalender, visitkristiansand.com, lokale Facebook-grupper (via webscraping der mulig).

Kommer tilbake til detaljert design etter familiens tilbakemelding.

---

## 7. Taleagent — NB-Whisper (v2)

### 7.1 Modellvalg

| Modell | Størrelse | RAM (INT8) | Hastighet (RPI5) | WER |
|--------|-----------|------------|-------------------|-----|
| NB-Whisper tiny | 39M | ~80 MB | ~2x sanntid | ~5% |
| NB-Whisper small | 244M | ~500 MB | ~0.8x sanntid | ~3% |
| NB-Whisper medium | 769M | ~1.2 GB | ~0.3x sanntid | ~2.5% |
| NB-Whisper large | 1.5B | ~2.5 GB | For tregt | ~2.2% |

**Anbefaling:** NB-Whisper **small** via faster-whisper med INT8-kvantisering. Gir ~3% WER på norsk bokmål, håndterer kristiansandsdialekt rimelig godt, og kjører nær sanntid på RPI5.

### 7.2 Dialektlæring

faster-whisper støtter fine-tuning, men dette er ressurskrevende. Alternativ tilnærming:
1. Start med NB-Whisper small (trent på norske dialekter inkl. sørlandsk)
2. Logg alle transkripsjoner med korreksjon (bruker retter feil)
3. Over tid: finn mønstre i feiltranskripsjoner → lag ordbok med lokale uttrykk
4. Vurder fine-tuning med familien sine stemmer etter 6+ måneder med data

### 7.3 Talekommandoer

Eksempler på taleinteraksjon:
- "Hva er middagen i dag?" → Leser opp dagens rett og ingredienser
- "Bytt torsdag til taco" → Bytter rett, oppdaterer handleliste
- "Legg til bleier på handlelisten" → Legger til i `shopping_list_cache`
- "Utsett støvsuging" → Utsetter i `chore_schedule`
- "Legg inn legetime onsdag klokken 14" → Oppretter kalenderhendelse via HA

---

## 8. Kvitteringsskanning (v2)

### 8.1 Pipeline

```
1. Bruker tar bilde av kvittering (iPhone kamera)
2. Bilde lastes opp via PWA → Express API
3. API sender bilde til multimodal LLM (Gemini 2.5 Flash eller Claude)
4. LLM returnerer strukturert JSON:
   {
     "store": "Kiwi Vågsbygd",
     "date": "2026-04-05",
     "items": [
       { "name": "Røros helmelk 1L", "qty": 2, "price": 25.90, "ean": "7038010..." },
       { "name": "Kyllingfilet 500g", "qty": 1, "price": 89.00 }
     ],
     "total": 312.50
   }
5. For hvert item:
   a. Match mot products-tabellen (fuzzy match på navn + EAN)
   b. INSERT INTO purchase_log
   c. UPDATE inventory (qty_remaining, last_purchased, expires_est)
   d. UPDATE consumables (current_qty) der relevant
   e. Oppdater avg_days_between_purchase
```

### 8.2 Kassalapp API for produktmatching

```
GET https://kassal.app/api/v1/products?search=kyllingfilet
Headers: Authorization: Bearer <KASSAL_TOKEN>
```

Brukes for:
- EAN-kode → eksakt produktmatch
- Produktnavn → fuzzy match
- Prisvergelijking mellom butikker
- Oppdatering av `est_price` i products-tabellen

---

## 9. Forbruksmodellering (ikke-oppskrift-varer)

### 9.1 Saft / Brus

**Scenario:** Familien drikker saft til middag de fleste kvelder. Zeroh saft (1.5L) rekker ca. 3 dager. Hvis de kjøper brus i tillegg, halveres saftforbruket.

```sql
-- Zeroh saft i consumables-tabellen:
INSERT INTO consumables (name, category, depletion_model, depletion_rate, depletion_unit,
                          unit, reorder_threshold)
VALUES ('Zeroh saft 1.5L', 'Drikkevarer', 'daily_rate', 500, 'ml/dag', 'ml', 500);
```

**Adaptiv logikk:**
```
Hvis brus finnes på handleliste denne uken:
  effektiv_rate = depletion_rate * 0.5
Ellers:
  effektiv_rate = depletion_rate

behov_denne_uken = effektiv_rate * 7
flasker_trengt = ceil(behov_denne_uken / 1500)
```

Etter 4+ uker med data justerer systemet `depletion_rate` basert på faktisk forbruk fra `consumable_log`.

### 9.2 Bakepapir

**Modell:** `per_recipe_type` — 1 ark per rett som bruker ovn, airfryer eller langpanne.

```
antall_ark_denne_uken = count(retter der tilberedning IN ('ovn', 'airfryer', 'langpanne'))
ruller_trengt = ceil(antall_ark / ark_per_rull)
```

### 9.3 Bleier (etter Mazie er født)

**Modell:** `daily_rate` — starter med standard nyfødt-estimat (~8-10 bleier/dag), justerer basert på faktisk forbruk.

```sql
INSERT INTO consumables (name, category, depletion_model, depletion_rate, depletion_unit,
                          unit, reorder_threshold, notes)
VALUES ('Bleier nyfødt', 'Barn', 'daily_rate', 9, 'stk/dag', 'stk', 30,
        'Starter med 9/dag, justeres etter Mazie sitt behov');
```

### 9.4 Husholdningsvarer

| Vare | Modell | Rate | Terskel |
|------|--------|------|---------|
| Oppvaskmiddel | fixed_interval | 1 flaske / 14 dager | 1 flaske |
| Toalettpapir | daily_rate | 1 rull / 2 dager | 8 ruller |
| Vaskemiddel | fixed_interval | 1 flaske / 21 dager | 1 flaske |
| Tøymykner | fixed_interval | 1 flaske / 28 dager | 1 flaske |
| Shampoo (×2) | fixed_interval | 1 flaske / 30 dager | 1 flaske |
| Tannkrem | fixed_interval | 1 tube / 45 dager | 1 tube |
| Våtservietter | daily_rate | 5 stk/dag | 1 pakke |
| Bind/tamponger | fixed_interval | 1 pakke / 28 dager | 1 pakke |
| Intimsåpe (Dr. Greve) | fixed_interval | 1 flaske / 60 dager | 1 flaske |

Alle rates er initialestimat — systemet justerer basert på faktisk kjøpsfrekvens fra `purchase_log`.

---

## 10. API-endepunkter (Express.js)

### 10.1 Matplanlegger

| Metode | Endepunkt | Beskrivelse |
|--------|-----------|-------------|
| GET | `/api/meals/week/:weekYear` | Hent ukemeny |
| PUT | `/api/meals/:id` | Oppdater rett (bytt, flytt, status) |
| POST | `/api/meals/swap/:id` | Hent 5 byttforslag |
| POST | `/api/meals/away/:id` | Marker dag som borte |
| GET | `/api/shopping/:weekYear` | Generer smart handleliste |
| PUT | `/api/shopping/check/:id` | Marker vare som "har hjemme" |
| POST | `/api/shopping/add` | Legg til manuell vare |

### 10.2 Husarbeid

| Metode | Endepunkt | Beskrivelse |
|--------|-----------|-------------|
| GET | `/api/chores/week/:weekYear` | Hent ukens oppgaver |
| PUT | `/api/chores/postpone/:id` | Utsett oppgave |
| PUT | `/api/chores/complete/:id` | Marker som gjort |

### 10.3 Inventory & KB

| Metode | Endepunkt | Beskrivelse |
|--------|-----------|-------------|
| GET | `/api/inventory` | Hent alt på lager |
| PUT | `/api/inventory/:key` | Oppdater lagerstatus |
| POST | `/api/receipt/scan` | Last opp kvitteringsbilde (v2) |
| GET | `/api/products/search?q=` | Søk i produkter |

### 10.4 Kalender (v2)

| Metode | Endepunkt | Beskrivelse |
|--------|-----------|-------------|
| GET | `/api/calendar/events` | Hent hendelser fra HA |
| POST | `/api/calendar/event` | Opprett hendelse via HA |

---

## 11. Frontend — React PWA

### 11.1 Eksisterende dashboard.jsx

Dagens `dashboard.jsx` (1200 linjer) har allerede:
- 4 faner: I dag, Ukesmeny, Handletur, Husarbeid
- productDB med 80+ varer og priser
- Oppskrifter med eksakte mengder
- `buildSmartShoppingList()` med delta-beregning mot KB
- "Har hjemme"-klikk med KB-oppdatering
- Bytt middag (5 forslag + annet)
- Rekkefølge-bytte med holdbarhetssjekk
- Utsett-knapp for husarbeid

### 11.2 Endringer for v0.1.0

1. **Koble til Express API** — flytt all datalogikk fra React state til API-kall
2. **SQLite backing** — all data persisteres (nå er alt i minnet og forsvinner ved refresh)
3. **"Borte"-knapp** per dag → fjerner ingredienser fra handleliste
4. **Legg til varer** — ny input-felt i handletur-fanen for manuell tillegging
5. **Meieriregel-korreksjon** — oppdater productDB: kun melk = røros_only, fløte/rømme = røros_preferred, ost/smør = fritt
6. **Consumables-seksjon** i handlelisten — vis automatisk beregnede husholdningsvarer
7. **Estimert totalpris** i handleliste-fanen
8. **Søndagspush** — cron-jobb som genererer og viser ukens forslag

### 11.3 PWA-konfigurasjon

```json
// manifest.json
{
  "name": "Familieassistenten",
  "short_name": "Familie",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#e94560",
  "icons": [{ "src": "icon-192.png", "sizes": "192x192" }]
}
```

Legg til som snarvei på iPhone: Safari → Del → "Legg til på Hjem-skjerm".

---

## 12. Implementeringsplan

### Fase 1: v0.1.0 (nåværende prioritet)

| Steg | Oppgave | Estimat |
|------|---------|---------|
| 1 | Sett opp Node.js + Express + SQLite på RPI5 | 2 timer |
| 2 | Opprett alle tabeller (SQL-migrering) | 1 time |
| 3 | Seed products, recipes, chores fra nåværende dashboard.jsx | 2 timer |
| 4 | Bygg API-endepunkter (matplan, handleliste, husarbeid) | 4 timer |
| 5 | Refaktorer dashboard.jsx til å bruke API | 3 timer |
| 6 | Legg til "Borte", "Legg til vare", consumables-seksjon | 2 timer |
| 7 | Cron-jobb for søndagspush | 1 time |
| 8 | PWA-konfigurasjon + test på iPhone | 1 time |
| **Total v0.1.0** | | **~16 timer** |

### Fase 2: v2 (etter v0.1.0 er godkjent og i drift)

| Steg | Oppgave | Estimat |
|------|---------|---------|
| 9 | HomeAssistant kalenderintegrasjon | 4 timer |
| 10 | Kvitteringsskanning (kamera → LLM → KB) | 6 timer |
| 11 | NB-Whisper talegjenkjenning | 8 timer |
| 12 | Kassalapp API-integrasjon for prissporing | 3 timer |
| 13 | Aktivitetsforslag Kristiansand (modul D) | 4 timer |
| **Total v2** | | **~25 timer** |

---

## 13. Hosting & Tilgang

Dashboard kjører på RPI5 som en lokal webserver. Tilgang:

- **Lokalt (hjemmenett):** `http://raspberrypi.local:3000` eller `http://192.168.x.x:3000`
- **iPhone snarvei:** Legg til URL som "Hjem-skjerm"-app via Safari
- **Utenfor hjemmet:** Krever enten VPN (Tailscale/WireGuard) eller Cloudflare Tunnel (gratis). Anbefaler Tailscale — én app på telefon, null konfigurasjon på RPI5.

---

## 14. Kjøkkenutstyr (referanse)

Tilgjengelig utstyr som oppskrifter kan ta i bruk: Kenwood kjøkkenmaskin, airfryer, riskoker, Foreman grill, gassgrill, stekepanner/kjeler, pizzastein (ovn/grill), vaffeljern, stekeovn, induksjonstopp, stavmikser, smoothieblender, foodprosessor (liten), 2× støpejernsgryter, langpanner, grillrist, pastaruller, kjevle, egg-koker, vannkoker, Moccamaster, Siemens Eq300 bønnemaskin, bambusdamper.

Oppskrifter tagges med hvilke apparater de bruker, noe som muliggjør filtrering ("vis meg airfryer-retter") og bakepapir-forbruksberegning.

---

## 15. Spesialregler (oppsummering)

1. **Melk:** KUN Røros-meieriet, KUN fra Kiwi Vågsbygd
2. **Fløte/rømme:** Røros foretrukket, Anglamark (Coop) OK som alternativ
3. **Annen meieri:** Fritt valg
4. **Ingen posemat.** Posepotetmos er forbudt.
5. **Aldri husarbeid på lørdag/søndag**
6. **Ukemiddager (man–tors):** Enkle, raske (< 30 min)
7. **Helgemiddager (fre–søn):** Kan ta lengre tid
8. **Alle oppskrifter på norsk** — ingredienser, mengder og instruksjoner
9. **Pinterest:** Martines tavle (pin.it/3oqXgacGd) som inspirasjonskilde — men alt må tilpasses norske ingredienser og butikker
10. **Ignorer veganske/glutenfrie alternativer** fra oppskriftskilder

---

*Dokumentet er klart for gjennomgang. Etter godkjenning starter implementering av v0.1.0.*
