# Fase E — Integrasjons-sjekkliste for `public/index.html`

Fire filer i `.claude/plan/fase-e/` skal flettes inn i `public/index.html` **i denne rekkefølgen**:

| # | Fil | Lim inn hvor | Type |
|---|---|---|---|
| 1 | `glass-upgrade.css` | Rett etter eksisterende `:root {}` og `[data-theme="dark"] {}`-blokker (~linje 47) | **Overstyrer** base-stil til 2026 Liquid Glass |
| 2 | `css-additions.css` | Rett før `/* Hide views */`-blokka (~linje 357) | Nye Fase E-komponenter (bruker glass-variabler) |
| 3 | `html-additions.html` | Rett før `<!-- TABS -->` (~linje 418) | FAB-element |
| 4 | `js-additions.js` | Inni `<script>`-blokka (se detaljer under) | Ny/erstattet JS |

> **Viktig om rekkefølge:** `glass-upgrade.css` **må** komme før `css-additions.css` fordi sistnevnte refererer til variabler som defineres i `glass-upgrade.css` (`--glass-bg`, `--glass-blur`, `--ease-spring`, `--btn-primary-grad` osv.).

## JavaScript-integrasjon (detaljer)

### A. State-variabler (øverst, etter eksisterende `let expandedRecipes = new Set();`)
```js
let shoppingSubView = 'buy';
let pantryData = null;
let currentShoppingListId = null;
let enrichmentPollTimer = null;
let recipeImportTab = 'text';
let recipeImportImageB64 = null;
```

### B. Erstatt eksisterende `loadShopping()` + `renderShopping()`
Bytt ut blokka linje ~741–843 i `index.html` med innholdet fra `js-additions.js` (alt fra `async function loadShopping()` ned til og med `function renderAddItemForm()`).

### C. Legg til nye funksjoner
Lim inn resten av `js-additions.js` (pantry, recipe-import, FAB-visibility, handlers) nederst i `<script>`, rett før DOMContentLoaded-event listeners.

### D. Oppdater `switchTab()`
Legg til `updateFabVisibility()` på slutten:
```js
function switchTab(el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(el.dataset.view).classList.add('active');
  const view = el.dataset.view;
  if (view === 'viewToday') loadToday();
  if (view === 'viewMeals') loadMeals();
  if (view === 'viewShopping') loadShopping();
  if (view === 'viewChores') loadChores();
  updateFabVisibility();   // ← NY LINJE
}
```

### E. Stopp polling ved tab-bytte fra Handletur
I `switchTab()`, rett før `if (view === ...)`-blokka:
```js
if (view !== 'viewShopping' && enrichmentPollTimer) {
  clearTimeout(enrichmentPollTimer);
  enrichmentPollTimer = null;
}
```

## Backend-sjekk (før frontend kan testes)

Sjekk at disse rutene er koblet opp i `server/routes.js`:

| Rute | Fase-B/C/D-referanse | Status |
|---|---|---|
| `GET /api/shopping/list/current` | Fase A | Må verifiseres — eksisterende kode bruker `/api/shopping/current` (legacy) |
| `PUT /api/shopping/items/:id/bought` | Fase D | ✅ |
| `PUT /api/shopping/items/:id/unpantry` | Fase D | ✅ |
| `POST /api/shopping/list/:id/enrich` | Fase B | ✅ |
| `POST /api/recipes/import` | Fase C | ✅ |
| `POST /api/recipes/import/image` | Fase C | ✅ |
| `GET /api/pantry` | ? | **Må verifiseres** |
| `POST /api/pantry/add` | ? | **Må verifiseres** |
| `DELETE /api/pantry/:id` | **Ikke eksisterende ennå** | **Må legges til, eller bruk PUT med delta=negative** |

## Gap: pantry-delete-rute

Frontend bruker `DELETE /api/pantry/:id` for å fjerne fra pantry manuelt ("Har ikke likevel"-knapp i pantry-lista). Backend har sannsynligvis ikke denne ruten. Tre alternativer:

1. **Legg til ny rute** `DELETE /api/pantry/:id` i `routes.js` som kaller `repos.pantry.delete(id)` eller setter `quantity=0`
2. **Gjenbruk eksisterende** via `POST /api/pantry/add` med negativ quantity-delta hvis servicen støtter det
3. **Drop "har ikke likevel"-knappen** i pantry-sub-view i første omgang (behold kun i kjøps-lista via `unpantryItem`)

**Anbefaling:** Implementer alternativ 1 som en minimal backend-patch (~10 linjer).

## Manuell røyk-test

Etter patching:

1. **Handletur, kjøp-view:**
   - Åpne Handletur-fanen → sjekk at segmented-toggle vises
   - Sjekk at enrichment-banner dukker opp hvis status er pending/running/partial
   - Trykk retry-knapp på partial → skal starte enrich på nytt
   - Sjekk at `ingredientNameNo` vises primært, EN-subtitle under
   - Sjekk at Kassal-chip vises med riktig konfidensfarge
   - Trykk "✓ Kjøpt" → vare forsvinner, pantry oppdateres
2. **Handletur, pantry-view:**
   - Bytt til Pantry → sjekk at eksisterende inventory listes
   - Legg til ny vare → sjekk at den vises
   - Trykk ✗ → sjekk at vare fjernes (eller får feilmelding hvis DELETE-ruten mangler)
3. **Pantry-lenket vare i kjøp-view:**
   - Sjekk at items med `isPantry:true` har grønn bakgrunn + "Dekket av pantry"-flagg
   - Trykk "↩ Trenger likevel" → vare flytter tilbake til vanlig kjøps-liste
4. **Ukesmeny — FAB:**
   - Bytt til Ukesmeny → FAB dukker opp nederst til høyre
   - Bytt til annen fane → FAB forsvinner
   - Trykk FAB → modal åpnes
5. **Oppskrifts-import, tekst:**
   - Lim inn testoppskrift → trykk Importer → alert med navn
6. **Oppskrifts-import, bilde:**
   - Velg bilde → preview vises
   - Trykk Importer → alert med navn
   - Sjekk Network-fanen: payload skal være < 1MB etter resize

## Risikopunkter

- **BREAKING:** Hvis `/api/shopping/list/current` ikke eksisterer og backend bruker `/api/shopping/current`, må ruten opprettes eller frontend tilpasses. Sjekk `server/routes.js` først.
- **BREAKING:** `DELETE /api/pantry/:id` mangler — se gap-seksjon over.
- **MEDIUM:** `markItemBought()` antar at `item.id` er satt på responsen fra `/shopping/list/current`. Sjekk at legacy-format inkluderer item-ID per rad.
- **LOW:** Client-side image resize er dekket for standard smarttelefon-bilder (3–5MB → ~200KB). Ekstreme cases (HEIC fra iPhone) kan feile ved dekoding.
