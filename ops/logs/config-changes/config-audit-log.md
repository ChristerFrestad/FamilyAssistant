# Config-protection audit log

This log tracks every edit to a file listed in
`docs/workflow/config-protected-files.md` while the
`pre:config-protection` hook is disabled (Fase 1 of the
config-protection governance model — see `AGENTS.md` DEL 7.9).

When Fase 2 lands, the hook itself will resume automatic blocking
plus codeword-based one-shot bypass with hook-managed audit logging.
This file is the human-driven equivalent for the Fase 1 window.

## Entry format

Append a new entry below the latest one. Newest entry at the bottom.
Each entry follows this template:

```markdown
### YYYY-MM-DD HH:MM (UTC offset) — <basename of edited file>

- **Commit SHA:** `<full-sha>` (or `<short-sha>` if commit is from
  the same PR/branch and the short form is unambiguous)
- **File edited:** `<repo-relative-path>` (e.g. `eslint.config.mjs`)
- **Authorizing prompt (verbatim short quote):**
  > "<the exact phrase from Christer's instruction that triggered
  > the change — under 200 characters, just enough to be searchable>"
- **Why this change was needed:** <one or two sentences explaining
  the underlying need. Not a description of the diff itself; that
  belongs in the commit body. Here we capture the reason the change
  is the right answer.>
- **What changed (one-line summary):** <e.g. "Added flat-config
  block enabling ESLint on client/**/*.{ts,tsx} with TypeScript
  parser + react-hooks rules.">
- **Reverse-change risk:** <low | medium | high — and one sentence
  on what would happen if we had to revert.>
```

## Worked example (DO NOT TREAT AS REAL ENTRY)

The block below is a synthetic example to show the expected level of
detail. It is NOT a real audit entry. Real entries start in the
"Audit entries" section.

```markdown
### 2026-04-25 14:32 (CEST) — eslint.config.mjs

- **Commit SHA:** `abcd1234`
- **File edited:** `eslint.config.mjs`
- **Authorizing prompt (verbatim short quote):**
  > "Fortsett med Fase 1b.1.5 commit 2: aktiver TypeScript ESLint på
  > client/src/."
- **Why this change was needed:** Phase 1b.1 surfaced that
  `client/src/**/*.{ts,tsx}` files are not lint-covered at all. New
  client-side code in the upcoming design-system phases must be
  lint-clean from the first commit per AGENTS.md DEL 7.7, which
  requires TypeScript-aware linting that this config block enables.
- **What changed (one-line summary):** Added flat-config block
  registering `@typescript-eslint/parser` + recommended rules and
  `eslint-plugin-react-hooks` for `client/**/*.{ts,tsx}`.
- **Reverse-change risk:** Low. Block is additive — removing it
  drops new client-side lint coverage but does not affect the
  server, scripts, tests, or sw.js blocks already in the config.
```

## Audit entries

<!-- Newest entry at the bottom. The first real entry is added when
     a protected file is first modified during Fase 1. As of file
     creation (2026-04-23) no entries exist yet. -->

### 2026-04-28 11:15 (CEST) — eslint.config.mjs

- **Commit SHA:** see `git log --grep="enable ESLint on client/src/"`
  on `feat/fase-1b-design-system`. SHA is intentionally not hard-coded
  in this entry: an audit log that lives inside the commit it
  describes cannot record the commit's own final SHA without an
  amend-cycle that shifts the SHA again. The grep above resolves
  unambiguously to one commit on this branch.
- **File edited:** `eslint.config.mjs`
- **Authorizing prompt (verbatim short quote):**
  > "Postcss-bump godkjent. Klar for Fase 1b.1.5 commit 2."
- **Why this change was needed:** Phase 1b.1 surfaced that
  `client/src/**/*.{ts,tsx}` files are not lint-covered at all because
  no `files`-pattern in `eslint.config.mjs` matched them. New
  client-side code in the upcoming design-system phases must be
  lint-clean from the first commit per `AGENTS.md` DEL 7.7, which
  requires TypeScript-aware linting that this config block enables.
- **What changed (one-line summary):** Added flat-config block
  registering `@typescript-eslint/parser` + recommended rules and
  `eslint-plugin-react-hooks` for `client/src/**/*.{ts,tsx}`, with
  `no-undef` disabled for that block (TS handles symbol resolution
  better than ESLint's core rule).
- **Reverse-change risk:** Low. The block is purely additive —
  removing it drops new client-side lint coverage but does not
  affect the server, scripts, tests, or sw.js blocks already in the
  config. The three existing `routes.js` warnings remain unchanged
  before and after.

### 2026-04-28 13:25 (CEST) — eslint.config.mjs

- **Commit SHA:** see `git log --grep="forbid app -> dev imports"`
  on `feat/fase-1b-design-system`. Same SHA-independent pattern as
  the previous entry — the audit log lives in the commit it
  describes, so any embedded SHA would shift on each amend.
- **File edited:** `eslint.config.mjs`
- **Authorizing prompt (verbatim short quote):**
  > "Commit 2 godkjent. Klar for Fase 1b.1.5 commit 3."
- **Why this change was needed:** Phase 1b.1 established the
  app/dev architectural boundary at build time via the
  `enforce-isolation` Vite plugin. Lint-level enforcement is the
  faster, in-editor counterpart — violations surface on save
  rather than on `npm run build:client`. With the design-system
  work in 1b.2 and component work in 1b.3 about to land, both
  layers should fire consistently so a developer sees the
  `app/ → dev/` mistake at the earliest possible point.
- **What changed (one-line summary):** Added a second flat-config
  block scoped to `client/src/app/**/*.{ts,tsx}` that registers
  `no-restricted-imports` with patterns `**/dev/**`, `../dev/*`,
  `./dev/*`, `*/dev/*` and a Norwegian message pointing readers
  at `client/src/dev/README.md`. Files under `client/src/dev/`
  are deliberately not in the block's scope so they remain free
  to import from `app/`.
- **Reverse-change risk:** Low. The block is additive and only
  layers a stricter rule on a narrower file scope. Removing it
  loses the lint-time check; the Vite plugin still catches the
  same violation at build time. Verified via probe-file test:
  ESLint flagged `'../dev/whatever'` import from
  `client/src/app/__isolation_probe.ts` with the configured
  message; a control probe in `client/src/dev/` importing from
  `../app/App` produced zero ESLint output. Probes were deleted
  immediately after verification (the `__isolation_probe.ts`
  filename is gitignored from Phase 1b.1 as a safety net).

### 2026-05-04 09:30 (CEST) — eslint.config.mjs

- **Commit SHA:** see `git log --grep="exclude built bundle"` on
  `chore/eslint-config-public-bundle`. SHA-independent pattern as
  in earlier entries.
- **File edited:** `eslint.config.mjs`
- **Authorizing prompt (verbatim short quote):**
  > "PR A1: ESLint config fix... Legg til public/v2/** i
  > eslint.config.mjs ignores"
- **Why this change was needed:** `npm run lint` produced 342
  problems (341 errors, 1 warning). 326 errors came from the
  Vite-built bundle `public/v2/assets/main-Dx0p-2Q5.js` (browser
  globals like `window`, `document`, `fetch` flagged as undefined
  because the file matches no `files`-block and falls back to
  default `js.configs.recommended`). The remaining ~15 false
  positives came from Christer's transient root-level diagnostic
  scripts `db-check.js` and `db-pantry-check.js` (CommonJS
  globals `require`, `console` flagged for the same reason).
  Both categories are noise — the bundle is generated output and
  the diagnostic scripts are ad-hoc tools that change between
  sessions. Drowning the developer in 341 false positives
  obscures the single real warning in `ErrorBoundary.tsx`.
- **What changed (one-line summary):** Added two glob entries to
  the existing top-level `ignores` array in `eslint.config.mjs`:
  `public/v2/**` (covers the entire built v2 bundle, hash-stable)
  and `db-*.js` (covers root-level diagnostic scripts now and in
  the future).
- **Reverse-change risk:** Low. The change is purely additive to
  the `ignores` array — it removes lint coverage from generated
  bundle output and ad-hoc diagnostic scripts that should not
  have been linted in the first place. No `files`-blocks are
  changed, so all real source code (`server/**`, `scripts/**`,
  `tests/**`, `client/src/**`, `public/sw.js`) continues to be
  linted exactly as before. Reverting is one-line; no follow-on
  cleanup needed.
