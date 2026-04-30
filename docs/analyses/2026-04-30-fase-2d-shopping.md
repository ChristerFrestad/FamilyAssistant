# Fase 2D — Shopping list screen (Sprint 5 start)

**Dato:** 2026-04-30
**Branch:** `feat/fase-2d-shopping`
**Forventet PR:** #81 eller etter
**Status:** ANALYSE — venter på Christers beslutning på B1–B9 før koding starter.

---

## 1. Reisen

Bruker åpner Handleliste-skjermen.
1.1. Frontend kaller `GET /api/shopping/list/current` parallelt
     med `GET /api/family` (sistnevnte for portionSum hvis relevant
     for senere skalert generer-fra-måltider).
1.2. Backend returnerer enten en aktiv liste eller et tomt skall
     (`id: null, items: [], categories: []`) hvis ingen liste finnes
     for inneværende uke.
1.3. UI viser en av tre tilstander:
   - 1.3.1. Loading: skeleton.
   - 1.3.2. Tom uke uten liste: empty-state med to CTA-er — quick-add
     input + "Generer fra ukens middager" (kaller `POST /api/shopping/generate`).
   - 1.3.3. Liste finnes: kategori-gruppert vise med items.

Bruker krysser av for "kjøpt" på et item.
2.1. Frontend viser optimistisk strikethrough + checkmark.
2.2. Frontend kaller `PUT /api/shopping/items/:id/bought`.
2.3. Hvis 2xx: state holdes.
2.4. Hvis 4xx/5xx: rollback + toast med feilmelding.
2.5. Backend oppdaterer pantry via inventory.addPurchase + skriver
     `inventory_log` med reason='shopping_bought'.

Bruker krysser av igjen (toggle off).
3.1. Frontend viser optimistisk fjerner strikethrough.
3.2. Frontend kaller `PUT /api/shopping/items/:id/unbought`.
3.3. Backend rydder bought_at, bought_qty og setter needs_buy=1.
     Pantry-mengde rolles **ikke** tilbake (kommentert i routes.js
     1001 — usikkert om bruker har spist noe).

Bruker sletter et item.
4.1. Frontend viser bekreftelse (inline X-knapp + bekreftelses-toast,
     ikke modal — for å holde det raskt).
4.2. Frontend kaller `DELETE /api/shopping/items/:id`.
4.3. Backend permanent sletter raden — ingen soft-delete.
4.4. Hvis bruker trykker tilbake på "Angre" i toast: re-add via
     POST /api/shopping/items (krever ny endpoint, B2 nedenfor).
     For pilot-MVP: vi tilbyr ikke angre på slett — toast varer 3s
     og forsvinner.

Bruker legger til ny item via quick-add.
5.1. Frontend viser input-felt (sticky bunn + plus-button på toppen).
5.2. Bruker skriver "melk", trykker Enter eller "Legg til".
5.3. Frontend sjekker at lista finnes (id != null).
   - 5.3.1. Hvis lista finnes: kaller `POST /api/shopping/items`
     (NY ENDPOINT, se B2).
   - 5.3.2. Hvis ingen liste: kaller `POST /api/shopping/add` for å
     legge til shopping_extras + `POST /api/shopping/generate` for å
     generere første liste. (Ikke i scope for denne PR; B3.)
5.4. Optimistisk legg til i UI med temporal id.
5.5. Hvis 2xx: bytt temporal id med real id fra responsen.
5.6. Hvis 4xx/5xx: rollback + toast.

Bruker trykker "Generer fra ukens middager".
6.1. Frontend viser confirm-toast eller modal.
6.2. Frontend kaller `POST /api/shopping/generate` (uten force).
6.3. Backend genererer + responderer { listId, itemCount, needsBuyCount }.
6.4. Frontend re-fetcher /api/shopping/list/current og viser nye items.
6.5. Hvis backend kaster 400 WEEK_NOT_COMPLETE: toast forklarer at
     ukens måltider ikke er ferdigplanlagt. Pilot-MVP kaster bare
     toast — ingen "fyll ut ukens måltider"-flow her.

Bruker bytter mellom kategori-grupper og flat liste.
7.1. Default: kategori-gruppert (backend gir oss `categories[]`).
7.2. Toggle "Flat" sortert alfabetisk client-side. (Spørsmål B4: er
     dette nødvendig for pilot? Anbefaling: nei.)

---

## 2. Domenemodell-påvirkning

### 2.1 Eksisterende entiteter (uendret)

- `shopping_lists` — finnes (migrasjon 007). Kolonner: id, family_id,
  week_year, status (active/draft/done/superseded), generated_at,
  confirmed_at, enrichment_status, total_est_price, notes.
- `shopping_list_items` — finnes (migrasjon 007). Detaljert: id,
  family_id, list_id, source_type, ingredient_name, product_key,
  qty, unit, category, pack_size, est_price, pantry_has, pantry_qty,
  needs_buy, bought_at, bought_qty, kassal_product_id,
  resolution_id, meals_json, sort_order. **Mer enn nok** for skjermens
  behov.
- `shopping_extras` — finnes. For items lagt til **før** generering.
  Vi bruker den ikke direkte i denne PR fordi quick-add går mot
  aktiv liste (B2).

### 2.2 Eksisterende endpoints brukt som-er

- `GET /api/shopping/list/current` — returnerer aktiv liste eller
  tomt skall. Items er kategori-gruppert. Brukes som primær fetch.
- `PUT /api/shopping/items/:id/bought` — toggle bought (gjør også
  pantry-update). Krever `requireRole('adult')`.
- `PUT /api/shopping/items/:id/unbought` — undo bought.
  Krever adult-rolle.
- `DELETE /api/shopping/items/:id` — permanent slett. Adult-rolle.
- `POST /api/shopping/generate` — generer liste fra ukens måltider.
  Adult-rolle. Returnerer `WEEK_NOT_COMPLETE` 400 hvis uken ikke er
  ferdigplanlagt og force=false.

### 2.3 Mulig nytt endpoint (B2-beslutning)

**Hvis B2 = "ja, bygg quick-add":**

`POST /api/shopping/items` — legg til ett item på den aktive lista.
Body: `{ name: string, qty?: number, unit?: string, category?: string }`.
Schema: ny `shoppingItemAddBody` i `server/schemas.js`.
Implementasjon:
1. Hent aktiv liste for inneværende uke. Hvis ingen: 400
   NO_ACTIVE_LIST.
2. Insert i shopping_list_items med source_type='manual',
   source_ref=null, sort_order=max+1, needs_buy=1.
3. Returner `{ ok: true, item: {...} }` med samme form som items[]
   i list/current.

Dette er en isolerbar tillegg — ikke endring av eksisterende
oppførsel — og passer DEL 5.3 feature/-flyten.

### 2.4 Berørte filer

**Backend (kun ved B2=ja):**
- `server/routes.js` — ny route etter eksisterende /unbought.
- `server/schemas.js` — ny `shoppingItemAddBody` Zod schema.
- `server/repositories/shopping.repo.js` — ny `addItem(listId, item)`
  metode.
- `tests/shopping-items-add.test.js` — ny test-fil.

**Frontend:**
- `client/src/app/shopping/shoppingApi.ts` (NY)
- `client/src/app/shopping/shoppingApi.test.ts` (NY)
- `client/src/app/shopping/useShoppingData.ts` (NY)
- `client/src/app/shopping/useShoppingData.test.tsx` (NY)
- `client/src/app/components/shopping/ShoppingHeader.tsx` (NY) —
  tittel + statistikk-badge
- `client/src/app/components/shopping/ShoppingItemRow.tsx` (NY) —
  én rad per item
- `client/src/app/components/shopping/QuickAddInput.tsx` (NY)
- `client/src/app/components/shopping/CategoryGroup.tsx` (NY) — wrapper
  per kategori med count + sum
- `client/src/app/components/shopping/EmptyState.tsx` (NY) — egen
  komponent for tom liste + ingen liste
- `client/src/app/components/shopping/*.test.tsx` (NY × ~5)
- `client/src/app/screens/Shopping.tsx` (REPLACE placeholder)
- `client/src/app/screens/Shopping.test.tsx` (NY — erstatter
  placeholder-test i screens.test.tsx)
- `client/src/app/screens/screens.test.tsx` — fjern Shopping fra
  placeholder-tester
- `client/src/app/i18n/locales/no/shopping.json` (UTVIDE)
- `client/src/app/i18n/locales/en/shopping.json` (UTVIDE)

### 2.5 Ikke-berørt

- `docs/DOMAIN_MODEL.md` — ingen ny entitet. Eksisterende shopping-
  modell dekker behovet. Hvis B2=ja, ingen ny entitet — bare ny
  source_type-instans ('manual') som allerede er i CHECK-listen i
  migrasjon 007.

---

## 3. Edge-cases (12+)

1. **Ingen aktiv liste, tom uke:** `GET /api/shopping/list/current`
   returnerer `{ id: null, items: [] }`. UI viser empty-state med
   primær CTA "Generer fra ukens middager" og sekundær CTA quick-add.
2. **Aktiv liste eksisterer, men alle items er `bought`:** Vis listen
   med strikethrough på alle. Vis "Generer ny liste" som ny CTA?
   *Anbefaling: nei i pilot-MVP — la bruker gjøre det manuelt.*
3. **Item uten kategori:** backend defaulter til 'Tørrvarer & annet'.
   UI rendrer dette som "Annet" hvis vi vil — men 'Tørrvarer & annet'
   er allerede menneskelig. *Anbefaling: bruk backend-verdien som-er.*
4. **Item med `qty=null` og `unit=null`:** UI viser bare navnet.
   Mockup-defaulten "1 stk" er feilaktig — vi har faktisk ingen
   kvantitet. *Anbefaling: skip qty-blokk når både qty og unit
   mangler.*
5. **`POST /api/shopping/generate` returnerer 400 WEEK_NOT_COMPLETE:**
   Bruker har ikke planlagt alle ukens dager. UI viser toast med
   forklaring + lenke til /v2/meals.
6. **Bruker legger til 50 items via quick-add raskt etter hverandre:**
   Race condition mellom optimistic state og PR responses. Hver
   request får eget temporal id; mapping replaces når response
   kommer. Tester må dekke dette.
7. **Bruker krysser av "kjøpt" mens nettverket er nede:**
   Optimistic toggle vises. Etter 5s timeout: rollback + toast
   "Kunne ikke lagre — prøv igjen".
8. **Bruker krysser av "kjøpt" på et item som allerede er bought
   (race med en annen tab/enhet):** Backend returnerer
   `{ ok: true, alreadyBought: true }`. UI er konsistent siden state
   allerede er "bought".
9. **Item med svært langt navn (200+ tegn):** Trunker visuelt med
   ellipsis, men full tekst i `title`-attributtet for tilgjengelighet.
10. **`/api/shopping/list/current` returnerer 401:** AppShell-AuthGuard
    håndterer dette; vi kommer aldri hit. Defensivt redirect til
    /v2/login hvis det skjer likevel (følger Meals-mønster).
11. **`/api/shopping/list/current` returnerer 5xx:** Vis error-state
    med retry-knapp. Ingen automatisk retry — la bruker bestemme.
12. **Backend leverer items uten `id`:** Skal aldri skje (SQL
    AUTOINCREMENT), men hvis det skjer: skip raden + console.warn
    med telemetry-tag (`shopping.item.missingId`). Følger samme
    defensive design som Meals (telemetry-warns).
13. **Item har `meals_json: ["Kremet laks", "Pasta pesto"]`:** UI
    viser "Til 2 retter" eller "Til Kremet laks +1". *Anbefaling:
    "Til Kremet laks" + count hvis >1.*
14. **Mobile + landscape:** Quick-add må forbli synlig (sticky bottom).
    iOS-keyboard skyver opp viewport — verifiser at quick-add ikke
    skjules.

---

## 4. Konsekvenser på tvers

### 4.1 Frontend
- Erstatter Shopping-placeholder. Routing fra /v2/shopping er
  allerede satt opp i `App.tsx:98`.
- Fjerner Shopping fra `screens/screens.test.tsx` (linje 37–40).
- Bundle-impact: ny skjerm, ~5 nye komponenter, +1 i18n-namespace
  (utvidet). Forventet bundle-impact: +5–8 KB gzipped basert på
  Meals-skjermen som la til ~4 KB.

### 4.2 Backend
- **Hvis B2=ja:** ny route + repo-metode + schema + tester. Total
  estimert: ~80–120 linjer nytt + ~150 linjer test.
- **Hvis B2=nei:** ingen backend-endringer.

### 4.3 Tester som må utvides
- `client/src/app/screens/Shopping.test.tsx` — full screen-test
  (loading/empty/error/data states + interaksjoner).
- Komponent-tester for ShoppingItemRow, QuickAddInput,
  CategoryGroup, ShoppingHeader, EmptyState.
- API-tester for shoppingApi.ts.
- Hook-tester for useShoppingData.ts.
- `i18n/bundles.test.ts` — automatisk parity-test, ikke endret.

### 4.4 OpenAPI
- **Hvis B2=ja:** dokumenter `POST /api/shopping/items` i
  `openapi.yaml`.

### 4.5 DOMAIN_MODEL.md
- Ingen oppdatering nødvendig (ingen ny entitet, ingen ny
  forretningsregel).

---

## 5. Beslutninger (med anbefaling)

### B1: Sub-toggle Handleliste/Pantry?

**ANBEFALING:** Skip Pantry-tab i denne PR-en. Pantry blir egen
skjerm i Sprint 6+.

**HVORFOR:** Mockup viser segmented toggle Handleliste/Pantry, men
Pantry er en egen skjerm-arketype (mange items, søk, expiry,
manuell kvantitets-correction). Å bygge inn som sub-tab her ville
strekke scope og dilute fokus.

**ALTERNATIVER:**
- (a) Bygg begge nå: ~2x scope og dårligere skjerm-ergonomi for
  begge. **Forkastet.**
- (b) Bygg kun Handleliste her (anbefalt): klar fokus, raskere
  pilot-vei. Pantry-skjerm blir egen Sprint 6+.

**KONSEKVENS HVIS ANNERLEDES:** PR-en blir nesten dobbelt så stor.

---

### B2: Quick-add — bygg ny backend-endpoint?

**ANBEFALING:** Ja — bygg `POST /api/shopping/items` som DEL 5.3-flyt.

**HVORFOR:** Quick-add er kjernefunksjon i mockup ("plus-button" på
progress panel + søkefelt på toppen). Uten den er skjermen halvveis.
Eksisterende `POST /api/shopping/add` legger til `shopping_extras`
(pre-generation) — ikke i en aktiv liste. Eksisterende
`POST /api/shopping/generate` regenererer hele lista — feil for
"legg til melk".

Den nye endpointen er en isolerbar, klar tillegg på en eksisterende
modell. Source_type='manual' er allerede i CHECK-listen i migrasjon
007.

**ALTERNATIVER:**
- (a) Bygg ny endpoint (anbefalt). Estimert 80–120 linjer kode +
  150 linjer test.
- (b) Skip quick-add i denne PR-en — bare read + toggle/delete.
  Pilot-bruk blir mangelfull.
- (c) Rute quick-add via add+regenerate. Hacky, ødelegger bought-
  state på eksisterende items. **Forkastet.**

**KONSEKVENS HVIS ANNERLEDES:** Hvis (b) — pilot-bruker kan ikke
legge til ad-hoc items. Vi får føle på det i bruk og bygge senere.

---

### B3: "Generer fra ukens middager"-CTA?

**ANBEFALING:** Ja — knapp som kaller `POST /api/shopping/generate`
uten force. Vises som primær CTA hvis ingen aktiv liste finnes,
sekundær (i meny eller hjørne) hvis lista er aktiv.

**HVORFOR:** Backend støtter det allerede (eksisterende endpoint).
Det er den primære måten å bygge en handleliste på i appens design
— uten den må bruker manuelt legge til hvert ingredients fra hver
oppskrift.

**ALTERNATIVER:**
- (a) Vis alltid (primær når tom, sekundær når aktiv) (anbefalt).
- (b) Vis kun når tom liste. Aktiv liste får ingen "regenerer"-
  knapp. Da må bruker slette aktiv liste manuelt for å regenerere.
  Dårligere UX.
- (c) Skip helt — pilot-MVP. Bruker må legge til items manuelt.
  Veldig dårlig UX uten quick-add først.

**KONSEKVENS HVIS ANNERLEDES:** (b) gir litt enklere UI men
dårligere flyt. (c) bryter en nøkkelfunksjon.

---

### B4: Sortering-toggle (Kategori vs Alfabetisk)?

**ANBEFALING:** Skip toggle. Default kategori-sortert.

**HVORFOR:** Mockup viser ikke alfabetisk-toggle. Backend leverer
allerede kategori-sortering med kjede-preferanse (REMA, Kiwi etc).
Alfabetisk innenfor kategori er allerede sekundær sortering. Ekstra
toggle = ekstra kompleksitet uten klar bruker-verdi.

**ALTERNATIVER:**
- (a) Skip toggle (anbefalt).
- (b) Implementer client-side alfabetisk-sort. ~30 linjer + test.
  Lite verdi for pilot.

**KONSEKVENS HVIS ANNERLEDES:** Mer kode, ingen funksjonell verdi.

---

### B5: Filter-chips per kategori?

**ANBEFALING:** Skip i denne PR-en. Vurderes Sprint 6+.

**HVORFOR:** Mockup viser filter-chips ("alle, frukt & grønt, ...").
Pilot-bruker har trolig 10–30 items i lista — kategori-grupperingen
er allerede et naturlig filter. Filter-chips legger til >50 linjer
kode (state, accessibility) uten betydelig verdi for pilot.

**ALTERNATIVER:**
- (a) Skip (anbefalt).
- (b) Implementer chips. Krever fokus-håndtering, aria-roles,
  scroll-snap. ~80 linjer.

**KONSEKVENS HVIS ANNERLEDES:** Mer scope.

---

### B6: Kontekstmeny per item ("Har hjemme" / "Ikke foreslå" / "Slett")?

**ANBEFALING:** Forenklet — kun "Slett"-knapp inline. Ingen "..."-
meny i denne PR-en.

**HVORFOR:**
- "Har hjemme" — krever pantry-skjerm-kontekst som ikke finnes ennå.
- "Ikke foreslå" — krever nytt backend-endpoint
  `POST /api/preferences/unpreferred`. Ut av scope.
- "Slett" — kjernefunksjon, kan vises som inline X-knapp.

**ALTERNATIVER:**
- (a) Inline X (anbefalt).
- (b) "..."-meny med kun "Slett". Mer komponent-arbeid uten verdi.
- (c) Full meny som mockup. Tre nye flyter, mye scope.

**KONSEKVENS HVIS ANNERLEDES:** (b) er ok men unødvendig. (c) blåser
opp scope.

---

### B7: Recipe-link på item ("til Kremet laks")?

**ANBEFALING:** Ja — vis hvis `mealsJson` er tilstede.
Format: "Til {oppskrift}" hvis 1, "Til {oppskrift} +N" hvis flere.

**HVORFOR:** Backend leverer `mealsJson: string[]`. Verdi for bruker —
ser hvorfor ingredient er på lista. Ingen ekstra fetch.

**ALTERNATIVER:**
- (a) Vis (anbefalt).
- (b) Skip. Mister kontekst.

**KONSEKVENS HVIS ANNERLEDES:** Tap av kontekst, men ikke kritisk.

---

### B8: Pris-display (Kassal-enrichment)?

**ANBEFALING:** Vis `estPrice` per item hvis >0, og total i header
("~382 kr igjen"). Skip hvis 0/null.

**HVORFOR:** Backend leverer det automatisk (Kassal fase B). Verdi
for bruker (budsjettering). Defensiv — vi viser kun det vi har.

**ALTERNATIVER:**
- (a) Vis hvis >0 (anbefalt).
- (b) Skip helt. Tap av valuta-kontekst.

**KONSEKVENS HVIS ANNERLEDES:** (b) gir mindre nyttig display.

---

### B9: Statistikk-display (mockup viser Ring + sum kr igjen)?

**ANBEFALING:** Forenklet — antall plukket / totalt + sum kr igjen
som kompakt header-badge. Ingen Ring-komponent (utsettes til
designsystem-utvidelse).

**HVORFOR:** Mockup har en Ring-komponent som vi ikke har i
designsystem. Å bygge en SVG-ring her = scope-utvidelse.
Tekst-statistikk er like informativt for pilot.

**ALTERNATIVER:**
- (a) Tekst-statistikk (anbefalt).
- (b) Bygg Ring-komponent. ~50 linjer SVG + test. Kan gjøres senere
  som designsystem-utvidelse for flere skjermer.

**KONSEKVENS HVIS ANNERLEDES:** (b) flytter scope inn i denne PR-en.

---

## 6. Portainer-oppstartsrisiko-sjekk

| Område | Berørt? |
|---|---|
| `Dockerfile` / `.dockerignore` | nei |
| `docker-compose.yml` | nei |
| `server/http/bootstrap.js` | nei |
| `server/config.js` (oppstartsvalidering) | nei |
| `server/index.js` (startup-sekvens) | nei |
| `server/db.js` / `server/migrations/**` | nei |
| `install.sh` | nei |
| `bootstrap.json`-lesning/-skriving | nei |
| Miljøvariabel-krav for oppstart | nei |

**Konklusjon:** ingen Portainer-risiko. Klient-only + mulig backend-
route som ikke berører oppstart.

---

## 7. ISO 25010-påvirkning

Forventet effekt per berørt karakteristikk (begrunnelse i parentes).

| Karakteristikk | Før | Etter | Δ | Begrunnelse |
|---|---|---|---|---|
| Funksjonell egnethet | 8.9 | 9.0 | +0.1 | Pilot-bruker kan endelig handle. Erstatter placeholder. |
| Brukbarhet | 8.7 | 8.7 | 0 | Følger samme designsystem; ingen ny erfaring. Ny skjerm balanserer mot fortsatt placeholder Calendar. |
| Pålitelighet | 8.5 | 8.5 | 0 | Defensiv null-handling, ingen ny risiko. |
| Vedlikeholdbarhet | 8.3 | 8.3 | 0 | Følger etablert mønster fra Dashboard/Family/Meals. Ingen ny abstraksjon. |
| Sikkerhet | 8.2 | 8.2 | 0 | Hvis B2=ja: ny route bruker `requireRole('adult')` + Zod. Ingen ny eksponering. |
| Testbarhet | 8.6 | 8.6 | 0 | Følger samme test-mønster. Bidrar til total test-count men ikke karakteristikk. |
| Ytelse | 8.4 | 8.4 | 0 | Single fetch + lokal state. Ingen N+1 eller heavy compute. |

**Snitt:** ~8.55 → ~8.56 (avhengig av hvordan vi vekter).

Ingen karakteristikk under 8.0 før eller etter.

---

## 8. Plan (per commit, etter squash)

Forventet 2 squashet commits per CLAUDE.md DEL 5.2.3:

1. **`docs(analysis): add analysis for fase-2d-shopping`**
   - Bare denne filen.
2. **`feat(client/shopping): Fase 2D Shopping screen`** (eller delt
   i backend + frontend hvis B2=ja):
   - 2a. (hvis B2=ja) **`feat(server): add POST /api/shopping/items`**
     — schema + repo-metode + route + tester. ~250 linjer netto.
   - 2b. **`feat(client/shopping): Fase 2D Shopping screen`** —
     hele skjerm + komponenter + i18n + tester. ~1500+ linjer netto.

Alternativ: holdes som 3 commits hvis B2=ja (analysen + backend +
frontend), siden det er to helt separate concerns. Final-decision
ved push-tid (DEL 5.2.3 sier 1–3 squashet commits, ikke nødvendigvis
2).

---

## 9. Kompleksitet-vurdering

Christer estimat: "Sprint 5 start, første skjerm". Min vurdering:
**Større enn Meals (Fase 2C)**, fordi:
- Meals var ren read. Shopping er full CRUD.
- Mockup har flere interaktive elementer (toggle, delete, add).
- Mulig backend-tillegg (B2).
- Optimistic updates for 3 distinkte mutasjoner (toggle bought,
  delete, add).

Estimat: 2–3 dagers arbeid. Ingen scope-overraskelser foreløpig.

---

## 10. Spørsmål til Christer (FØR koding starter)

Bekreft B1–B9 over. Foreslår eksplisitt:

- **B1:** Skip Pantry-tab. ✅?
- **B2:** Bygg ny `POST /api/shopping/items` endpoint. ✅?
- **B3:** "Generer fra ukens middager" som CTA. ✅?
- **B4:** Skip alfabetisk-toggle. ✅?
- **B5:** Skip filter-chips. ✅?
- **B6:** Kun inline X-slett, ingen "..."-meny. ✅?
- **B7:** Vis recipe-link på item. ✅?
- **B8:** Vis pris hvis >0. ✅?
- **B9:** Tekst-statistikk i header (ingen Ring-komponent). ✅?

Ved JA på alle: jeg starter implementering med B2-endpoint som
første commit etter analyse.

Ved NEI på noen: foreslå alternativ — jeg vurderer scope og
oppdaterer analysen før koding.
