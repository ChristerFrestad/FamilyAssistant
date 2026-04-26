# Config-protected files — Fase 1 / Fase 2 governance

This document lists every file that the `pre:config-protection` hook
(from the `everything-claude-code` plugin, marketplace v1.9.0,
`scripts/hooks/config-protection.js`) blocks edits to by default.

## Why this list matters

During Fase 1 (now through pre-deploy, weeks 3-9 of the current
roadmap), the `pre:config-protection` hook is **disabled** via the
`ECC_DISABLED_HOOKS=pre:config-protection` environment variable. This
removes the automated guard that would otherwise stop the agent from
modifying these files.

In return, the project commits to a set of **compensating controls**
(see `CLAUDE.md` DEL 7.9) so that human-visible governance replaces
the automated block:

1. Every edit to a file in this list requires explicit justification
   in the commit message body.
2. Every edit is logged in `ops/logs/config-changes/config-audit-log.md`
   with the authorizing prompt and a short description.
3. Before the **first** edit to any file on this list, the agent must
   STOP and report to Christer to confirm the change is intentional.
   Subsequent edits to the same file inside the same authorization
   scope can proceed without a fresh stop.

In Fase 2 (pre-deploy, weeks 10-11), the hook is reactivated with a
codeword-based one-shot bypass mechanism. See
`docs/workflow/pre-deploy-cleanup-plan.md` § "Config-protection
reactivation".

## The protected file set

Match is on `path.basename(filePath)` — exact filename match,
location-independent. Editing any file with one of these basenames
triggers the block when the hook is active.

### ESLint (legacy + v9 flat config, JS/TS/MJS/CJS)

- `.eslintrc`
- `.eslintrc.js`
- `.eslintrc.cjs`
- `.eslintrc.json`
- `.eslintrc.yml`
- `.eslintrc.yaml`
- `eslint.config.js`
- `eslint.config.mjs`
- `eslint.config.cjs`
- `eslint.config.ts`
- `eslint.config.mts`
- `eslint.config.cts`

### Prettier (all config variants including ESM)

- `.prettierrc`
- `.prettierrc.js`
- `.prettierrc.cjs`
- `.prettierrc.json`
- `.prettierrc.yml`
- `.prettierrc.yaml`
- `prettier.config.js`
- `prettier.config.cjs`
- `prettier.config.mjs`

### Biome

- `biome.json`
- `biome.jsonc`

### Ruff (Python)

- `.ruff.toml`
- `ruff.toml`

> **Note from upstream config-protection.js:** `pyproject.toml` is
> intentionally **not** included. It mixes project metadata with
> linter config, and blocking it would prevent legitimate dependency
> changes.

### Shell / Style / Markdown

- `.shellcheckrc`
- `.stylelintrc`
- `.stylelintrc.json`
- `.stylelintrc.yml`
- `.markdownlint.json`
- `.markdownlint.yaml`
- `.markdownlintrc`

## Files that are NOT on this list

The following frequently-edited config files are **not** governed by
`pre:config-protection` and may be modified normally without an audit
entry (subject to the usual CLAUDE.md commit-quality rules):

- `package.json` (for dependency updates, scripts, etc.)
- `package-lock.json`
- `tsconfig.json` and any project-specific `tsconfig.*.json`
- `vite.config.ts`
- `tailwind.config.ts`
- `postcss.config.mjs`
- `Dockerfile`, `docker-compose.yml`
- Anything under `.github/workflows/` (CI config — protected separately
  by other governance, not by this hook)

## How Fase 2 reactivation will restore protection

The Fase 2 reactivation work — scheduled for weeks 10-11 in
`docs/workflow/pre-deploy-cleanup-plan.md` — will:

1. Unset `ECC_DISABLED_HOOKS`, restoring the automated block.
2. Extend `config-protection.js` (or a shadow hook) so that a
   one-shot codeword in Christer's prompt produces a temporary grant
   that allows a single edit to one named file. The grant is consumed
   on use.
3. Audit-log all grant consumptions to a hook-managed log so the
   record continues automatically even after Fase 1's manual logging
   is no longer needed.

The recommended codeword format (`KONFIG-OK <basename>`) and grant
window (60 seconds) are documented in `pre-deploy-cleanup-plan.md` as
**recommended design**, not as locked decisions. The final shape is
chosen at implementation time.

## Source of truth

The authoritative list is the `PROTECTED_FILES` set in
`~/.claude/plugins/marketplaces/everything-claude-code/scripts/hooks/config-protection.js`,
linje 21-62. This document is a snapshot taken on 2026-04-23 from
the marketplace version installed at that point. If a future plugin
update changes the upstream list, this document must be re-synced as
part of the next config-edit-related commit.
