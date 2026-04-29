## Sammendrag

Fase 1c — internasjonaliserings-fundament for v2-frontend. Norsk er pilot-launch-språk; engelsk er forberedt og synlig via ny `LanguageSwitcher`-komponent. Alle nye bruker-vendte tekster fra og med nå skal gå gjennom `react-i18next` (governance i `CLAUDE.md` DEL 7.11).

## Stack

| Pakke | Versjon |
|-------|---------|
| `react-i18next` | 17.0.6 |
| `i18next` | 26.0.8 |
| `i18next-browser-languagedetector` | 8.2.1 |

Alle pinned til eksakte versjoner. `npm audit --omit=dev` rapporterer 0 vulnerabilities.

## Arkitektur

- **`client/src/app/i18n/config.ts`** — wirer i18next + LanguageDetector. Norsk default, engelsk fallback. localStorage-key `fa:language`.
- **`locales/{no,en}/{namespace}.json`** — 16 JSON-filer (8 namespaces × 2 språk) med parallel-key-shape, håndhevet av ny parity-test.
- **8 namespaces:** `common`, `auth`, `dashboard`, `family`, `meals`, `shopping`, `calendar`, `settings` — én per planlagt produktoverflate.

## Migrert tekst

| Komponent | Endring |
|-----------|---------|
| **Modal** | `aria-label="Lukk"` → `t('common:actions.close')` |
| **CopyButton** | Default labels `"Kopier"` / `"Kopiert!"` → `t('common:actions.copy')` / `t('common:actions.copied')`. Eksplicit `label`/`copiedLabel`-props overstyrer fortsatt. |
| **PortionFactorSlider** | Description + visible role-label (`{role}porsjon`) → `t('family:portion.description')` + `t('family:portion.label', { role })`. `getPortionLabel` API uendret (returnerer fortsatt `'barn'\|'ungdom'\|'voksen'`); `PortionLabel→PortionRole`-mapping er intern. |

## Ny komponent — LanguageSwitcher

To-knapp NO/EN-toggle bygd på eksisterende `Button`-primitiv. `aria-pressed` beskriver toggle-semantikk. Persistens via `i18next-browser-languagedetector`-cache. Plassering: `client/src/app/components/form/LanguageSwitcher.tsx` + preview-fil under `dev/preview/sections/components/`.

## Tester

| Fil | Tester | Tema |
|-----|-------:|------|
| `LanguageSwitcher.test.tsx` | **6** | Group-label, default-pressed-state, language-change, localStorage-persistens, no-op-på-aktiv, post-change-state |
| `bundles.test.ts` | **14** | Namespace-inventar, key-parity (NO↔EN per namespace), runtime-resolution + interpolation + unknown-key-fallback |

**`test-setup.ts`-utvidelse:** forces `i18n.changeLanguage('no')` i `beforeEach` slik at jsdom's `en-US` `navigator.language` ikke overrider eksisterende norsk-tekst-assertions.

## Governance — CLAUDE.md DEL 7.11

Ny seksjon dokumenterer:

- All ny bruker-vendt tekst går gjennom i18n (NO+EN samtidig, deretter `t()` i komponent)
- Pluralisering, datoer, tall via i18next/Intl — aldri hardkodet i JSX
- DB-seed-data og server-logger er **utenfor scope** (logs er engelsk per DEL 7.7; seed følger språket brukeren skrev)
- Pilot-default er `no`; tester forces `no` i setup

## Bundle-impact

| Asset | Før | Etter |
|-------|----:|------:|
| Prod JS | 150.50 kB | **209.68 kB** |
| Prod JS (gzipped) | 48.80 kB | **68.30 kB** |
| Prod CSS | 26.22 kB | 26.22 kB (uendret) |

+59 kB ungzipped / +20 kB gzipped — forventet for full i18next-stack med 16 JSON-bundles inlined.

## Test plan

- [x] `npm run lint` — 0 errors
- [x] `npm run typecheck` — clean
- [x] `npm run typecheck:client` — clean
- [x] `npm run test` (server) — 1306/1308 (uendret)
- [x] `npm run test:client` — **200/200** (180 før + 20 nye)
- [x] `npm run audit:prod` — 0 vulnerabilities
- [x] `npm run build:client` — clean

## Etter merge

Klar for **Prompt 4 (Fase 1d — App-shell + responsive nav)**.
