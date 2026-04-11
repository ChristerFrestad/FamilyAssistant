# Type Coverage — Familieassistenten

**Sist oppdatert:** 2026-04-11 (uke 8 av ISO/IEC 25010-planen)

Familieassistenten er skrevet i vanilla JavaScript (ingen TypeScript-
kompilering), men bruker TypeScript-toolchainen for å type-sjekke
JavaScript via JSDoc og `// @ts-check`-direktivet. Denne siden beskriver
strategi, nåværende dekning, og hvordan man utvider.

---

## Filosofi: opt-in type-checking

Vi bruker en **opt-in modell** i stedet for global `checkJs: true`:

- `tsconfig.json` har `checkJs: false` som default
- Kun filer med `// @ts-check` i topp blir type-sjekket
- Nye filer kan gradvis opt-innes uten å blokkere pågående arbeid
- Eksisterende filer som ennå ikke har type-annotations forblir uendret
  (men kjøres fortsatt syntaktisk via `allowJs: true`)

Dette er motsatt av hvordan TypeScript vanligvis brukes, men er den rette
strategien for et prosjekt som:

1. Ikke ønsker build-steg (vanilla Node.js, ingen transpile)
2. Har en moden kodebase med kjente edge-cases tsc vil flagge
3. Vil ha en **bevist effektiv** type-gate fra dag 1, ikke 65 false positives

Tsc brukes som et **refactor-forsvar**, ikke en stilguide.

---

## Dagens dekning

**10 filer** er opt-innet med `// @ts-check` (per 2026-04-11):

| Fil | Linjer | Rolle |
|---|---|---|
| `server/services/slugify.js` | 42 | Canonical productKey slugifier |
| `server/services/units.js` | 95 | Pantry unit validation + ratio |
| `server/services/seed.service.js` | 71 | DB seeding på første oppstart |
| `server/services/recipe-similarity.service.js` | 115 | Jaccard-similarity for recipes |
| `server/http/errors.js` | 73 | RFC 7807 HttpError + factory |
| `server/http/validate.js` | 75 | Zod middleware for body/query/params |
| `server/http/metrics.js` | 235 | Custom histogram + Prometheus export |
| `server/http/cache.js` | 143 | LRU response cache med tag-invalidering |
| `server/logger.js` | — | Pino structured logger |
| `server/state-snapshot.js` | 183 | Persistert in-memory state (metrics) |

Dette er **de stabile, velstrukturerte** filene som gir umiddelbar verdi
fra type-sjekking. Flere filer vil opt-innes i senere uker.

---

## Hvordan opt-inne en fil

### Steg 1: Sett inn `// @ts-check` i topp

```js
// @ts-check
// ... eksisterende fil-header ...
```

Det MÅ være i øverste 1-5 linjer for at TypeScript skal plukke det opp.

### Steg 2: Kjør `npm run typecheck` og se feilene

```bash
npm run typecheck
# server/services/foo.js(42,15): error TS2339: Property 'bar' does not exist...
```

### Steg 3: Fiks feilene — tre vanlige løsninger

**a) Legg til JSDoc-typer på parametere og returtyper:**
```js
/**
 * @param {string} name
 * @param {number} [age]
 * @returns {Promise<boolean>}
 */
async function greet(name, age) { ... }
```

**b) Bruk `@typedef` for komplekse shape-typer:**
```js
/**
 * @typedef {object} Recipe
 * @property {number} id
 * @property {string} name
 * @property {string[]} tags
 */

/** @type {Recipe[]} */
const recipes = loadRecipes();
```

**c) Bruk `@type` cast når TypeScript ikke forstår kontexten:**
```js
/** @type {Record<string, number>} */
const counts = {};
```

### Steg 4: Verifiser at tsc er grønn

```bash
npm run typecheck
# (tom output = grønt)
```

### Steg 5: Oppdater denne siden

Legg til filen i tabellen over.

---

## Rules

- **Aldri disable tsc-feil med `// @ts-ignore` uten kommentar.** Hvis du må
  disable, legg til `// @ts-expect-error — XXX fordi YYY` med begrunnelse.
- **Rate-limit bruken av `any`-typer.** Foretrekk `unknown` hvis du ikke
  vet typen.
- **Ikke type-sjekk test-filer.** Test-mønsteret krever mye duck-typing
  og type-annoteringer ville blitt støy. `tests/` er ekskludert fra tsconfig.
- **Ikke type-sjekk scripts/load-baseline.js.** Den bruker dynamiske
  moduler og prosess-manipulasjon som tsc ikke modellerer godt.

---

## OpenAPI-genererte typer

`types/openapi.d.ts` genereres fra `openapi.yaml` via:

```bash
npm run openapi:types
```

Dette produserer en 1100+ linjers `.d.ts`-fil med:

- `export interface paths` — alle API-stier som typed objekt
- `export interface components` — schemas fra openapi-definisjon
- Request + response body-typer per endepunkt

Bruk disse i klient-kode (f.eks. en evt. TypeScript/React frontend senere)
for 100% kontrakt-garanti:

```ts
import type { paths } from './types/openapi';

type TodayResponse = paths['/api/today']['get']['responses']['200']['content']['application/json'];
```

Regenerer etter hver openapi.yaml-endring. CI verifiserer automatisk
at spec og kode er i sync via `m3-openapi-contract.test.js`.

---

## Bevist effektivitet (TS-5)

`tests/m-week8-typecheck.test.js` inneholder en **refactor-proof-test**:

1. Opprett en midlertidig fil `server/__typecheck_proof__.js` med
   `// @ts-check` og en eksplisitt type-feil
2. Kjør `npx tsc --noEmit`
3. Verifiser at exit-koden er non-zero og at feilen peker til filen
4. Ryd opp

Dette beviser at gaten **faktisk fanger reelle type-feil**, ikke bare at
tsc kjører til 0 på eksisterende kode. Uten denne testen ville en regresjon
i tsconfig.json (f.eks. hvis noen satte `strict: false` i feilen) kunne
gi falskt grønn gate.

---

## Plan for gradvis ekspansjon

| Uke | Aktivitet | Mål |
|---|---|---|
| 8 | Baseline: 10 filer, tsconfig, CI-gate | Type-gate i CI |
| 9 | Allergi-post-filter (ny kode skrives fra start med @ts-check) | Safety |
| 10 | Pre-release audit: opt-inn ytterligere 10 filer | 20 filer |
| Senere | `schemas.js` (Zod → TypeScript infer) for full type-inference | 30+ |

Langsiktig: alle nye filer skrives med `// @ts-check` fra start. Eksisterende
filer opt-innes når de likevel endres substansielt (migrasjoner, bugfixes).

---

## Referanser

- TypeScript JSDoc docs: https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html
- openapi-typescript: https://openapi-ts.dev/
- `// @ts-check` direktiv: https://www.typescriptlang.org/docs/handbook/type-checking-javascript-files.html
