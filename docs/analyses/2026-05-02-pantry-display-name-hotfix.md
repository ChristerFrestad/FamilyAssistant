# Hotfix: Pantry-display viser slug istedenfor original norsk navn

**Dato:** 2026-05-02
**Branch:** `hotfix/pantry-display-name`
**Type:** Bug-fix (pre-eksisterende fra Sprint 5)
**Kompleksitet:** Liten (per CLAUDE.md DEL 3, 2.9 — analyse kortet ned)

---

## Reisen (symptom → rot-årsak)

1. Bruker åpner Shopping-skjermen
   1.1. Skriver "Økologisk rømme" i Quick-Add input
   1.2. Trykker "Legg til"
2. POST `/api/shopping/items` mottar `{ name: "Økologisk rømme" }`
   2.1. `pantryResolver.resolveOrCreate(repos, "Økologisk rømme")` kalles
   2.2. `resolvePantryInput` finner ingen match i products eller inventory_log
   2.3. Faller tilbake til `slugifyProductKey("Økologisk rømme")` → `"okologisk-romme"`
   2.4. Returnerer `{ productKey: "okologisk-romme", name: "Økologisk rømme", source: "ny" }`
   2.5. `shopping_list_items` får INSERT med `ingredient_name = "Økologisk rømme"`,
        `product_key = "okologisk-romme"` — original navn beholdt på radet
   2.6. **`products`-tabellen får INGEN ny rad** ← **BUG ROOT**
3. Bruker krysser av varen som kjøpt
   3.1. PUT `/api/shopping/items/:id/bought` slår opp item
   3.2. `inventory.addPurchase("okologisk-romme", { packSize, unit })` skriver
        til `inventory` med kun `product_key` — ingen display-name-kolonne
   3.3. Audit-log skriver `inventory_log` med `reason='shopping_bought'`
4. Bruker bytter til Pantry-view
   4.1. GET `/api/pantry` itererer `inventory.getAll()`
   4.2. For hver rad: `productsMap[productKey]` → `undefined` (manuelt-item finnes
        ikke i katalog)
   4.3. Faller tilbake til:
        ```
        ingredientName: productKey,                  // "okologisk-romme"
        ingredientNameNo: p?.productName || productKey,  // → productKey
        name: p?.productName || productKey,              // → productKey
        ```
   4.4. UI viser slug-form

## Domenemodell-påvirkning

- `server/services/pantry-resolver.service.js`: `resolveOrCreate` får ny ansvar
  — sikre at en `products`-rad eksisterer for resultatets `productKey`
- `server/repositories/product.repo.js`: bruker eksisterende `upsert`,
  ingen endring
- Database: ingen migrasjon. Eksisterende `products`-tabell har alle nødvendige
  kolonner (`key`, `product_name`, `category`, `pack_size`, `unit`)
- Ingen ny entitet, ingen ny forretningsregel
- `docs/DOMAIN_MODEL.md`: ingen oppdatering — pantry/products-rollene er uendret

## Edge-cases

1. Bruker skriver navn som matcher eksisterende seed-produkt ("Smør") —
   `existing` finnes, vi skipper upsert. Seed-navn beholdt.
2. Bruker skriver navn som slug-kolliderer med seed ("salt" vs eksisterende
   "Salt") — `existing` finnes via `getByKey`, vi skipper upsert. Eksisterende
   navn beholdt.
3. Bruker skriver "ØKOLOGISK RØMME" (uppercase) — slug = "okologisk-romme",
   product_name lagres som "ØKOLOGISK RØMME". UI viser uppercase. Akseptabelt:
   bruker fikk det de skrev.
4. Bruker skriver samme navn to ganger ("Brød" + "Brød") — første call upserter,
   andre call ser `existing`, skipper. Display er "Brød" stabilt.
5. Bruker skriver første gang som "salt" (lowercase), så "Salt" — første call
   upserter med "salt". Andre call ser `existing`, skipper. Display blir "salt"
   permanent. Akseptabelt: bruker bestemte selv første gang.
6. Spesialtegn ("Brød & smør 500g") — slugify fjerner tegn → "brod-smor-500g".
   product_name lagres som "Brød & smør 500g". UI viser med spesialtegn.
7. Tom string / null query — `slugifyProductKey` returnerer "". Vi sjekker
   `productKey` og `originalName` før upsert, skipper trygt.
8. DB-feil under upsert — try/catch, fall back til pre-fix oppførsel
   (slug-display). Ingen propagering.
9. Eksisterende inventory-rad uten products-rad (legacy) — backfill når
   resolveOrCreate kalles igjen for samme key (PUT bought lazy-resolve).
10. Race condition — to samtidige resolveOrCreate. SQLite serialiserer skriving;
    upsert er idempotent (CONFLICT DO UPDATE). Sist skriver vinner, men begge
    skriver samme ting normalt.

## Konsekvenser på tvers

- **Frontend:** ingen endring nødvendig. UI leser allerede `name` og
  `ingredientNameNo` fra GET `/api/pantry` — ingen ny kontrakt.
- **API-endepunkter:** ingen kontrakt-endring. Samme felter returneres.
- **OpenAPI:** ingen oppdatering.
- **Tester:** to nye tester (resolver-service unit-test + integration end-to-end).
  Eksisterende tester forventes å fortsette å passere — vår fix er bakoverkompatibel.

## Beslutninger

**BESLUTNING 1:** Hvor skal "create products row"-logikken bo?
- **ANBEFALING:** I `pantryResolver.resolveOrCreate`, etter at vi har bestemt
  `result.productKey`. Dette dekker alle tre callsites samtidig
  (POST shopping/items, PUT bought-backfill, POST pantry/add).
- **HVORFOR:** Sentralisert. Symmetri med `slugifyProductKey` som er den
  kanoniske key-genereringen. Single source of truth.
- **ALTERNATIVER:**
  - Inline i hver av de tre routes — duplisering, lett å glemme på fjerde
    callsite.
  - Ny dedikert service (`product-ensure.service.js`) — overkill for én
    funksjon med 10 linjer.
- **KONSEKVENS HVIS ANNERLEDES:** Hver ny route som kaller resolveOrCreate
  må huske å gjøre samme upsert manuelt.

**BESLUTNING 2:** Skal vi overskrive eksisterende product_name?
- **ANBEFALING:** Nei — kun INSERT hvis rad ikke eksisterer (sjekk
  `getByKey` først).
- **HVORFOR:** Seed-produkter har autoritative norske navn ("Smør",
  "Brød", "Helmelk"). En bruker som skriver "smor" (uten ø) skal ikke
  overskrive katalog-data.
- **ALTERNATIVER:**
  - Bruk eksisterende `upsert` (CONFLICT DO UPDATE) — overskriver seed
    permanent. Datatap.
  - Track første-skrevet vs senere-skrevet — kompleksitet uten klar gevinst.
- **KONSEKVENS HVIS ANNERLEDES:** Brukerens variant overskriver seed
  permanent for hele familien.

**BESLUTNING 3:** Hva med eksisterende inventory-rader med slug-only navn?
- **ANBEFALING:** Mulighet A — la være. Brukere kan slette og re-adde de
  få problematiske items.
- **HVORFOR:** Migration kan ikke alltid rekonstruere original tekst fra
  slug ("smør" har æ, "okologisk" mangler ø). Vil produsere feil capitalisering
  selv i beste fall.
- **ALTERNATIVER:**
  - Migration som capitalizer første bokstav — "okologisk-romme" →
    "Okologisk-romme". Verre enn slug.
  - Tom liste-migration som setter qty=0 for slug-bare rader — datatap.
- **KONSEKVENS HVIS ANNERLEDES:** Bruker må rydde manuelt — men de er få.

## Portainer-oppstartsrisiko-sjekk

- `Dockerfile` / `.dockerignore`: **nei**
- `docker-compose.yml`: **nei**
- `server/http/bootstrap.js`: **nei**
- `server/config.js`: **nei**
- `server/index.js`: **nei**
- `server/db.js` / `server/migrations/**`: **nei** (ingen migration)
- `install.sh`: **nei**
- `bootstrap.json`-flyt: **nei**
- Miljøvariabel-krav: **nei**

**Konklusjon:** Ingen Portainer-risiko. Lavrisiko hotfix.

## ISO 25010-påvirkning

- **Funksjonell egnethet:** 8.7 → 8.8 (+0.1) — fixer en konkret synlig bug
  som påvirker kjernefunksjon (pantry-display etter manuell add)
- **Brukervennlighet:** 8.5 → 8.6 (+0.1) — bruker ser nå korrekt det de
  skrev, ikke en slug-versjon
- **Vedlikeholdbarhet:** 8.3 → 8.3 (uendret) — fix er sentralisert i én
  funksjon, lavt vedlikeholdsarv
- **Sikkerhet:** ikke berørt
- **Pålitelighet:** ikke berørt (try/catch graceful degradation)

## Plan

1. `feat(pantry-resolver): ensure products row exists for resolved key`
   — modifiserer `pantry-resolver.service.js`:
   - Ny `ensureProductRow(repos, productKey, originalName)`-helper
   - Kalt fra `resolveOrCreate` etter at `result` er bestemt
   - Bruker `repos.products.getByKey` for å sjekke om eksisterer
   - Bruker `repos.products.upsert` med category='Tørrvarer & annet',
     packSize=1, unit='stk' som defaults
2. `test(pantry-resolver): cover ensureProductRow happy path + idempotency`
   — ny `tests/pantry-display-name-hotfix.test.js`:
   - Backend service test: resolveOrCreate("Økologisk rømme") upserter
     products med productName="Økologisk rømme"
   - Backend service test: resolveOrCreate("smor") IKKE overskriver
     eksisterende seed-rad
   - Integration test: POST /api/shopping/items → PUT bought →
     GET /api/pantry returnerer name="Økologisk rømme" (æøå bevart)
   - Integration test: tilsvarende for "Brød", "Yoghurt"
3. (valgfri) Manuell verifikasjon-instruksjoner i PR-beskrivelsen.

## Kompleksitet-vurdering

Liten task per CONTEXT.md. Analysen bekrefter:
- 0 nye domeneentiteter
- 0 forretningsregler endret
- 0 migrasjoner
- ~10 linjer ny kode i kjerne-fix
- Ingen API-kontrakt-endring
- Ingen frontend-endring

Direkte til kode.
