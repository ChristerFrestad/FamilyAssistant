# Post-pilot roadmap

Sist oppdatert: 2026-04-30

Ideer som skal vurderes etter pilot er stabilisert. **Ikke implementer
før pilot-launch.** Dette dokumentet er parkering for fremtidige
funksjoner og en sjekkliste for at dagens kode ikke blokkerer dem.

---

## Smart vare-håndtering

### Smart kategori-tildeling
- Manuelle varer får auto-kategori basert på vare-database-match
- ML-modell eller fuzzy-string-matching mot eksisterende seed
- Bruker kan justere kategori inline

### Kassal-integrasjon for vare-søk
- Søk mot Kassal-API (eksisterende integrasjon i backend)
- Velg eksakt vare med pris, butikk, varenummer
- Auto-fyll merke (Tine, Q-meieriene, etc.) basert på match

---

## Historikk og analyse

### Tidligere handlelister
- Arkiv av tidligere fullførte handlelister
- Filtrer etter dato, butikk, totalsum
- Gjenoppvåkning ("Lag handleliste fra forrige uke")

### Mest brukte varer
- "Top 20 varer" basert på familie-historikk
- Auto-suggest når bruker skriver
- Vis frekvens ("Du kjøper dette hver uke")

### Faste varer
- Eksplisitt liste over "Husholdningsessensielle"
- Auto-add til ny handleliste hver uke
- Bruker kan justere

### Forbruksanalyse
- Trends over tid (kostnad, kategori-fordeling)
- Sammenligning med gjennomsnittsfamilie
- Match mot SSB statistikk

---

## Holdbarhet og forbruk

### Holdbarhet per vare
- Kjøpsdato + kategori → estimert holdbarhet
- Varsler når noe utløper snart
- Forslag til oppskrifter som bruker varer som utløper

### Pantry-management
- "Hva har jeg hjemme nå" (bygge ut Pantry-konsept)
- Match mot oppskrifts-forslag
- Reduserer matsvinn

---

## Påvirkning på dagens kode

For at fremtidige funksjoner skal være enkle å bygge:

### Database-design — krav
Hver vare-rad i `shopping_list_items` skal ha:
- `category` (enum-key, ikke lokalisert)
- `product_id` eller tilsvarende FK til vare-database
- `source_type` ('manual', 'meal-generated', 'recurring', 'pantry-restock')
- `estimated_price` (fra Kassal hvis matchet)
- `purchased_at` (timestamp når toggled bought)

### Bevaring av data
- Ikke slett historiske handlelister (soft-delete med
  `shopping_lists.archived_at`)
- Bygg cleanup-job for veldig gamle (1 år+)

### Indekser for senere analyse
- `shopping_list_items`: index on `(family_id, category)`
- `shopping_list_items`: index on `(family_id, purchased_at)`

---

## Datamodell-fremtidssikring — status per 2026-04-30

Inspeksjon av eksisterende skjema mot kravene over. Ingen endringer
er foretatt som del av Fase 2D — dette er **kun rapport**, oppfølging
i separat PR senere.

### `shopping_list_items` — det som ER på plass

| Krav | Status | Kolonne / detalj |
|---|---|---|
| `category` som enum-key, ikke lokalisert | ✅ kode | Manuelle items setter `'other'` (lowercase enum-key) per Fase 2D-fix. Frontend `KNOWN_CATEGORY_KEYS` mapper til i18n. DB-kolonne er `TEXT` uten CHECK-constraint — ren konvensjon, ikke håndhevet. |
| FK til vare-database | ✅ tre veier | `product_key TEXT` (intern `products.key`), `kassal_product_id INTEGER REFERENCES kassal_products(id)`, `resolution_id INTEGER REFERENCES product_resolutions(id)` (Kassal-fase-B-berikelse). |
| `source_type` enum | ✅ håndhevet | `TEXT NOT NULL CHECK ('meal_ingredient' \| 'consumable' \| 'extra' \| 'manual')`. Manuelle items setter `'manual'` per Fase 2D. |
| `purchased_at` timestamp | ✅ ekvivalent | `bought_at TEXT` (ISO-timestamp via `datetime('now')`-trigger ved bought-toggle). |
| `estimated_price` | ✅ | `est_price REAL` (fylles av Kassal-enricher i fase B). |
| Pakkestørrelse / antall | ✅ ekstra | `pack_size`, `pack_unit`, `pack_count` for sortering og pris. |
| Pantry-kobling | ✅ ekstra | `pantry_has`, `pantry_qty`, `needs_buy` — pantry-suggestion-flyt allerede dekket. |
| Holdbarhets-spor | ✅ delvis | `shelf_observations`-tabell (migration 017) registrerer `purchased_at`, `expires_at`, `product_key`. Ikke direkte FK fra shopping_list_items, men via product_key. |

### `shopping_list_items` — det som MANGLER for fremtidens funksjoner

| Krav | Status | Anbefalt fix |
|---|---|---|
| `category` enum-CHECK i DB | ⚠️ kun konvensjon | Når seed-migrering kjøres (se design-gaps), legg til `CHECK (category IN ('other','produce','meat','dairy','pantry','frozen','beverage','household'))`. |
| Index `(family_id, category)` for analyse | ❌ mangler | `CREATE INDEX idx_shopping_items_family_category ON shopping_list_items(family_id, category);` — billig, kan komme før pilot eller rett etter. |
| Index `(family_id, bought_at)` for historikk | ❌ mangler | `CREATE INDEX idx_shopping_items_family_bought ON shopping_list_items(family_id, bought_at);` — påkrevd for "topp 20 varer" og forbruks-trends. |

### `shopping_lists` — det som ER på plass

| Krav | Status | Detalj |
|---|---|---|
| Bevaring av historikk | ✅ via status-felt | Lister flyttes ikke til søppel; status går `active → superseded → done`. Ingen ON DELETE-cascade fra brukerflyt. |
| `done`-status for fullførte | ✅ | `status` har 'done'-verdi etter `POST /api/shopping/list/:id/done`. |
| Pris-totalsum bevart | ✅ | `total_est_price REAL` cacher Kassal-sum per liste. |

### `shopping_lists` — det som MANGLER

| Krav | Status | Anbefalt fix |
|---|---|---|
| `archived_at` for soft-delete | ❌ mangler | Christer's roadmap krever eksplisitt arkivering for "Tidligere handlelister"-UI. I dag relyer vi på `status='done'`, men det dekker ikke "midlertidig skjul fra liste-historikk". Foreslå `ALTER TABLE shopping_lists ADD COLUMN archived_at TEXT;` + index. |
| Cleanup-job for gamle lister (1 år+) | ❌ mangler | Krever `archived_at` først. Cron-job kan bygges i `server/services/cleanup.service.js`. |
| `purchased_at` på liste-nivå (når storhandling startet) | ⚠️ delvis | `confirmed_at` finnes, men semantikk er "bruker markerte ferdig". Hvis vi skal vise "handlet i forrige uke", er `confirmed_at` god nok — bare merk konvensjonen i analyse-koden. |

### Kode-pattern — bekreftelse

| Pattern | Status | Detalj |
|---|---|---|
| Backend lagrer kategori som enum-key | ✅ for manuelle items | `'other'`-default per Fase 2D-fix (commit `5da9f01`). Seed-genererte items bruker fortsatt norske strenger — separat migrering tracket i `design/2026-04-redesign/design-gaps.md`. |
| Frontend i18n-resolverer for visning | ✅ | `CategoryGroup.tsx` `KNOWN_CATEGORY_KEYS`-set + `t('shopping:categories.{key}')`. |
| `source_type` settes på add | ✅ | `'manual'` for QuickAdd-items (`shopping.repo.js` `addItem`). Auto-genererte items setter `'meal_ingredient'` / `'consumable'` / `'extra'` per generator. |

### Relaterte tabeller som støtter post-pilot-funksjoner

Disse finnes allerede og dekker ulike pieces av roadmap-en uten ny migrering:

| Tabell | Migration | Bruk i roadmap |
|---|---|---|
| `purchase_log` | 001 | Frekvens-statistikk for "topp 20 varer" |
| `receipts` | 005, 014 | Faktiske kjøp med butikk + pris (utover shopping-list est_price) |
| `kassal_products` | (Kassal-integrasjon) | Vare-matching + auto-pris |
| `product_resolutions` | (Kassal-integrasjon) | Adaptiv match-historikk per familie |
| `shelf_observations` | 017 | Holdbarhets-tracking |
| `inventory` + `inventory_log` | 001, 007 | Pantry-state + endrings-historikk |

### Sammendrag

- **Klar for pilot uten endringer:** category enum-konvensjon (kode-
  side), source_type, FK-er til products/Kassal, bought_at, est_price.
- **Mangler men ikke kritisk for pilot:**
  - Index på `(family_id, bought_at)` og `(family_id, category)` —
    rask migrering når historikk-funksjoner planlegges.
  - `shopping_lists.archived_at` — for "Tidligere handlelister"-UI.
  - Seed-data og recipe-generated items bruker norske kategori-
    strenger — egen migrering før engelsk-pilot. Sporet i
    `design/2026-04-redesign/design-gaps.md`.
- **Allerede dekket:** Kassal-FK-er, pantry-state, receipts, shelf-
  life, purchase-log. Roadmap-funksjonene har database-fundament for
  >80% av scope, det som mangler er felles indeks-tuning og en
  arkiv-kolonne.

Ingen endringer foretas i denne PR-en. Migrering planlegges separat
post-pilot.
