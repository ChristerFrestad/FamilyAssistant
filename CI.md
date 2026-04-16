# CI/CD — Familieassistenten

**Etablert:** 2026-04-10 (uke 1 av ISO/IEC 25010-forbedringsplan)

Dette dokumentet beskriver kvalitetsgatene som må passere for at en endring
kan merges til `main`.

---

## Oversikt

GitHub Actions kjører følgende tre jobber på hver push og pull request mot `main`:

| Jobb | Beskrivelse | Matriks |
|---|---|---|
| `test` | Lint + format + tester | Node 20.x, Node 22.x (ubuntu-latest) |
| `coverage` | Native Node coverage + gate | Node 20.x |
| `security` | npm audit (runtime-deps) | Node 20.x |

Workflow-fil: `.github/workflows/ci.yml`.

Alle jobber må være grønne før merge. Dette erstatter tidligere manuell disiplin.

---

## Lokale kommandoer

```bash
# Full CI-gate lokalt (lint + format + test)
npm run ci

# Enkeltsteg
npm run lint           # ESLint, 0 errors tillatt
npm run format         # Prettier --check
npm test               # 408 tester, alle må passere

# Coverage
npm run test:coverage       # spec-reporter med coverage-tabell
npm run test:coverage:gate  # som over + feiler hvis under terskel

# Auto-fix
npm run lint:fix       # eslint --fix
npm run format:fix     # prettier --write

# Runtime-deps audit (som i CI)
npm run audit:prod
```

---

## Terskler

### ESLint (`eslint.config.mjs`)
- **Errors:** 0 tillatt. Gjelder blokkerende regler som `no-undef`,
  `no-dupe-keys`, `no-unreachable`, `valid-typeof`.
- **Warnings:** 25 pt (baseline 2026-04-10). Disse er ikke-blokkerende
  og skal ryddes gradvis i senere uker.

### Prettier (`.prettierrc.json`)
- 100 tegn linje-bredde, 2 mellomrom, single quotes, ES5 trailing commas.
- Gate: `prettier --check` må gi 0 mismatches.

### Coverage-gate (`scripts/coverage-gate.js`)
Basert på native Node 20 `--experimental-test-coverage`:

| Metrikk | Baseline 2026-04-10 | Terskel (feiler hvis under) |
|---|---|---|
| Lines | 83.26% | **80.00%** |
| Branches | 71.23% | **68.00%** |
| Functions | 75.83% | **72.00%** |

Tersklene er satt ca. 3 pt under baseline for å tillate naturlig variasjon
uten å være så løse at coverage kan rases. Økes etter uke 3-4 når frontend
er modularisert og testbar.

### npm audit
- `npm audit --omit=dev --audit-level=high` må gi 0 advarsler.
- Dev-deps auditerer på `moderate`-nivå som informasjons-steg (ikke-blokkerende).

---

## Dependabot

Weekly updates (mandager 07:00 Europe/Oslo):
- **npm production** og **development** — groupert på minor/patch for mindre støy
- **GitHub Actions** — action-versjoner

Major-versjoner kommer som separate PRs for manuell vurdering.

Konfig: `.github/dependabot.yml`.

---

## Første-gangs-oppsett for nye bidragsytere

```bash
git clone <repo>
cd Familieassistenten
npm ci              # ikke 'npm install' — bruker package-lock.json
                    # `prepare`-scriptet aktiverer husky pre-commit-hook
npm run ci          # verifisér at alt er grønt lokalt før første commit
```

---

## Pre-commit hook (husky + lint-staged)

`npm ci` (eller `npm install`) trigger `prepare`-scriptet som aktiverer
husky. På hvert `git commit` kjøres `.husky/pre-commit` som igjen kaller
`npx lint-staged`. Staged filer auto-fikses før commit:

| Glob | Kommandoer |
|---|---|
| `server/**/*.js`, `scripts/**/*.js`, `tests/**/*.js` | `eslint --fix` + `prettier --write` |
| `public/sw.js` | `eslint --fix` + `prettier --write` |
| `public/js/**/*.js` | `eslint --fix` (ikke i `format`-globbet) |
| `public/manifest.json`, `package.json` | `prettier --write` |

**Hvorfor:** Forhindrer at format/lint-rettelser må gjøres i separate
follow-up-commits (som skjedde med PR #22 etter at PR #20 merget inn 2
uformatterte filer).

**Overstyring:** `git commit --no-verify` hopper over hooken — men bruk
kun ved WIP-stash eller unntakstilfeller. Hvis hooken feilaktig blokkerer
en commit, rapportér det som en issue.

**CI-kompatibilitet:** `prepare`-scriptet er `"husky || true"` slik at
det ikke feiler i Docker-builds hvor husky ikke installeres
(`npm ci --omit=dev`).

---

## Feilsøking

### Lint feiler lokalt, men ikke i CI (eller motsatt)
Sjekk at du bruker samme Node-versjon som CI: `node --version` skal være
`v20.x` eller `v22.x`. Kjør `npm ci` fremfor `npm install` for å få
nøyaktig samme avhengigheter som CI.

### Coverage-gate feiler
1. Kjør `npm run test:coverage` lokalt og se hvilken metrikk som droppet.
2. Hvis endringen din lovlig reduserer coverage (f.eks. fjerner død kode),
   kan tersklene justeres i `scripts/coverage-gate.js`.
3. Ellers: skriv tester for den nye koden.

### Prettier-mismatch på flere filer
Kjør `npm run format:fix` og commit resultatet som egen "style"-commit.

### ESLint-feil du er uenig i
Legg en `// eslint-disable-next-line <rule>`-kommentar med begrunnelse.
Ikke slå av regler globalt uten diskusjon i PR.

---

## Historikk

- **2026-04-10** — initial CI/CD-pipeline etablert (ISO-plan uke 1).
  - 408 tester + lint + format + coverage-gate + npm audit
  - Baseline coverage: 83.26% / 71.23% / 75.83%
  - 4 nye devDeps: eslint, @eslint/js, globals, prettier

- **2026-04-16** — `@eslint/js` oppgradert fra v9.38.0 til v10.0.1
  (post-v1.3.0 cleanup; punkt 3 i gjenstående tekniske gjeld).
  De to nye error-reglene i `js.configs.recommended` —
  `no-useless-assignment` og `preserve-caught-error` — avdekket 8
  kode-brudd som ble fikset i kilden. Ingen regler ble deaktivert.

- **2026-04-16** — pre-commit hook lagt til (husky + lint-staged).
  Kjører `eslint --fix` og `prettier --write` på staged filer før
  commit. Introdusert etter at PR #20 merget 2 uformaterte filer som
  brøt main CI i et lite vindu.
