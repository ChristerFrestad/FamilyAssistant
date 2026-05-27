# CI/CD — FamilyAssistant

**Established:** 2026-04-10 (week 1 of the ISO/IEC 25010 improvement plan)

This document describes the quality gates that must pass before a change
can be merged to `main`.

---

## Overview

GitHub Actions runs the following three jobs on every push and pull request against `main`:

| Job | Description | Matrix |
|---|---|---|
| `test` | Lint + format + tests | Node 20.x, Node 22.x (ubuntu-latest) |
| `coverage` | Native Node coverage + gate | Node 20.x |
| `security` | npm audit (runtime deps) | Node 20.x |

Workflow file: `.github/workflows/ci.yml`.

All jobs must be green before merge. This replaces the previous manual discipline.

---

## Local commands

```bash
# Full CI gate locally (lint + format + test)
npm run ci

# Single steps
npm run lint           # ESLint, 0 errors allowed
npm run format         # Prettier --check
npm test               # 408 tests, all must pass

# Coverage
npm run test:coverage       # spec reporter with coverage table
npm run test:coverage:gate  # same as above + fails if below threshold

# Auto-fix
npm run lint:fix       # eslint --fix
npm run format:fix     # prettier --write

# Runtime-deps audit (same as in CI)
npm run audit:prod
```

---

## Thresholds

### ESLint (`eslint.config.mjs`)
- **Errors:** 0 allowed. Applies to blocking rules such as `no-undef`,
  `no-dupe-keys`, `no-unreachable`, `valid-typeof`.
- **Warnings:** 25 pts (baseline 2026-04-10). These are non-blocking
  and will be cleaned up gradually over the coming weeks.

### Prettier (`.prettierrc.json`)
- 100-character line width, 2 spaces, single quotes, ES5 trailing commas.
- Gate: `prettier --check` must yield 0 mismatches.

### Coverage gate (`scripts/coverage-gate.js`)
Based on native Node 20 `--experimental-test-coverage`:

| Metric | Baseline 2026-04-10 | Threshold (fails if below) |
|---|---|---|
| Lines | 83.26% | **80.00%** |
| Branches | 71.23% | **68.00%** |
| Functions | 75.83% | **72.00%** |

Thresholds are set roughly 3 pts below baseline to allow natural variation
without being so loose that coverage can collapse. They will be raised after
weeks 3-4, once the frontend is modularized and testable.

### npm audit
- `npm audit --omit=dev --audit-level=high` must yield 0 warnings.
- Dev deps are audited at `moderate` level as an informational step (non-blocking).

---

## Dependabot

Weekly updates (Mondays 07:00 Europe/Oslo):
- **npm production** and **development** — grouped on minor/patch to reduce noise
- **GitHub Actions** — action versions

Major versions arrive as separate PRs for manual review.

Config: `.github/dependabot.yml`.

---

## First-time setup for new contributors

```bash
git clone <repo>
cd Familieassistenten
npm ci              # not 'npm install' — uses package-lock.json
                    # the `prepare` script activates the husky pre-commit hook
npm run ci          # verify everything is green locally before the first commit
```

---

## Pre-commit hook (husky + lint-staged)

`npm ci` (or `npm install`) triggers the `prepare` script which activates
husky. On every `git commit`, `.husky/pre-commit` runs and in turn calls
`npx lint-staged`. Staged files are auto-fixed before the commit:

| Glob | Commands |
|---|---|
| `server/**/*.js`, `scripts/**/*.js`, `tests/**/*.js` | `eslint --fix` + `prettier --write` |
| `public/sw.js` | `eslint --fix` + `prettier --write` |
| `public/js/**/*.js` | `eslint --fix` (not in the `format` glob) |
| `public/manifest.json`, `package.json` | `prettier --write` |

**Why:** Prevents format/lint fixes from having to be made in separate
follow-up commits (as happened with PR #22 after PR #20 merged in 2
unformatted files).

**Override:** `git commit --no-verify` skips the hook — but use it only
for WIP stashes or exceptional cases. If the hook erroneously blocks
a commit, report it as an issue.

**CI compatibility:** The `prepare` script is `"husky || true"` so that
it does not fail in Docker builds where husky is not installed
(`npm ci --omit=dev`).

---

## Troubleshooting

### Lint fails locally but not in CI (or vice versa)
Check that you're using the same Node version as CI: `node --version` should be
`v20.x` or `v22.x`. Run `npm ci` instead of `npm install` to get the exact
same dependencies as CI.

### Coverage gate fails
1. Run `npm run test:coverage` locally and see which metric dropped.
2. If your change legitimately reduces coverage (e.g. removes dead code),
   the thresholds can be adjusted in `scripts/coverage-gate.js`.
3. Otherwise: write tests for the new code.

### Prettier mismatch on multiple files
Run `npm run format:fix` and commit the result as its own "style" commit.

### ESLint error you disagree with
Add an `// eslint-disable-next-line <rule>` comment with justification.
Do not turn off rules globally without discussion in the PR.

---

## History

- **2026-04-10** — initial CI/CD pipeline established (ISO plan week 1).
  - 408 tests + lint + format + coverage gate + npm audit
  - Baseline coverage: 83.26% / 71.23% / 75.83%
  - 4 new devDeps: eslint, @eslint/js, globals, prettier

- **2026-04-16** — `@eslint/js` upgraded from v9.38.0 to v10.0.1
  (post-v1.3.0 cleanup; item 3 in remaining tech debt).
  The two new error rules in `js.configs.recommended` —
  `no-useless-assignment` and `preserve-caught-error` — surfaced 8
  code violations that were fixed at the source. No rules were disabled.

- **2026-04-16** — pre-commit hook added (husky + lint-staged).
  Runs `eslint --fix` and `prettier --write` on staged files before
  commit. Introduced after PR #20 merged 2 unformatted files that
  broke main CI in a small window.
