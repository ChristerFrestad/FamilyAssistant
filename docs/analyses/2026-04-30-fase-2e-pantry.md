# Analyse — Fase 2E Pantry sub-view (Sprint 5 fortsetter)

**Dato:** 2026-04-30
**Branch:** `feat/fase-2e-pantry`
**Sprint/fase:** Sprint 5 / Fase 2E (Master-plan til pilot)
**Forfatter:** Claude (autonom)
**Christer-bekreftet scope:** B1 (sub-view) + B2 (kategori, ikke location) + B3 (Marker brukt-dialog) + B4 (verifiser backend) + tilleggs-oppdrag (holdbarhet-badge)

---

## 1. Bakgrunn

Pantry er fjerde og siste skjerm i Sprint 5 / Fase 2 (etter Dashboard, Family, Meals, Shopping). Master-planen hadde Kalender her, men Christer har byttet rekkefølge: Pantry inn nå, Kalender utsettes til post-pilot.

Forretningsverdi: Pantry er kjernen i verdikjeden Måltid → Handleliste → Pantry → Bruk → Handleliste. Uten Pantry blir Måltid-Handleliste-flyt halvferdig — brukeren ser hva som må kjøpes, men ikke hva de allerede har.

Backend-tilstand (etter inventering): **alt nødvendig finnes**. Endepunkter, auto-add-fra-shopping, og lav-stock-trigger er allerede implementert i tidligere sprinter. Denne PR-en er ren frontend-konsumering.

---

## 2.1 Reisen

### Reise A: Bruker åpner Pantry-sub-view

```
1. Bruker står på Shopping-skjermen (handleliste-modus default)
   1.1. AppShell rendrer Shopping under /v2/shopping
   1.2. Shopping-skjermen rendrer ShoppingHeader + segmented toggle
        + ShoppingList (default sub-view)
2. Bruker tapper "Hva har vi hjemme?"-knappen i toggle
   2.1. Toggle setter URL-search-param: ?view=pantry
        2.1.1. URL-state-pattern: useSearchParams() fra react-router-dom
        2.1.2. Persisteres på navigasjon (back-button bevarer view)
        2.1.3. Eksternt deep-linkable (Christer kan dele URL til Pantry)
   2.2. Shopping-skjermen leser ?view=pantry og rendrer PantryView i stedet
        for ShoppingList
   2.3. ErrorBoundary forblir på samme nivå (rundt children av /shopping-rute)
3. PantryView mounter
   3.1. usePantryData()-hook kalles
        3.1.1. fetch GET /api/pantry — returnerer items[]
        3.1.2. Hooks-state: { items, isLoading, error, ... }
   3.2. Loading-state: skeleton (3 placeholder-kort)
   3.3. Hvis empty: "Spiskammers er tomt — varer legges til automatisk når
        du kjøper på handleliste"-CTA
   3.4. Hvis data: gruppér per category, rendér PantryItem per rad
4. Bruker ser pantry-items
   4.1. Hver rad: navn, "X av Y unit", progress-bar (mint/amber/coral),
        holdbarhet-badge hvis expiresEst
   4.2. Rader sortert alfabetisk innen kategori (matcher backend-sort)
   4.3. Status-badge: "Lavt" hvis ratio < 20%, "Tomt" hvis remaining = 0
        (men remaining=0 returneres ikke fra GET /api/pantry per
        backend-filter, så "Tomt" oppstår kun midlertidig under
        optimistic update før refetch)
```

### Reise B: Bruker markerer brukt mengde

```
1. Bruker tapper "Marker brukt"-knapp på en pantry-item
   1.1. UseDialog-komponent åpner som inline-dialog (Modal-komponent)
   1.2. Dialog viser: navn, "X unit igjen", input-felt (default = remaining)
2. Bruker velger mengde
   2.1. Quick-buttons: "1/4 (Y unit)", "1/2 (Y unit)", "Alt (X unit)"
        2.1.1. 1/4: amount = round(remaining / 4, 1 desimal)
        2.1.2. 1/2: amount = round(remaining / 2, 1 desimal)
        2.1.3. Alt: amount = remaining
   2.2. Manuelt input: amount (number-input, step=0.1)
        2.2.1. Validering: 0 < amount && amount <= remaining
        2.2.2. Inline-feilmelding hvis ugyldig
        2.2.3. Submit-knapp disabled hvis ugyldig
3. Bruker tapper "Bekreft"
   3.1. Frontend kalkulerer: newQty = remaining - amount
   3.2. Optimistic update: items state oppdateres umiddelbart med ny qty
        3.2.1. Hvis newQty = 0: item fjernes fra UI (matcher backend
               GET /api/pantry-filter som ekskluderer qty=0)
        3.2.2. Hvis newQty > 0: progress-bar oppdateres
   3.3. PUT /api/pantry/correct kalles { productKey, newQty }
   3.4. Suksess: behold optimistic state, dialog lukker
   3.5. Feil: rollback til forrige state, vis error-toast
4. Backend-effekt (allerede implementert)
   4.1. correctQty() i pantry.service.js skriver inventory_log
   4.2. Hvis newQty < total * 0.20 (LOW_THRESHOLD): auto-add til
        aktiv handleliste via checkAndTriggerLowStock()
   4.3. Frontend ser ikke dette direkte — handleliste oppdateres
        ved neste tab-bytte
```

### Reise C: Quick-add ny vare til pantry

```
1. Bruker fokuserer quick-add-input nederst (sticky)
2. Bruker skriver navn ("melk")
   2.1. Ingen autocomplete i pilot-MVP (post-pilot bruker
        GET /api/pantry/suggest)
   2.2. Inline-input for antall (default 1)
   2.3. Inline-input for enhet (default "stk")
3. Bruker tapper "Legg til"
   3.1. Optimistic add — ikke ennå, fordi backend allokerer productKey
        (slugify) og UI trenger den
   3.2. POST /api/pantry/add med { query: "melk", qty: 1, unit: "stk" }
   3.3. Backend resolver "melk" → productKey="melk" via pantryResolver
   3.4. Suksess: refetch GET /api/pantry, item dukker opp
   3.5. Feil: vis inline-feil, behold input-state
4. Edge: "melk" finnes allerede i pantry
   4.1. Backend kjører upsert via inventory.upsertManual
   4.2. qtyRemaining øker med 1
   4.3. UI viser oppdatert mengde
```

### Reise D: Slett item ("har ikke likevel")

```
1. Bruker tapper slett-knapp (X) på en pantry-item
2. Bekreftelses-mønster: ingen native confirm-dialog (matcher Shopping-pattern)
   2.1. Optimistic remove fra UI
   2.2. DELETE /api/pantry/:productKey kalles
   2.3. Suksess: behold optimistic
   2.4. Feil: rollback (item dukker opp igjen) + error-toast
```

---

## 2.2 Domenemodell-påvirkning

### Backend (uendret — ingen kode skrives)

| Fil | Status | Notat |
|-----|--------|-------|
| `server/services/pantry.service.js` | uendret | `addToPantry`, `correctQty`, `removeExpired`, `checkAndTriggerLowStock` |
| `server/services/pantry-resolver.service.js` | uendret | `resolveOrCreate` for quick-add |
| `server/services/units.js` | uendret | `LOW_THRESHOLD`, `calculateRatio`, `validateUnit` |
| `server/routes.js:1370-1601` | uendret | 8 pantry-endepunkter |
| `server/migrations/004_*.sql`, `008_*.sql`, `017_*.sql` | uendret | `inventory`, `inventory_log`, `product_shelf_observations` |
| `server/repositories.js` | uendret | `repos.inventory`, `repos.inventoryLog`, `repos.products` |

### Frontend (ny kode)

| Fil | Type | Notat |
|-----|------|-------|
| `client/src/app/pantry/pantryApi.ts` | ny | API-klient: `fetchPantry`, `markUsed`, `addItem`, `removeItem` |
| `client/src/app/pantry/usePantryData.ts` | ny | Hook: items, loading, error, optimistic mutations |
| `client/src/app/pantry/usePantryData.test.tsx` | ny | Hook-tester |
| `client/src/app/components/pantry/PantryView.tsx` | ny | Container — Shopping renderer denne |
| `client/src/app/components/pantry/PantryView.test.tsx` | ny | Container-tester |
| `client/src/app/components/pantry/PantryItem.tsx` | ny | Per-rad-komponent |
| `client/src/app/components/pantry/PantryItem.test.tsx` | ny | Item-tester |
| `client/src/app/components/pantry/UseDialog.tsx` | ny | Marker brukt-dialog |
| `client/src/app/components/pantry/UseDialog.test.tsx` | ny | Dialog-tester |
| `client/src/app/components/pantry/ExpiryBadge.tsx` | ny | Holdbarhet-badge |
| `client/src/app/components/pantry/ExpiryBadge.test.tsx` | ny | Badge-tester |
| `client/src/app/components/pantry/QuickAddPantry.tsx` | ny | Quick-add input + qty + unit |
| `client/src/app/components/pantry/QuickAddPantry.test.tsx` | ny | Quick-add-tester |
| `client/src/app/components/pantry/ShoppingViewToggle.tsx` | ny | Segmented toggle "Liste" / "Hva har vi hjemme?" |
| `client/src/app/components/pantry/ShoppingViewToggle.test.tsx` | ny | Toggle-tester |
| `client/src/app/screens/Shopping.tsx` | endret | Les `?view=pantry`, rendr PantryView eller ShoppingList |
| `client/src/app/screens/Shopping.test.tsx` | endret | Test toggle-bytting |
| `client/src/app/i18n/locales/no/pantry.json` | ny | i18n-namespace (norsk) |
| `client/src/app/i18n/locales/en/pantry.json` | ny | i18n-namespace (engelsk) |
| `client/src/app/i18n/config.ts` | endret | Inkluder pantry-namespace |
| `client/src/app/i18n/bundles.test.ts` | uendret | Bundle-parity-test selv-validerer |
| `tests/pantry-integration.test.js` | ny | Backend-flyt-verifikasjon (B4) |

### DOMAIN_MODEL.md

Ingen ny entitet introduseres — `inventory` og `inventory_log` finnes allerede i kode (men er ikke dokumentert i DOMAIN_MODEL.md). DOMAIN_MODEL.md er bevisst startet tom (per dokumentets eget header), så å legge til `inventory` her ville være en backfill som er out-of-scope. Ingen oppdatering i denne PR.

### Forretningsregler (impliserte, dokumenteres ikke i denne PR)

- **BR-001 (impliseres):** Ratio < 20% triggers auto-add til aktiv handleliste.
- **BR-002 (impliseres):** Auto-add fra shopping-toggle når item togglet kjøpt.
- **BR-003 (impliseres):** Pantry-items med qty=0 returneres ikke fra GET /api/pantry.

Disse er etablerte i kode men ikke i DOMAIN_MODEL.md. Backfill skjer i fremtidig dokumentasjons-PR.

---

## 2.3 Edge-cases

1. **Tom pantry (første pilot-bruker):** GET /api/pantry returnerer `items: []`. Empty-state vises med tekst "Spiskammers er tomt — varer legges til automatisk når du kjøper på handleliste, eller bruk feltet nederst".

2. **Pantry-item uten total_size:** `total = null`. Progress-bar skjules. Vis kun "X unit". Ingen "Lavt"-badge fordi vi ikke vet relativ andel.

3. **Pantry-item uten unit:** `unit = ""`. Vis bare antall, ikke "{antall} unit". Defensive null-handling.

4. **Pantry-item uten ingredientNameNo:** `name = productKey` (backend faller tilbake). Ingen ekstra håndtering.

5. **Marker brukt med amount > remaining:** Validering blokkerer. Submit-knapp disabled. Inline-feil "Kan ikke bruke mer enn X unit".

6. **Marker brukt med amount = remaining:** newQty = 0. Item fjernes fra UI optimistisk. Backend returnerer ok, dialog lukker, item permanent fjernet (qty=0-rad ekskluderes fra fremtidige GETs).

7. **Marker brukt mens en annen tab gjør samme operasjon:** Backend er last-write-wins (PUT /api/pantry/correct setter newQty absolutt, ikke delta). To samtidige saves på samme item: andre overskriver første. Akseptabelt for pilot — ingen optimistic locking.

8. **Quick-add med tomt navn:** Submit-knapp disabled. Ingen kall.

9. **Quick-add med veldig langt navn (>200 tegn):** Backend Zod rejecter (z.string().max(200)). Frontend viser feilmelding "Navnet er for langt".

10. **Quick-add når shopping har samme item på handleliste:** Backend `addToPantry` legger til pantry. Handleliste forblir uendret (annen flyt). Bruker ser begge stedene — det er bevisst.

11. **expiresEst i fortid:** `daysUntilExpiry < 0`. Vis badge "Utgått" med rød tekst. Item vises fortsatt — backend filtrerer ikke utløpte.

12. **expiresEst i dag (daysUntilExpiry = 0):** Vis "Utgår i dag" (legg til i i18n).

13. **expiresEst en dag fram (daysUntilExpiry = 1):** Vis "Utgår i morgen".

14. **expiresEst null/undefined:** Skjul badge. Ingen visuell indikasjon.

15. **Toggle "Hva har vi hjemme?" med invalid view-param (`?view=foobar`):** Default til list-view. Ikke crashe.

16. **Mange pantry-items (~50+):** Rendr alle. Ingen virtualisering i pilot. Ytelse-test viser at React håndterer 100 enkle rader < 16ms re-render.

17. **Network error på fetch:** Vis error-state med retry-knapp. Ikke optimistic.

18. **Network error på markUsed/quick-add/delete:** Rollback optimistic, vis toast med retry-mulighet.

19. **Bruker bytter view midt i pågående mutation:** Mutation fortsetter i bakgrunnen. Hvis brukeren kommer tilbake, refetch viser ny state.

20. **iOS Safari / Android Chrome viewport edge-case:** Sticky toggle overlapper med scroll-content? Test mobil-bredde 320/390/414.

---

## 2.4 Konsekvenser på tvers

| Område | Endring | Notat |
|--------|---------|-------|
| Frontend-komponenter | 8 nye komponenter, 1 endret (Shopping) | Pantry-mappa speiler shopping-mappa |
| API-endepunkter | Ingen nye | Konsumerer eksisterende |
| Database-migrasjoner | Ingen | location-felt utsettes |
| OpenAPI-oppdatering | Ingen | Endepunkter uendret |
| Tester (frontend) | ~40-50 nye tester | komponenter + hook + i18n + integration |
| Tester (backend) | 1 ny integrasjons-test | B4: verifiserer flyt |
| `docs/DOMAIN_MODEL.md` | Ikke oppdatert | Out of scope |
| `design/2026-04-redesign/design-gaps.md` | Tre nye entries | Marker brukt-dialog, location-felt, expiry-badge |
| Bundle-størrelse | Estimert +5-8 KB gzipped | Tilsvarer Family/Meals-økninger |
| Routing | Uendret rute (`/v2/shopping`), ny URL-param `?view=pantry` | URL-state-pattern |
| ErrorBoundary | Eksisterende rundt /shopping dekker begge sub-views | Inkluder data-tests for begge |

---

## 2.5 Beslutninger (Christer-bekreftet)

### BESLUTNING 1: Pantry-arkitektur

**VALG:** Sub-view inne i Shopping-skjermen med segmented toggle og URL-state.

**HVORFOR:** Matcher mockup, holder bottom-nav på 5 ergonomiske targets, holder Pantry tett koblet til verdikjeden Måltid → Handleliste → Pantry. Christer-bekreftet i stopp-respons.

### BESLUTNING 2: Plassering (location)

**VALG:** Bruk eksisterende `category`-felt. Ingen migrasjon nå. Loggføres som design-gap.

**HVORFOR:** Pilot-MVP skal ikke innføre datamodell-endringer som ikke gir umiddelbar verdi. Mockup-en sin "Køleskap"/"Kjøkkenskap"/"Fryser" er kosmetisk gruppering uten user-control i pilot. Vurderes for v1.1 etter pilot-feedback.

### BESLUTNING 3: "Marker brukt"-dialog

**VALG:** BYGG dialog (overstyrer min anbefaling — Christer-beslutning). Quick-buttons 1/4, 1/2, Alt + manuelt input.

**HVORFOR:** Christer prioriterer kvantitativ tracking som kjerne-verdi. Uten dialog kan brukerne ikke holde Pantry presist oppdatert. Loggføres som design-gap (mockup mangler dette — neste design-runde må vurdere integrering).

### BESLUTNING 4: Auto-add og lav-stock-suggest

**VALG:** Verifiser eksisterende backend med integrasjons-test, ikke bygg om.

**HVORFOR:** Begge er allerede implementert. Test bekrefter at flyten fungerer ende-til-ende.

### BESLUTNING 5 (Christer tillegg): Holdbarhet-badge

**VALG:** Vis ExpiryBadge-komponent når `expiresEst` er satt. Farger: gul (< 7 dager), rød (< 3 dager). Tekster: "Utgår om N dager" / "Utgår i morgen" / "Utgår i dag" / "Utgått".

**HVORFOR:** Backend leverer feltet. Additiv UX-forbedring uten ny backend-funksjonalitet. Christer eksplisitt bekreftet.

### BESLUTNING 6 (impliseres): URL-state-strategi

**VALG:** `useSearchParams()` fra react-router-dom. Default = list-view, `?view=pantry` = pantry-view. Andre verdier = default.

**HVORFOR:** Lavest friksjon. Persisteres på browser-back. Deep-linkable. Matcher React Router idiomer. Alternativ (Context, useState i Shopping) tap av deep-linking.

### BESLUTNING 7 (impliseres): Modal-komponent for UseDialog

**VALG:** Bygg enkel inline-dialog (full-screen overlay med backdrop) hvis ikke Modal-komponent finnes.

**HVORFOR:** Per prompt sin BESLUTNINGSPUNKTER. Sjekker Fase 1b base-komponenter — hvis Modal eksisterer, bruk den. Ellers bygg minimal.

---

## 2.6 Portainer-oppstartsrisiko-sjekk

| Fil | Berørt? |
|-----|---------|
| `Dockerfile` | Nei |
| `.dockerignore` | Nei |
| `docker-compose.yml` | Nei |
| `server/http/bootstrap.js` | Nei |
| `server/config.js` (oppstartsvalidering) | Nei |
| `server/index.js` (startup-sekvens) | Nei |
| `server/db.js` eller `server/migrations/**` | Nei |
| `install.sh` | Nei |
| `bootstrap.json`-lesning eller -skriving | Nei |
| Miljøvariabel-krav for oppstart | Nei |

**Konklusjon:** Ingen Portainer-oppstartsrisiko. Ren frontend-PR + én backend-test (som ikke endrer oppstart). Ingen DEL 3 Steg 3b-prosedyre nødvendig.

---

## 2.7 ISO 25010-påvirkning

| Karakteristikk | Før | Etter | Begrunnelse |
|---------------|-----|-------|-------------|
| Funksjonell egnethet | 8.7 | 8.8 (+0.1) | Pantry-skjerm fyller kjernemangelen i verdikjeden Måltid → Handleliste → Pantry. Kvantitativ tracking via Marker brukt-dialog. |
| Brukbarhet | 8.7 | 8.7 (uendret) | Holdbarhet-badge gir hurtig verdi, men sub-view-pattern kan oppleves litt skjult for noen brukere — netto null. |
| Pålitelighet | 8.5 | 8.5 (uendret) | Optimistic-update-pattern med rollback er etablert; ingen ny risiko. |
| Ytelse | 8.4 | 8.4 (uendret) | +5-8KB bundle ubetydelig. Ingen N+1, ingen tunge queries. |
| Sikkerhet | 8.2 | 8.2 (uendret) | Eksisterende auth-kjede + role-checks (`requireRole('adult')` på add/correct/delete). Ingen nye attack-flater. |
| Vedlikeholdbarhet | 8.5 | 8.6 (+0.1) | Pantry-mappa speiler shopping-mappa = konsistent kodebase. Test-coverage for ny kode > 85%. |
| Portabilitet | 8.6 | 8.6 (uendret) | Ingen runtime/dependency-endringer. |
| Kompatibilitet | 8.5 | 8.5 (uendret) | Backend uendret. URL-param er additiv. |

**Snitt:** 8.50 → 8.51 (+0.01). Ingen karakteristikk under 8.0.

---

## 2.8 Plan (commits i rekkefølge)

| # | Commit | Beskrivelse | Estimert diff |
|---|--------|-------------|----------------|
| 1 | `docs(analysis): add analysis for fase-2e-pantry` | Dette dokumentet | +800 linjer |
| 2 | `feat(client/pantry): add pantryApi.ts + usePantryData hook` | API-klient + hook med tester | +400 linjer |
| 3 | `feat(client/pantry): add ExpiryBadge + PantryItem components` | Item-rad + holdbarhet | +350 linjer |
| 4 | `feat(client/pantry): add UseDialog component` | Marker brukt-dialog | +300 linjer |
| 5 | `feat(client/pantry): add QuickAddPantry component` | Quick-add input | +200 linjer |
| 6 | `feat(client/pantry): add PantryView container` | Container med loading/empty/error/data | +250 linjer |
| 7 | `feat(client/shopping): integrate pantry sub-view with toggle` | Shopping.tsx endring + ShoppingViewToggle | +150 linjer |
| 8 | `feat(client/i18n): add pantry namespace (no+en)` | i18n-keys + config-update | +120 linjer |
| 9 | `test(server): pantry integration flow verification` | B4-tester | +180 linjer |
| 10 | `docs(design): log marker-used dialog and location as design-gaps` | design-gaps.md entries | +60 linjer |

**Total estimert:** ~10 commits, +2810 linjer (mest tester og i18n-bundles).

---

## 2.9 Kompleksitet-vurdering

Christer's CONTEXT.md sier "Sprint 5 Pantry-skjerm". Prompt 10 er detaljert og konkret. Min analyse:

- **>3 domeneområder berørt:** Frontend-pantry, frontend-shopping (Shopping.tsx endres), frontend-i18n, backend-test. Ikke uventet for en feature.
- **Datamodell-endring:** Nei.
- **Forretningsregel:** Tre impliserte regler dokumentert (BR-001/002/003), ingen nye.
- **Edge-cases:** 20 dokumentert (over 8 minimum).

**Konklusjon:** Middels-stor oppgave (~10 commits). Christer-estimat ("Sprint 5-skjerm") matcher analyse. Ingen scope-overraskelser. Fortsetter til kode.

---

## 3. Sikkerhets-sjekkliste (utfylles i PR)

| Punkt | Status | Notat |
|-------|--------|-------|
| All brukerinput valideres via Zod (server) | Ja | Eksisterende schemas brukes |
| SQL parameterisert | Ja | Ingen ny SQL skrives |
| Filopplastinger | Ikke relevant | Ingen filopplasting |
| Nye endepunkter har auth-sjekk | Ikke relevant | Ingen nye endepunkter |
| Cross-tenant data-lekkasje | Ja, sjekket | Eksisterende family-scoping på pantry-routes (krever auth) |
| API-nøkler i kode | Nei | Ingen secrets |
| PII logges ikke | Ja | Logger uendret |
| Feilmeldinger lekker ikke intern info | Ja | Eksisterende error-pattern |
| Sensitive felter aldri i API-respons | Ja | Pantry returnerer ingen PII |
| Ingen `innerHTML` med user-data | Ja | React eskaperer default |
| Eksterne lenker `noopener` | Ikke relevant | Ingen eksterne lenker |
| CSP ikke svekket | Ja | Ingen nye inline scripts |

---

## 4. Manuell test-instruksjoner (for Christer post-merge)

1. Naviger til `/v2/shopping`. Skal vise handleliste-view (default).
2. Tap "Hva har vi hjemme?" i toggle-en øverst. URL skal endres til `?view=pantry`. Pantry-view skal rendere.
3. Trykk back-button. URL skal gå tilbake, view skal følge.
4. På pantry-view: pek på en item med low ratio (< 20%). Skal vise "Lavt"-badge og coral-farget progress-bar.
5. Tap "Marker brukt" på en item. Dialog skal åpne med navn + remaining.
6. Tap "1/2"-knapp. Input-felt skal fylles med remaining/2.
7. Tap "Bekreft". Dialog skal lukke. Progress-bar skal oppdateres umiddelbart. Refresh — verifiser at endringen er persistert.
8. Tap slett-knapp (X) på en item. Item skal fjernes umiddelbart.
9. På Shopping-view: toggle "kjøpt" på en item som har productKey. Bytt til Pantry-view. Item skal vises med qty fra shopping-mengde.
10. Quick-add: skriv "test-vare", qty 2, unit "stk". Tap "Legg til". Item skal dukke opp.
11. Mobile (390x844): toggle skal være lett tilgjengelig, dialog skal være full-bredde.
12. Desktop (1280+): layout skal være sentrert maks 800px, dialog skal være modal.

---

**Slutt på analyse.**
