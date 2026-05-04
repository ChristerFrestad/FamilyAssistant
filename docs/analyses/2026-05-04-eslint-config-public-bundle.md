# ANALYSE: ESLint config — exclude built bundle and root-level diagnostic scripts

**Dato:** 2026-05-04
**Branch:** `chore/eslint-config-public-bundle`
**Type:** Trivial chore (lint-config only)

## Reisen

Christer / utvikler kjører `npm run lint`.
1. Lint-runner går gjennom alle JS/TS/MJS-filer i prosjektet.
1.1. Lint støter på `public/v2/assets/main-Dx0p-2Q5.js` (Vite-bygd bundle, minifiert).
1.1.1. Bundle-en får default `js.configs.recommended` rules (ingen `files`-blokk matcher).
1.1.2. Minifiserte browser-globals (`window`, `document`, `fetch`, `Blob`, ...) regnes som udefinerte.
1.1.3. 326 falske positive `no-undef` errors rapporteres.
1.2. Lint støter på `db-check.js` og `db-pantry-check.js` (Christers diagnostiske scripts ved repo-root).
1.2.1. Filene matcher heller ingen `files`-blokk (kun `server/**`, `scripts/**`, `tests/**` etc er definert).
1.2.2. CommonJS-globals (`require`, `console`) regnes som udefinerte.
1.2.3. ~16 falske positive `no-undef` errors rapporteres.
1.3. Lint støter på reell `ErrorBoundary.tsx`-warning (urelatert til denne PR-en).

Resultat: 342 problemer rapportert, hvorav 341 er falske positive fra build-output og diagnose-scripts.

## Domenemodell-påvirkning

Ingen domenemodell-påvirkning. Ren lint-config-endring.

Berørte filer:
- `eslint.config.mjs`: utvide `ignores`-blokken
- `docs/analyses/2026-05-04-eslint-config-public-bundle.md`: denne analysen
- `ops/logs/config-changes/config-audit-log.md`: audit-entry for protected file edit

## Edge-cases

1. Ny build av frontend produserer fil med annet hash (`main-XYZ.js`) — `public/v2/**` glob fanger uavhengig av hash.
2. Ny diagnostic-fil ved root (`db-something.js`) — `db-*.js` glob fanger automatisk.
3. Eksisterende `public/index.html` er allerede ignored, ikke endret.
4. Eksisterende `public/dist/**` er allerede ignored, ikke endret.
5. `public/v2/index.html` (rendres av Vite) — håndteres allerede av default ignore for HTML, men dekkes også av `public/v2/**` for sikkerhet.
6. Hvis Vite-build endrer output-mappe i fremtiden (f.eks. `public/v3/`), må ignore-listen oppdateres tilsvarende.
7. Real lint-feil i `client/src/**/*.tsx` påvirkes ikke — den matcher en eksplisitt `files`-blokk.
8. `public/sw.js` (service worker) har egen `files`-blokk og påvirkes ikke av endringen.

## Konsekvenser på tvers

- `npm run lint` faller fra 341 errors til 0 errors (eksisterende warning beholdes).
- CI grønt.
- Ingen runtime-endring.
- Ingen test-endring nødvendig.
- Ingen DOMAIN_MODEL.md-oppdatering.
- Ingen API-endring.

## Beslutninger

### BESLUTNING 1: Ignore-strategi for built bundle

**ANBEFALING:** Bruk glob `public/v2/**` som fanger alle filer uavhengig av hash.

**HVORFOR:** Bundle-hash endres ved hver build. Eksakt filnavn ville krevet vedlikehold ved hver build, glob er stabilt.

**ALTERNATIVER:**
- Eksplisitt filnavn i ignore: bryter ved neste build, dårlig.
- Ignore kun `public/v2/assets/**`: fungerer, men `public/v2/index.html` håndteres da ikke konsekvent (selv om HTML i praksis ikke lintes).

**KONSEKVENS HVIS ANNERLEDES:** Vedlikeholds-byrde ved hver Vite-build.

### BESLUTNING 2: Ignore-strategi for diagnostic-scripts

**ANBEFALING:** Bruk glob `db-*.js` som fanger Christers diagnostic-filer.

**HVORFOR:** Christers diagnostic-scripts ved repo-root er transiente og skal ikke lintes. De er ikke gitignored (Christer kan beholde dem mellom sesjoner), men bør ikke produsere lint-støy.

**ALTERNATIVER:**
- Flytte filene til `scripts/`: ville gjort dem til prosjekt-scripts, men det er ikke deres rolle (de er ad-hoc diagnose).
- Legge til Node-globals for root-nivå JS: ville utvide lint-scope feilaktig (ikke alle root-JS bør være CommonJS-Node).
- Ignorere kun eksakt navn: ny diagnostic-fil i fremtiden krever ny config-endring.

**KONSEKVENS HVIS ANNERLEDES:** Lint-støy fra diagnostic-scripts hver kjøring.

### BESLUTNING 3: Ikke endre .gitignore i denne PR-en

**ANBEFALING:** Hold endringen ESLint-fokusert. .gitignore-justering er separat scope.

**HVORFOR:** Christer ba om "ESLint config fix". Å legge `db-*.js` i .gitignore samtidig blander to typer config-endringer i én PR.

**KONSEKVENS HVIS ANNERLEDES:** Større PR-diff, mer å reviewe, blandet scope.

## Portainer-oppstartsrisiko-sjekk

- `Dockerfile`: NEI
- `.dockerignore`: NEI
- `docker-compose.yml`: NEI
- `server/http/bootstrap.js`: NEI
- `server/config.js` oppstartsvalidering: NEI
- `server/index.js` startup-sekvens: NEI
- `server/db.js` eller `server/migrations/**`: NEI
- `install.sh`: NEI
- `bootstrap.json`-lesning eller -skriving: NEI
- Miljøvariabel-krav for oppstart: NEI

**Konklusjon:** Ingen Portainer-risiko. Ren utvikler-tooling-endring.

## ISO 25010-påvirkning

- Vedlikeholdbarhet: 8.3 → 8.3 (uendret — lint-støy reduseres, men målbar score endres ikke).

Andre karakteristikker: ikke berørt.

## Plan

Én commit:
1. `chore(lint): exclude built bundle and root diagnostics`
   - Edit `eslint.config.mjs`: legg til `public/v2/**` og `db-*.js` i `ignores`
   - Add audit-log entry per CLAUDE.md DEL 7.9
   - Add denne analyse-filen

## Kompleksitet-vurdering

Trivial chore. Ingen domeneendring, ingen forretningsregel, kun config-justering. Match med "liten"-vurdering.
