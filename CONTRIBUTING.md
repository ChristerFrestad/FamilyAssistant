# Bidra til Familieassistenten

Takk for at du vurderer å bidra. Dette er et personlig, selvhostet husholdnings-
system skrevet for å kjøre lokalt på en Raspberry Pi 5, men jeg tar gjerne imot
ryddige bidrag fra andre.

Hoveddokumentasjonen er på norsk siden appen er norsk-fokusert. Du kan gjerne
åpne issues og PR-beskrivelser på engelsk om det er mer praktisk for deg.

---

## Kort oppsummering

1. Åpne en [issue](https://github.com/ChristerFrestad/FamilyAssistant/issues)
   først hvis du planlegger en større endring — da kan vi avklare scope før
   du bruker tid på koden.
2. Opprett en branch (se [Branch-navngivning](#branch-navngivning)).
3. Utfør arbeidet. Kjør `npm run ci` før commit.
4. Åpne en PR mot `main`. CI kjører alle gates automatisk.
5. Jeg reviewer. Når alt er grønt og vi er enige, squash-merges PR-en.

---

## Rapportere bugs

Bruk [GitHub Issues](https://github.com/ChristerFrestad/FamilyAssistant/issues)
og inkluder:

- Kort beskrivelse av problemet
- Hvordan reprodusere (steg for steg)
- Forventet vs. faktisk oppførsel
- Node-versjon (`node --version`), OS, om det er Docker/bare-metal
- Relevante logg-utdrag fra `~/.familieassistenten/logs/` eller Docker-logs

Har du funnet en **sikkerhetssårbarhet**, ikke åpne en offentlig issue — se
[SECURITY.md](SECURITY.md) for hvordan du rapporterer privat.

---

## Foreslå funksjoner

Åpne en issue med label `enhancement` og beskriv:

- Brukerproblemet du løser (ikke bare løsningen)
- Hvorfor dette passer i appens scope (lokal, familie-fokusert, enkel drift)
- Alternativer du har vurdert

Jeg er konservativ med nye funksjoner. Appen skal forbli enkel å drifte på en
Raspberry Pi av en familie uten IT-bakgrunn. Funksjoner som krever ekstern
avhengighet, cloud-kontoer, eller stor kompleksitet avvises typisk.

---

## Utviklingsoppsett

Se [CI.md](CI.md) for full beskrivelse. Kort:

```bash
git clone https://github.com/ChristerFrestad/FamilyAssistant.git
cd FamilyAssistant
npm ci                        # ikke 'npm install'
npm run ci                    # verifisér at alt er grønt lokalt
```

Node 20.x eller 22.x. SQLite-støtte via `better-sqlite3` (native binding bygges
av `npm ci`) eller `sql.js` som fallback.

---

## Branch-navngivning

Bruk prefiks som matcher Conventional Commits (se neste seksjon):

| Prefiks | Bruk |
|---|---|
| `feat/` | Ny funksjonalitet |
| `fix/` | Bug-fiks |
| `chore/` | Vedlikehold, ikke brukervendt (build, CI, deps) |
| `docs/` | Kun dokumentasjonsendringer |
| `refactor/` | Strukturelle endringer uten adferdsendring |
| `test/` | Kun test-tillegg/-endringer |
| `ci/` | CI/CD-konfig-endringer |
| `deps/` | Dependency-oppgraderinger (Dependabot bruker dette) |

Eksempel: `feat/weekly-menu-export`, `fix/pantry-unit-conversion`,
`chore/prettier-config`.

---

## Commit-meldinger (Conventional Commits)

Prosjektet følger [Conventional Commits 1.0](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

Vanlige typer: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `perf`,
`style`, `deps`.

**Regler:**

- Subject i imperativ, små bokstaver, ingen punktum: `add X`, `fix Y`, ikke
  `Added X.`
- Maks 72 tegn i subject, 100 tegn per linje i body
- Body forklarer **hvorfor**, ikke **hva** (diffen viser hva)
- Referér issues med `Refs #42` eller `Closes #42` i footer

**Eksempel (hentet fra historikken):**

```
chore(deps): bump @eslint/js to v10 and fix new recommended errors

Upgrading aligns @eslint/js with eslint itself (already on v10.2.0) and
activates two new error rules in js.configs.recommended:

- no-useless-assignment (4 fixes)
- preserve-caught-error (4 fixes)

No eslint-disable directives used; all 8 errors fixed in source.

Closes #42
```

---

## Kode-konvensjoner

- **ESLint flat config** (`eslint.config.mjs`) — 0 errors tillatt
- **Prettier** (`.prettierrc.json`) — 100 tegn, single quotes, trailing commas
  (ES5)
- **TypeScript i JSDoc** — opt-in via `// @ts-check` på toppen av filer.
  Se `docs/TYPE_COVERAGE.md`
- **Tester** — `node --test` (ingen Jest/Mocha). Alle nye features må ha
  tester. Coverage-gate må passere
- **Kommentarer** — engelsk i ny kode, norsk i eldre filer aksepteres
  inntil videre

Kjør `npm run lint:fix && npm run format:fix` før commit.

---

## Frontend-struktur: `app/` vs `dev/`

V2-frontenden (React-redesign under `client/`) har en hard grense mellom
produksjons-kode og dev-only-verktøy. Regelen er enkel:

- Alt under `client/src/app/` (og `client/src/main.tsx`, som er
  entry-point for produksjons-appen) er **produksjonskode** og skal
  ende opp i bundlen.
- Alt under `client/src/dev/` er **utviklerverktøy** — komponent-
  gallerier, debug-panel, preview-sider, eksperimenter — som aldri
  skal ende opp i produksjon.
- **Produksjonskode kan IKKE importere fra `dev/`.** Dev-kode kan
  importere fritt fra `app/` (en preview-side for `Button` skal
  selvsagt bruke den ekte `Button`-komponenten).

Grensen er maskinelt håndhevet:

- `client/vite-plugins/enforce-isolation.ts` fanger ethvert
  `app → dev`-import-forsøk og krasjer bygget med en tydelig
  feilmelding som navngir både importer og target. Pluginet kjører
  i både `npm run dev:client` og `npm run build:client`.
- `tests/client-dev-isolation.test.js` beviser at pluginen virker
  ved å kjøre en ekte Vite-build mot en probe som bryter grensen
  (forventer feil) og en som ikke gjør det (forventer success).
  Testen kjører som del av `npm test`.

Hvis du havner i en situasjon der kode i `dev/` ville vært nyttig
i produksjonen, flytt den til `client/src/app/lib/` først — og
importer den deretter fra begge steder. Ikke strekk gjennom grensen.

Se også `client/src/dev/README.md` for detaljer og CLAUDE.md
seksjon 7.7 for den bredere regelen om teknisk gjeld som denne
grensen er én manifestasjon av.

---

## Testkrav

Alle PR-er må passere:

| Gate | Terskel |
|---|---|
| `npm run lint` | 0 errors |
| `npm run format` | 0 mismatches |
| `npm run typecheck` | 0 feil |
| `npm test` | 100 % |
| Coverage | 80 % lines, 68 % branches, 72 % functions |
| `npm audit --omit=dev` | 0 high+ |
| OSV-scan | 0 high+/critical |

CI kjører alt på Linux/macOS/Windows × Node 20/22.

---

## Pull Request-prosess

1. **Rebase på main** før du åpner PR:
   ```bash
   git fetch origin && git rebase origin/main
   ```
2. Push branch-en din: `git push -u origin <branch-name>`
3. Åpne PR mot `main`
4. Beskriv **hvorfor**-en i PR-body, lenk til issue hvis relevant
5. Vent på grønn CI (alle 6 jobber)
6. Vent på review fra [CODEOWNERS](.github/CODEOWNERS)
7. Adressér review-kommentarer ved å pushe nye commits (ikke force-push mens
   review pågår — det gjør det vanskelig å se hva som er endret siden forrige
   runde)
8. Når approved, squash-merges PR-en inn i main

**Hva jeg som reviewer ser etter:**

- Løser PR-en det den hevder?
- Er scope fokusert? (ingen uforeslåtte refaktoreringer på si)
- Tester som verifiserer den nye adferden
- Ingen regressions i eksisterende tester
- Dokumentasjon oppdatert (CHANGELOG, relevant `*.md`)
- Ingen sensitive data (API-nøkler, personopplysninger, private stier)

---

## Lisens og opphav

Ved å bidra samtykker du til at koden din utgis under prosjektets MIT-lisens
(se `license`-feltet i `package.json`). Du erklærer også at:

- Du har opphavsrett til det du bidrar med, eller
- Bidraget er under en kompatibel lisens og du har rett til å submit-e det

Det finnes ikke en formell CLA. Ingen `Signed-off-by`-linje kreves, men du er
velkommen til å bruke `git commit -s` hvis du foretrekker DCO-stil.

---

## Kode-attribusjon

All kode som merges til `main` skal ha bidragsyteren selv som git-author. Ikke
opprett commits der andre personer, verktøy eller AI-assistenter står som
(co-)author med mindre de faktisk har skrevet koden uavhengig.

Dette gjelder også footers i commit-meldinger: ikke lim inn tool-genererte
tracking-URL-er eller "Generated with X"-notiser.

---

## Sikkerhet

Sårbarheter rapporteres privat, ikke som issue. Se [SECURITY.md](SECURITY.md).

---

## Spørsmål

Hvis noe er uklart, åpne en issue med label `question` eller send en
kommentar i en eksisterende PR.

---

## For maintainere

Denne seksjonen er for repo-eieren og andre med admin-tilgang.

### Branch protection på `main`

Konfigurér via GitHub UI: **Settings → Branches → Add branch ruleset** (eller
**Branch protection rules** på eldre repos). Anbefalt konfigurasjon:

- **Branch name pattern:** `main`
- ☑ **Require a pull request before merging**
  - ☑ Require approvals: **1**
  - ☑ Dismiss stale pull request approvals when new commits are pushed
  - ☑ Require review from Code Owners
- ☑ **Require status checks to pass before merging**
  - ☑ Require branches to be up to date before merging
  - **Required checks** (alle må eksistere i `ci.yml` først):
    - `Test (Node 20.x, ubuntu-latest)`
    - `Test (Node 22.x, ubuntu-latest)`
    - `Test (Node 20.x, macos-latest)`
    - `Test (Node 20.x, windows-latest)`
    - `Coverage gate`
    - `Security audit`
    - `SBOM generation`
    - `OSV vulnerability scan`
- ☑ **Require conversation resolution before merging**
- ☑ **Require signed commits** (valgfritt, men anbefalt)
- ☑ **Require linear history** (passer med squash-merge-policy)
- ☑ **Do not allow bypassing the above settings** (gjelder også admins — skru
  av bare hvis du har en genuin nødsituasjon)
- ☐ Allow force pushes — **la denne stå av**
- ☐ Allow deletions — **la denne stå av**

### Squash-merge som default

**Settings → General → Pull Requests:**

- ☑ Allow squash merging (default commit = PR title + body)
- ☐ Allow merge commits
- ☐ Allow rebase merging
- ☑ Always suggest updating pull request branches
- ☑ Automatically delete head branches

### Dependabot auto-merge (valgfritt)

For dev-dep minor/patch-bumps kan du aktivere auto-merge når alle gates er
grønne — se `.github/dependabot.yml` som allerede grupperer dem.

### Signert tagging

Release-tags (`v1.3.0` osv.) bør være GPG-signert. Konfigurér med
`git config --global commit.gpgsign true` og bekreft i lokalt git-oppsett.
