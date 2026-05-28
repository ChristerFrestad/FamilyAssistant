# ANALYSE: PNG raster derivatives for favicon + OG image (issue #123)

**Bakgrunn:** Sprint 10 leverte SVG-only branding-endepunkter
(`/favicon.svg`, `/logo-mark.svg`). Issue #123 ber om PNG-derivater
slik at:

- Eldre browsere som ikke støtter SVG favicon
- iOS home-screen-installs (apple-touch-icon)
- Android adaptive icons (192/512 PNG i manifest)
- Open Graph card-previews på sosiale medier (1200×630 OG image)

får riktig brand-render uten å avhenge av SVG-fallback eller mangle
helt.

## Scope

Lever de fem PNG-endepunktene issue #123 ber om, drevet av samme
brand-konfig som SVG-endepunktene. Ny avhengighet (`sharp` for SVG→
PNG-rasterisering) krever ANALYSE-vurdering.

## Endepunkter

| Endepunkt | Størrelse | Layout-kilde |
|---|---|---|
| `GET /favicon-32.png` | 32×32 | rasterisert fra favicon.template.svg |
| `GET /apple-touch-icon.png` | 180×180 | rasterisert fra logo-mark.template.svg |
| `GET /android-chrome-192.png` | 192×192 | rasterisert fra logo-mark.template.svg |
| `GET /android-chrome-512.png` | 512×512 | rasterisert fra logo-mark.template.svg |
| `GET /og-image.png` | 1200×630 | rasterisert fra ny `og-image.template.svg` (wordmark + tagline på cream-bakgrunn) |

## Ny dependency: `sharp`

- **Hvorfor sharp:** node:20-bookworm-slim (vår base) er Debian-basert,
  ikke Alpine. `sharp@0.34.x` ships prebuilt libvips-bundles for
  Debian linux x64 + arm64, så ingen apt-install av libvips trengs.
  Image-size impact: ~30 MB komprimert.
- **Hvorfor ikke `@resvg/resvg-js`:** Native bindings krever pre-builds
  som ikke alltid finnes for vår spesifikke Debian-arm64-kombinasjon.
  Sharp har mer mature prebuilts.
- **Hvorfor ikke ren-JS:** Performance er kritisk for OG image
  (1200×630 er stor); ren-JS SVG-rastere er størrelsesordener tregere.

## In-memory cache

Hver PNG-rendring er ~50 ms (favicon-32) til ~400 ms (og-image-1200).
Uten cache: tunge bots/krawlere kan stresse serveren med gjentatte
forespørsler. Cache-strategi:

- Nøkkel: `<endpoint>:<sha256(env-snapshot)>`
- Env-snapshot dekker alle 8 brand-relevante env-vars som
  påvirker rendringen. Hash gjør at endring i én av dem invaliderer
  cache automatisk (operatør deployer på nytt → ny prosess → ny
  cache).
- Lagring: `Map` med max 32 entries (eviction: oldest-first hvis
  fullt). Worst case minne: 32 × 500 KB = 16 MB. OG image alene er
  ~150 KB.
- Lifetime: process-lifetime. Restart wiper cachen — operatører som
  endrer brand-config redeployer uansett.
- Browser-cache: `Cache-Control: public, max-age=86400` (24 timer).
  PNG-er er expensiver å regenerere enn SVG-er, og endrer seg
  sjeldnere (bare ved brand-config-endring).

## Templater

Eksisterende `favicon.template.svg` (32×32) og `logo-mark.template.svg`
(120×120) gjenbrukes som rasteriseringskilder — sharp resizer ned
ved behov. Ny `server/branding/templates/og-image.template.svg`
(1200×630, wordmark + tagline + cream-bakgrunn) lages.

## Frontend-endringer

- `client/index.html`:
  - `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />`
    (sammen med eksisterende SVG-link for nyere browsere)
  - `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`
  - `<meta property="og:image" content="/og-image.png" />`
  - `<meta property="og:image:width" content="1200" />`
  - `<meta property="og:image:height" content="630" />`
- `server/http/branding.js` `handleManifest`:
  - Manifest-ikon-array utvides med 192 + 512 PNG-entries
    (purpose: 'maskable')

## Domenemodell-påvirkning

Ny forretningsregel BR-BRAND-2: PNG-derivater rasteriseres on-demand
fra SVG-templater og caches in-memory per env-snapshot-hash. Dokumenteres
i `docs/DOMAIN_MODEL.md`.

## Reisen

1. Bot/bruker requester `/og-image.png`
2. Branding-handler beregner env-snapshot-hash
3. Cache-lookup: hit → returner cached buffer
4. Cache-miss: render SVG-template → sharp.resize → toBuffer →
   cache-set → returner
5. Browser cacher 24 timer (Cache-Control)

## Edge-cases

1. **Sharp install fails:** Modulen lazy-loades via try/require. Hvis
   sharp ikke kan loades, returnerer endepunktene 503 med
   `feature unavailable` heller enn å crashe oppstart. Operatør får
   et signal de kan debugge.
2. **Cache memory cap:** 32 entries hard-limit. I praksis: kun én
   brand-config aktiv per prosess, så cache vil ha ~5 entries
   (én per endepunkt).
3. **OG image template må eksistere:** Hvis filen mangler → 500.
   Tester sjekker at filen lastes ved init.
4. **OG image-bot-kompatibilitet:** Twitter/Facebook/LinkedIn-crawlere
   følger ikke alltid Cache-Control men respekterer ETag. Vi setter
   ETag = env-snapshot-hash slik at crawlere kan if-none-match.
5. **Dockerfile cross-arch build:** sharp prebuilts for
   debian-linux-x64 og debian-linux-arm64 finnes. Verifiseres i
   CI multi-arch build.

## ISO 25010-påvirkning

- Brukbarhet: +0.1 (iOS home-screen + Android adaptive icon-fix)
- Funksjonell egnethet: +0.1 (OG image-støtte for sosiale medier)
- Pålitelighet: uendret (cache + fallback ved sharp-feil)
- Sikkerhet: uendret (samme inputs som SVG, samme XML-escape)

## Portainer-oppstartsrisiko

Lav-medium. `sharp` har native bindings som lastes ved
`require('sharp')`. Hvis prebuilds ikke matcher target-arch, fallback
til build-from-source som krever build-essentials. Vår Dockerfile
er Debian-basert (ikke Alpine), så prebuilts skal fungere out-of-the-
box. Vi verifiserer ved at CI Docker-build for begge arch'er går
gjennom.

Hvis sharp feiler å laste i prod (f.eks. ny arch deployes som ikke
har prebuilts), faller PNG-endepunktene tilbake til 503 og frontend
bruker SVG-fallback. Ingen tjeneste-down.

## Plan

1. Denne analysen — commit 1
2. `npm install sharp@latest --save` — commit 2 (separat for
   audit-trail på dependency-add)
3. `server/branding/png-renderer.js` (sharp-wrapper + cache) — commit 3
4. `server/branding/templates/og-image.template.svg` — commit 3
5. `server/http/branding.js` PNG-handlers + manifest-update — commit 3
6. `client/index.html` link/meta-additions — commit 4
7. Tester: `tests/branding-png-endpoints.test.js` — commit 5
8. Full lokal CI + Docker multi-arch lokalbygg-sjekk hvis mulig
9. Push + PR + auto-merge etter grønn CI per blank-check
