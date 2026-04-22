# Lokal-først arbeidsflyt — innføring 2026-04-20

**Status:** Adoptert. Evalueringsdato: **1. juni 2026** (~5 uker).
**Canonical reference:** `CLAUDE.md` DEL 5.2.

---

## Hvorfor vi gjorde endringen

### Volum-måling (10 dager forut)

- ~3 000 GitHub Actions-jobs kjørt totalt
- ~300 jobs per dag (8–10 jobs × 7–10 pushes)
- Nådde GitHub Actions billing-limit 2026-04-20, blokkerte Coverage
  gate, OSV vulnerability scan og SBOM generation på PR #61
- Ikke bærekraftig på nåværende CI-dimensjonering når pilot-
  familier utvides eller når multi-tenant-fasen gir lengre
  PR-syklus

### Pattern som drev forbruket

Per-PR-mønsteret var:

1. Claude skriver analyse → commit → push
2. Claude skriver kode → commit → push
3. CI feiler på lint/test → fix → push
4. CI feiler på coverage → fix → push
5. CI feiler på tests → fix → push

Hver push trigget 8–10 jobs × runner-minutter. Med 2–5 pushes per
PR og 3–5 PR-er per dag ble det ~200–300 jobs daglig. Mange av
disse var redundante — samme coverage-gate-jobb kjørte 5 ganger
per PR mens koden stabiliserte seg.

### Alternativ vi valgte mot

Å bare øke spending-limit ville gi kortsiktig lettelse men ikke
adressere det underliggende mønsteret. Samtidig viste det seg at
~70 % av CI-kjøringene ikke fanget noe nytt (samme test-run som
forrige push, samme lint-resultat). Kostnaden ble båret uten
kvalitetsgevinst.

---

## Hva som endres teknisk

### Ny arbeidsflyt

| Steg | Før | Etter |
|---|---|---|
| Hver commit | Push umiddelbart | Commit lokalt, **ikke** push |
| Lokal CI | Ad hoc, ofte hoppet over | **Alltid** via `scripts/local-ci.sh` |
| Push | 5–10 ganger per PR | 1 gang per PR, kun når Christer sier push |
| Squash | Av og til | **Alltid** før push: 10–15 commits → 1–3 |
| Cross-platform CI | Hver PR-push (4 matrix-jobs) | Kun ved merge til main |
| OSV / SBOM | Hver PR-push | Ukentlig cron (søndag 02:00 UTC) |
| Perf-regresjon | Nightly + PR på server/-endringer | Ukentlig cron (samme tid) |

### Lokal CI-pyramide

```
Tier 1  (sekunder)  — lint, format, typecheck
Tier 2  (30–60 s)   — unit tests
Tier 3  (2–3 min)   — coverage-gate, npm audit
```

Kommando: `scripts/local-ci.sh` (Linux/macOS) eller
`scripts/local-ci.ps1` (Windows). Supports `--instant` og `--fast`
flagg for å hoppe over tiers under aktiv redigering.

### Redusert GitHub CI

Workflows endret:

- **`.github/workflows/ci.yml`** — test-job delt i to:
  - `test` — Linux Node 20 only, kjører alltid (PR-gate). Beholder
    navnet `Test (Node 20.x, ubuntu-latest)` slik at branch-
    protection matcher.
  - `test-cross-platform` — kjører kun på `push` til main eller
    schedule. macOS, Windows, Node 22.
  - `coverage`, `security` — kjører alltid (billig, viktig)
  - `sbom`, `osv-scan` — kjører kun på main-merge eller schedule

- **`.github/workflows/performance.yml`** — cron endret fra
  nightly til ukentlig (søndag 02:00 UTC). PR-trigger fjernet;
  beholder `workflow_dispatch` for manuelle kjøringer.

### Retry-grense

Hvis GitHub CI feiler etter push: maks 3 forsøk på samme branch.
Hvert forsøk logges i `ops/logs/push-attempts/` med dato, branch,
feil-oppsummering, og hva som ble endret. Etter 3 mislykkede:
STOPP + rapport til Christer.

---

## Hva som forblir uendret

- **Versjonskontroll:** Git + GitHub, squash-merge som standard
- **Branch protection:** påkrevde status-checks matcher fortsatt
  navnene `Test (Node 20.x, ubuntu-latest)`, `Coverage gate`,
  `Security audit` (alle kjører på hver PR som før)
- **Autonom merge:** `chore/docs/test/deps` kan fortsatt merges
  autonomt når CI er grønn (CLAUDE.md DEL 5.1)
- **Dependabot:** følger eksisterende `.github/dependabot.yml`
- **Portainer pull_policy:** `:main`-tag, automatisk henting etter
  merge — uendret
- **STOPP-triggere:** alle DEL 2-triggere gjelder fortsatt, også
  for lokal-først-arbeid

---

## Hva som reverseres hvis vi går tilbake

Hvis 1. juni-evalueringen konkluderer med at lokal-først ikke
fungerer (f.eks. for mange "jeg trodde det var grønt lokalt men
CI var rød"-tilfeller), kan vi reversere:

1. `.github/workflows/ci.yml` — gjenopprett full matrix på hver
   push + fjern `if:` på sbom/osv-scan.
2. `.github/workflows/performance.yml` — gjenopprett nightly cron
   + PR-trigger på server/-endringer.
3. `CLAUDE.md` DEL 5.2 — slett seksjonen, renumber 5.3-5.5 tilbake
   til 5.2-5.4.
4. `scripts/local-ci.*` — kan beholdes som frivillig hjelpeverktøy
   (ingen skade).
5. Oppdater `ops/logs/push-attempts/` med siste status.

Reverseringen kan gjøres i én chore/-PR. Git-historikk bevarer
adopsjons-logen.

---

## Risiko og mitigering

| Risiko | Sannsynlighet | Mitigering |
|---|---|---|
| "Lokal grønt, CI rødt" (f.eks. OS-avhengighet) | middels | Squash-disiplin + kjøre full pyramide før batch-push. Cross-platform matrix kjører fortsatt på main-merge som safety-net. |
| Arbeid går tapt ved PC-krasj | lav | Lokal commit-disiplin; ikke stol på uncommittede endringer. Vurder daglig `git bundle` til ekstern disk hvis faktisk problem oppstår. |
| Glemte å pushe før lang pause | lav | Christer har synlighet via CONTEXT.md `PÅGÅR`-seksjon som oppdateres av Claude. |
| Lokal CI kommer ut av sync med GitHub CI | middels | `scripts/local-ci.*` kjører samme kommandoer som `.github/workflows/ci.yml`. Oppdateres samtidig ved endring. |
| Retry-loop ved CI-feil spiser likevel budsjettet | lav | 3-forsøk-regelen + `ops/logs/push-attempts/` gir rask synlig bremse. |

---

## Evaluerings-kriterier (1. juni 2026)

Ved evaluering ser vi på:

1. **Reduksjon i GitHub Actions-forbruk.** Target: ≥ 75 %.
   Måles ved å sammenligne jobs/dag-snitt 2026-04-20 til 1. juni
   mot 2026-04-10 til 2026-04-20.
2. **Antall "lokal grønt, CI rødt"-tilfeller.** Target: ≤ 1 per
   10 PR-er. Måles via `ops/logs/push-attempts/`.
3. **PR-syklustid** (første commit → merge). Target: uendret
   eller bedre enn før overgangen. Måles via GitHub PR-metadata.
4. **Christers tempo-opplevelse.** Subjektiv: "føles det at ting
   går fremover, eller at Claude sitter fast?"

Hvis ≥ 3 av 4 kriterier er OK → fortsett. Hvis ≤ 2 → revurder.

---

## Referanser

- `CLAUDE.md` DEL 5.2 — arbeidsflyt-reglene (canonical)
- `scripts/local-ci.sh` / `.ps1` — script
- `ops/logs/push-attempts/` — retry-logging
- Commit-meldinger med `chore: innfør lokal-først arbeidsflyt`
  i `chore/local-first-workflow-setup`-branch
