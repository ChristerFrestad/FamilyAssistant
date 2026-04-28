# Repo Cleanup Runde C — 28. april 2026

Utført like etter PR #68 (Fase 1b) ble merget til main. Formålet
var å rydde lokal-repo og remote slik at Fase 1c starter med rent
fundament.

---

## Sammendrag

| Felt | Før | Etter |
|------|----:|------:|
| Lokale branches | 4 | 1 (`main`) |
| Remote branches (utenom `main`/`HEAD`) | 32 | 7 |
| Stashes | 2 | 0 |
| Totalt slettet | — | 24 remote + 3 lokal + 2 stash = **29** |

Total varighet: én commit-syklus over ~30 minutter (Runde A + B + C).
Ingen feil fra `git push --delete` eller `git branch -D`.

---

## Beholdt

- **`main`** (lokal og remote) — eneste aktive branch.
- **`origin/claude/add-user-ids-family-VISUV`** — knyttet til **PR #56**
  ("feat(users): per-user scoping within Family (planning stage)")
  som fortsatt er åpen. Ble eksplisitt unntatt fra Runde C-slettingen.
- **6 `origin/dependabot/*`** — auto-managed av Dependabot, slettes
  når PR-ene merges:
  - `dependabot/github_actions/docker/build-push-action-7`
  - `dependabot/github_actions/google/osv-scanner-action-2.3.5`
  - `dependabot/github_actions/peter-evans/create-pull-request-8`
  - `dependabot/npm_and_yarn/dev-minor-950876b677`
  - `dependabot/npm_and_yarn/sentry/node-10.50.0`
  - `dependabot/npm_and_yarn/typescript-6.0.3`

---

## Slettet — full liste

### Runde A (utført før Runde C)

- **Origin** `feat/fase-1b-design-system` — merged via PR #68.
- **Lokal** `feat/fase-1b-design-system` — samme.
- **Lokal** `analysis/frontend-redesign-2026-04` — merged, 0 unique.
- **Lokal** `analysis/frontend-redesign-onboarding-screens` — merged,
  0 unique.

### Runde C — lokale branches (3)

| Branch | Hadde | Begrunnelse for sletting |
|--------|-------|--------------------------|
| `chore/post-merge-pr60-week1-governance` | 1 commit (uke-1-status) | 8 dager gammel, vi er nå uke 18 |
| `docs/baseline-2026-w17` | 2 commits | Innholdet (`docs/baselines/2026_W17.md`) er allerede på main via PR #64 |
| `analysis/2026-04-20-shopping-bought-state` | 1 commit (rotårsaks-analyse) | Problemet er løst i PR A-arbeidet (fokusgruppe-feedback pkt 6) |

### Runde C — stashes (2)

| Stash | Innhold | Begrunnelse |
|-------|---------|-------------|
| `stash@{0}` (på `fix/empty-shopping-list-analysis`) | 423 ins / 423 del | Pure CRLF-line-ending-flip, ikke ekte arbeid |
| `stash@{1}` (på `main`) | 1202 ins / 1202 del | Pure CRLF-line-ending-flip, ikke ekte arbeid |

### Runde C — remote `fix/*` (6)

Alle 10 dager gamle, alle uten åpen PR. Innholdet (engelsk README,
port 7777, Sentry-håndtering) er allerede på main via andre paths.

- `fix/ci-prettier-and-english-readme`
- `fix/default-port-7777`
- `fix/port-13000-and-windows-test`
- `fix/readme-english-and-prettier`
- `fix/rpi-named-volume-eacces`
- `fix/sentry-test-optional-dep`

### Runde C — remote `chore/*` (3)

| Branch | Begrunnelse |
|--------|-------------|
| `chore/contributor-docs` | `CONTRIBUTING.md` + `.github/CODEOWNERS` finnes på main |
| `chore/post-merge-pr60-week1-governance` | Speil av lokal-branch (utdatert week-1 status) |
| `chore/rebaseline-perf-workflow` | `.github/workflows/rebaseline-perf.yml` finnes på main |

### Runde C — remote `feat/bootstrap-wizard` (1)

- `feat/bootstrap-wizard` — bootstrap-implementasjonen er på main
  (`server/auth/bootstrap-session-secret.js`, `server/http/bootstrap.js`,
  `tests/phase22-bootstrap.test.js`); branchen er fra v1-deploy-flyten
  og uten relasjon til Fase 1e-onboarding.

### Runde C — remote `claude/*` (12)

Alle uten åpen PR. **`claude/add-user-ids-family-VISUV` ble eksplisitt
unntatt** fordi den knyttes til åpen PR #56.

- `claude/auth-family-pantry-k6YYm` (21 commits, phases 12-21 multi-phase)
- `claude/analyze-test-coverage-vHxNB` (17 commits, varierte features)
- `claude/phase-one-cleanup-qSxDP` (4 commits, repositories.js split)
- `claude/review-report-code-Ww0Pj` (14 commits, engelsk-translasjon)
- `claude/e2e-testing-multilingual-0ywgK`
- `claude/fix-auth-token-env-trBoq`
- `claude/fix-backup-permissions-mUp2s`
- `claude/fix-prettier-repos-kRj2`
- `claude/next-natural-step-KrjXT`
- `claude/precommit-hook-husky`
- `claude/prepare-public-deploy-R2Yhc`
- `claude/smart-recipe-suggestions-1VuZ5`

**Notat om `claude/review-report-code-Ww0Pj`:** Denne hadde 14
commits med engelsk-translasjon av kommentarer/scripts/repositories
som potensielt kunne gitt forhånds-arbeid for pre-deploy-uke-10-11.
Christer besluttet at det er bedre å slette den og gjøre arbeidet
fra scratch når pre-deploy-fasen kommer — da basert på fase-1c+
kodebase, ikke en 14 dager gammel snapshot.

### Runde C — remote speil-branches (2)

- `analysis/2026-04-20-shopping-bought-state` (speil av lokal)
- `docs/baseline-2026-w17` (speil av lokal)

---

## Verifisering

### Sluttilstand

```text
* main
  remotes/origin/HEAD -> origin/main
  remotes/origin/claude/add-user-ids-family-VISUV
  remotes/origin/dependabot/github_actions/docker/build-push-action-7
  remotes/origin/dependabot/github_actions/google/osv-scanner-action-2.3.5
  remotes/origin/dependabot/github_actions/peter-evans/create-pull-request-8
  remotes/origin/dependabot/npm_and_yarn/dev-minor-950876b677
  remotes/origin/dependabot/npm_and_yarn/sentry/node-10.50.0
  remotes/origin/dependabot/npm_and_yarn/typescript-6.0.3
  remotes/origin/main
```

`git stash list` — tom.
`git status` — `On branch main / nothing to commit, working tree clean`.

### Sanity-check (full pipeline på main, etter sletting)

| Sjekk | Resultat |
|-------|----------|
| `npm run lint` | ✅ 0 errors (3 pre-existing warnings i `server/routes.js`, samme som før) |
| `npm run typecheck` | ✅ Clean |
| `npm run typecheck:client` | ✅ Clean |
| `npm run test` | ✅ **1258 / 1260** (2 skipped, 0 fail) |
| `npm run test:client` | ✅ **180 / 180** |
| `npm run build:client` | ✅ 32 modules, 1.42s, 150.50 kB JS / 26.22 kB CSS (uendret) |
| `npm run audit:prod` | ✅ **0 vulnerabilities** |

Ingen av slettingene har påvirket main eller arbeidstreet.

---

## Neste steg

1. **Oppgave 2 — Repo-tilstand-revisjon** (større strukturell
   oversikt). Identifisere foreldreløse filer, gamle eksperimenter,
   utdatert dokumentasjon, dependency-status, TODO-kommentarer,
   norsk-tekst-omfang.
2. Etter Oppgave 2 — Backend-revisjon (separat fase når Christer er
   klar). Per-modul coverage-analyse, sikkerhetskritiske moduler.
3. Deretter — Fase 1c (i18n med `react-i18next`).
