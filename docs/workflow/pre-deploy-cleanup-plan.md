# Pre-deploy cleanup plan

**Status:** planned (not yet executed)
**Timing:** after Phase 1 and Phase 2 are complete, before the public
deploy phase. Realistic window: week 9-10 of the current roadmap.
**Estimate:** 3-5 focused days of cleanup work.
**Owner:** the agent running the cleanup session, with Christer
approving the final sweep.

---

## 1. Purpose

Between now and the public deploy the codebase will accumulate a mix
of legacy styling choices (Norwegian comments inherited from the
pre-redesign era), small amounts of dead code, unused endpoints,
artifact files left behind by previous iterations, and other accrued
technical debt. Trying to clean this continuously while also delivering
new features slows both streams down. Instead we collect the cleanup
into a single concentrated session that happens once, close to
deploy, with the full codebase in front of us.

The goal of this plan is to make that session possible by
(1) documenting the scope while it is fresh in mind, and (2)
preventing new debt from being added while Phase 1-2 work is
underway.

---

## 2. Language standard going forward: English US

From the point this document lands, **all new code, comments, commit
messages, PR descriptions, test names, and file names are written in
English using US spelling**. This matches the existing rule in
`CLAUDE.md` DEL 7.1.

- Spelling: `color` (not `colour`), `behavior` (not `behaviour`),
  `organize` (not `organise`), `canceled` (not `cancelled`),
  `traveled` (not `travelled`), `license` (noun and verb, not
  `licence`).
- Comments and identifiers: always English.
- UI-facing strings: Norwegian (bokmål) for now, Norwegian + English
  when i18n lands in Phase 1c.
- Product communication with Christer (AGENT_LOG, PR bodies, analyses,
  stop-messages): Norwegian (bokmål).

**In-flight files:** if the agent already has a Norwegian-commented
file open for an unrelated reason during Phase 1-2, it is acceptable
to translate the surrounding comments as part of the same commit.
Not required.

**Not in-flight files:** do NOT go around converting Norwegian
comments to English during Phase 1-2. That is exactly what the
deferred cleanup session is for. Drive-by rewrites hide the real
size of the cleanup and pollute feature PRs.

---

## 3. Current-phase rule: new code is clean from start

While Phase 1-2 are underway, new code must not introduce new debt.
Concretely, new code written from this point forward must satisfy
all of the following without exception:

- **English US comments** throughout the new file.
- **No dev-only markers** that leak into production: no `TODO` without
  an issue reference, no `FIXME`, no `XXX`, no `// eslint-disable` without
  an explanatory comment, no `console.log` (use `server/logger.js`),
  no stub functions that "throw new Error('not implemented')" left in.
- **No hardcoded test data** in non-test code. Seed data lives in
  `server/seed.js` or migrations, not in production services. Test
  fixtures live under `tests/`, not in `server/` or `client/`.
- **Lint-clean from start**: the new file passes `npm run lint` with
  zero new warnings (the existing three `routes.js` warnings are
  tracked; no new additions to that count).
- **Type-clean from start**: `npm run typecheck` and
  `npm run typecheck:client` must pass before the commit that adds
  the new file lands.
- **No dead-code paths**: if a branch is written, at least one test
  covers it. If there is no test, the branch should not exist.

If new code accidentally violates this rule, fix it in the same
session — do not defer to the cleanup sweep. The sweep is for pre-
existing debt only.

---

## 4. Cleanup session scope

When the session runs (week 9-10), the work is organized into these
lanes. Each lane is independent enough that different days can focus
on different lanes.

### 4.1 Language consistency

- `server/` — scan for Norwegian comments, translate to English US.
- `scripts/` — same.
- `tests/` — describe-blocks, test titles, and inline comments to
  English. Be careful: some test strings assert against Norwegian
  UI copy. Those stay Norwegian.
- `public/js/` — if any legacy files are still around at that point,
  same treatment. Note that `public/` may be largely obsolete by
  this point if the v2 frontend has taken over.
- Commit messages in the backlog: no retroactive rewrite. Only new
  ones.

**Detection tooling:** `grep -rIE '[æøåÆØÅ]' server/ scripts/ tests/`
catches most Norwegian content. Cross-check with spot reading to
avoid false positives from legitimate data strings.

### 4.2 Dead code

- Run `npx knip` to find unused exports and files.
- Run `npx depcheck` to find unused npm dependencies.
- Run `npx ts-prune` on the client to find unused TypeScript exports.
- Run the existing test suite to confirm no behavior relies on the
  candidates flagged by the tools above.
- Remove unused code file by file, each as its own commit so that
  revert is surgical.

### 4.3 Artifact files

Scan for files that shouldn't be in the repo:

- Editor backup files (`*~`, `*.bak`, `.DS_Store`, `Thumbs.db`).
- Old test fixtures that are no longer referenced.
- Generated files that should be in `.gitignore` instead
  (e.g. `sbom-full.json` if not already).
- Old analysis documents that are more than 6 months old and no
  longer relevant to the current architecture.
- Abandoned feature branches that were merged but left local-only
  state behind.

### 4.4 Unused endpoints

- Grep `server/routes.js` and collect all route definitions.
- Cross-reference against `public/js/` and `client/src/` fetch calls.
- Any endpoint with zero callers is a candidate for removal.
- Be conservative: some endpoints exist for admin/diagnostic use
  and are called by humans, not frontend code. These stay. Confirm
  with Christer when in doubt.

### 4.5 Technical debt

- Review all `TODO` comments still remaining. Either resolve them or
  convert them to tracked issues.
- Review all `eslint-disable` comments. Remove the ones no longer
  needed; add justification for the rest.
- Review `@ts-ignore` / `@ts-expect-error`. Same treatment.
- Consolidate duplicate patterns (e.g. two different `Toggle`
  components in the mockup became one consolidated component by
  this point — verify).

### 4.6 Test suite hygiene

- Run `npm test` and note any tests marked `.skip` or
  `// eslint-disable-next-line` around them. Either un-skip or remove.
- Review the three pre-existing `routes.js` lint warnings — decide
  to fix or document.
- Consider whether the test file naming conventions (from
  `CLAUDE.md` §7.2) are followed throughout.

---

## 5. Workflow during cleanup session

1. Branch `chore/pre-deploy-cleanup` off `main`.
2. Each lane (4.1-4.6) is one or more commits — small, reviewable.
3. Run full local CI (Tier 1+2+3) after every commit.
4. Aim for zero behavior change. Each commit's diff should be
   verifiable by inspection: comment rewording, dead-code removal,
   no logic change.
5. When a change has non-obvious behavior impact (e.g. removing an
   endpoint), extract that into its own small PR for normal review
   and keep it out of the big cleanup sweep.
6. Final PR: `chore/pre-deploy-cleanup` with a detailed body
   describing every lane that was touched, the tools that ran, and
   what was and was not changed.

---

## 6. Exit criteria (session is done)

- `grep -rIE '[æøåÆØÅ]' server/ scripts/` returns zero matches except
  for intentional Norwegian strings (UI copy, data seed values, error
  messages to end users).
- `npm test` passes with the same count as pre-session.
- `npm run lint` produces zero errors and the same or fewer warnings.
- `npm run typecheck` and `npm run typecheck:client` pass.
- `npm run test:coverage:gate` produces coverage at or above the
  existing thresholds.
- `npm audit --omit=dev --audit-level=high` returns zero
  vulnerabilities.
- `npx knip`, `npx depcheck`, `npx ts-prune` each report zero unused
  exports / dependencies / files (or each remaining item has a written
  justification in the PR body).
- The final PR passes local CI and remote CI on GitHub.
- Christer approves the merge.

---

## 7. Links

- `CLAUDE.md` DEL 7.1 and 7.7 — code quality rules this plan extends.
- `docs/workflow/local-first-adoption-2026-04.md` — context on why
  we batch work locally.
- `docs/workflow/pending-decisions.md` — backlog of decisions that
  may or may not involve cleanup work.

---

## 8. Revision log

- 2026-04-23 — initial plan drafted as part of Phase 1b.0. Language
  standard, session scope, current-phase rule, and exit criteria
  established. No execution yet.
