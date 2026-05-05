# Post-pilot roadmap

Sist oppdatert: 2026-05-03

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

---

## High-priority differensiatorer (lagt til 2026-05-03)

To features som Christer identifiserte under pilot-test og som er
sterke differensiatorer mot konkurrenter. Begge er **post-pilot** —
ikke implementer før pilot er stabilisert. Logget her så de ikke faller
gjennom sprekkene.

### Product packaging awareness

**Problem.** Recipes spesifiserer ingredienser i gram eller stykk
("330 g kjøttdeig"), men butikker selger ferdigpakker
("500 g pakke pulled pork"). Handlelisten viser i dag den recipe-
aggregerte mengden, som ikke oversetter rent til "ta én av disse fra
hylla". Pantry-tracking har det motsatte problemet — brukeren kjøper
500 g, oppskriften bruker 330 g, og vi har ingen plass å lande de
170 g restmengden.

**Outcome.** Handlelista leses som en virkelig handleliste ("1 pakke
kjøttdeig 400 g"), pantry tracker rest-mengde per pakke, og måltids-
trekk konsumerer fra riktig pakke først.

**Skisse.**
- Product-tabellen får `pack_size_g` og `pack_unit` (eller gjenbruk
  eksisterende `kassal_products`-berikelse når den finnes).
- Handleliste-rendering konverterer recipe-aggregert qty til N pakker
  (`ceil(needed / pack_size)`) og viser pakke-nivå-rader.
- Pantry tracker to qty-akser: antall pakker + restmengde i åpen
  pakke.
- Måltids-trekk foretrekker åpen pakke til den er tom, så åpner neste.

**Avhengigheter.** Enten Kassal-API-berikelsen vi allerede har
(autoritativ kilde for ekte pakkestørrelser) ELLER en manuell
produkt-katalog-feature for brukere uten API-tilgang.

**Estimat.** 2–3 uker. Schema-endringen er liten, men rendering- og
trekk-logikken berører hver pantry/shopping-touchpoint.

### Pantry-aware recipe suggestions

**Problem.** Dagens picker er "browse alle oppskrifter etter kategori".
Det er ingen signal som drar brukeren mot oppskrifter som bruker det
som allerede ligger i pantry. Det betyr matsvinn (ingredienser som
eldes uten bruk) og missed opportunities ("du har laks i kjøleskapet —
her er tre oppskrifter som bruker det").

**Outcome.** "Plan from pantry"-modus der pickeren, dag for dag,
rangerer oppskrifter etter hvor mye av deres ingrediens-liste som
allerede er på lager. Tom kjøleskap → eksisterende browser. Fullt
kjøleskap → en plan som tømmer det.

**Skisse.**
- Backend har allerede pantry-coverage-scoring inni
  `shopping-list.service.computeShoppingListForWeek` (vet pantry-has
  vs still-need per ingrediens). Løft ut til en per-recipe coverage-
  helper.
- Frontend picker får ny mode-toggle: "Browse" (dagens) vs "Fra
  pantry" (ny).
- "Fra pantry"-modus rendrer samme oppskrifts-cards men sortert etter
  coverage % desc, med en liten "bruker 6/8 ingredienser du har"-
  badge.
- Optional: en "fyll uka fra pantry"-knapp som velger de syv høyest-
  scorende oppskriftene (med lett constraint: ingen oppskrift to
  ganger på rad, miks kategorier).

**Avhengigheter.** Ingen — pantry-scoring eksisterer. UX trenger
et par design-runder for å føles riktig.

**Estimat.** 1–2 uker.

### Triage

Begge er post-pilot. Pilot-exit-kriteriet er "Christer kan planlegge
måltider, generere handleliste, markere tilberedt, og pantry tracker
det som brukes" — begge feature-ene over sitter på toppen av denne
loopen.

Når pilot exiter, prioriter dem etter hvilken Christer treffer i sin
daglige flow mer smertefullt. Pakkestørrelse-awareness vinner
sannsynligvis på handlelistens nøyaktighet alene; pantry-aware
suggestions vinner på "reduserer matsvinn"-framing for marketing.

### Kassal-aktivering med live-priser (lagt til 2026-05-03)

**Status etter pilot-pakke-display-PR:** Frontend viser nå pakke-info
(antall pakker, pakkestørrelse, "du trenger X")-format basert på
internal `products`-tabellen og dens hardkodede seed-priser fra april
2026. Den fulle Kassal-infrastrukturen er bygget men aldri aktivert:

- `kassal_products` (SKU-katalog), `product_resolutions`,
  `kassal_cache` — alle 0 rader på Christer's DB
- `KASSAL_API_KEY` ikke satt
- `shopping-list-enricher.service.js` returnerer `done`-noop ved
  hver kjøring fordi API-key mangler
- `kassal-client.service.js` (token bucket 55 RPM, circuit breaker,
  cache TTL) er klar til å kjøre

**Hva som mangler for å gå live:**

1. Christer setter `KASSAL_API_KEY` via:
   - `.env.local` (lokal utvikling), eller
   - Bootstrap-flow / env-store (produksjon på Portainer)
2. Verifiser API-key via `env-store.testIntegration('kassal')`-helper
3. Trigger initial enrichment for eksisterende lister:
   `POST /api/shopping/list/:id/enrich`
4. Frontend må håndtere `enrichment_status`:
   - `pending` / `running`: vis "Henter priser..." subtle indikator
   - `partial`: vis "Noen priser mangler — prøv igjen"-CTA
   - `failed`: vis "Kunne ikke hente priser fra Kassal" + retry
   - `done`: ingen ekstra UX, items er enriched
5. Når enricher fanger Kassal-data, skriver den til
   `shopping_list_items`:
   - `kassal_product_id` peker til SKU
   - `est_price` oppdateres med faktisk Kassal-pris
   - `pack_size` evt. oppdateres hvis Kassal har annen størrelse
     enn intern seed
6. UI viser oppdatert pris automatisk siden ShoppingItemRow allerede
   leser `estPrice` fra responsen
7. Optional polish: vis butikk-logo (Kassal returnerer
   `last_seen_store`), brand-info, image_url

**Estimat:** 1-2 dager.

**Risiko-vurdering:**
- Kassal-API kan ha endret seg siden migration 006 (2026-04). Test
  mot live API før du stoler på shape.
- Rate limit 55/60 = 0.91 req/sec. Christer's 40 meal-ingredient-rader
  → ~44 sek for første enrichment. Akseptabelt.
- Stale-if-error fallback gjør at degradert API ikke krasjer flow.

**Hvorfor ikke nå:** pilot 14-17. mai er for nær. Pakke-display-PR
løser kjerne-bekymringen (synliggjør pakke vs recipe-mengde) uten å
introdusere ekstern avhengighet under pilot. Kassal-live-priser kan
kobles på etter pilot uten breaking changes — datamodellen og
enricher-flyten er allerede der.

**Filer involvert (forventet endring):**
- `server/services/env-store.service.js` (Kassal-key-validering finnes)
- `client/src/app/screens/Shopping.tsx` (enrichment-status UI)
- `client/src/app/components/shopping/EnrichmentStatusBadge.tsx` (ny)
- `client/src/app/i18n/locales/{no,en}/shopping.json` (status-keys)

---

## Post-Pilot Family Features Roadmap (loggført 2026-05-05, Sprint 9 plan)

Christer re-scopet Sprint 9 fra MVP-basis til **kvalitets-fokus** når
strategien gikk fra "hard pilot-deadline" til "pre-pilot soft-launch
til fokusgruppe". Sprint 9 (PR #119) leverer derfor en full
invitasjons-flyt med polish.

### Sprint 9: Family Invitation (implementert i PR #119)

- Standard invitasjons-flyt: opprett, list pending, trekk tilbake,
  send på nytt
- Personlig melding (max 500 tegn) som vises i email + accept-side
- Pre-validering ved create — `EMAIL_ALREADY_MEMBER` og
  `EMAIL_ALREADY_INVITED` (409 med machine-readable code)
- Resend-endpoint som roterer token og gjenbruker locale + melding
- 5-state accept-page (`/v2/invite/:token`): loading, valid-anon,
  valid-match, valid-mismatch (logout-redirect), error (404 / 410 /
  409 / 5xx)
- Norsk + engelsk i18n-dekning (alle strings + 4 email-templates)
- DEL 14 cross-tenant tester for create + resend + revoke
- ISO 25010: brukbarhet 8.5 → 8.7, sikkerhet 8.2 → 8.3

### Utsatt til post-pre-pilot (eksplisitt nedprioritert i Sprint 9)

- **Bulk-invitasjoner:** invitere flere e-poster i én operasjon
- **Invitation analytics:** open-rate / accept-rate per familie
- **Custom branding per family:** egen logo / farge-palett (i tillegg
  til operatør-nivå white-label via `APP_NAME`)
- **Email-template-editor:** admin-flate for å redigere
  invitation-{no,en}.{html,txt} uten redeploy

Punktene under er bredere familie-funksjoner som var utsatt før
Sprint 9 og forblir utsatt — de logges her så de ikke forsvinner.

### Sprint 10: Subaccounts (barn 4-18)

- Foreldre oppretter familiemedlem med navn, fødselsdato, allergier,
  porsjonsfaktor (eksisterer allerede i `family_profile_members`)
- Optional 4-sifret PIN per barn (ny migrasjon: `family_profile_members.pin_hash`)
- Barn med PIN kan logge inn på familie-enhet (egen login-flow)
- Begrenset rettigheter (read-only først, granular permissions i Sprint 11)

### Sprint 11: Granulære permissions

- Per-barn-config: meal-planning, husarbeid-marking, dashboard-access,
  handleliste-tilgang
- Familie-eier kontrollerer alle permissions via Family-side
- Backend: ny tabell `family_member_permissions(profile_member_id, scope, allowed)`

### Sprint 12: Adaptive UX og templates

- Aldersgrupperte profil-templates (4-7, 8-12, 13-17)
- Auto-anbefale endringer når barn blir eldre
- Foreslå template-overgang ved aldersmilepæler
- Backend: ny CRON-job sjekker fødselsdatoer mot template-grenser

### Sprint 13: Leaderboard og gamification

- Husarbeid-poeng per barn (utvid `chore_completions` med `points`-felt)
- Visuell progresjon (ny screen + chart-komponenter)
- Familie-leaderboard
- Belønnings-systemet (foreldre-konfigurerbart, ny tabell `chore_rewards`)

### Sprint 14: Voksne barn (18-25) som gjeste-medlemmer

- 'Frontside' invitasjoner til middager (ny invitasjon-type:
  `assigned_role='guest'`)
- 'Forespørsel om middag'-flow (barn → eier; ny endpoint
  `POST /api/meals/:id/request-attendance`)
- Eier inviterer barn til spesifikt måltid
- Porsjonsfaktor automatisk regnet inn (Eksisterende portion-factor-logikk)

### Sprint 15: Cross-family overføring

- Standard scenario: bestemor flytter mellom familier
- Mottaker-samtykke + admin-varsel
- Brukers data følger med (preferences, history) — krever explicit
  family_id-migrering på user_preferences-tabeller
- Backend: ny endpoint `POST /api/family/transfer-user/:userId` med
  to-fase-flow (request → accept)

### Sprint 16+: Re-implement bootstrap-flow på v2

Sprint 8 (PR #118) slettet `public/setup.html`. Bootstrap-handler-koden i
`server/http/bootstrap.js` finnes fortsatt men `setupUrl: '/setup.html'`
peker på en slettet fil. Sprint 16+ kan re-implementere wizard på v2
(`/v2/setup`) hvis vi vil støtte zero-config Docker-deploy for andre
familier. Alternativt: slett bootstrap-flow helt (det er ikke i pilot-bruk).
Tracked i `docs/workflow/post-pilot-code-debt-cleanup.md` Entry 14.
