# Contributing to FamilyAssistant

Thanks for considering a contribution. This is a personal, self-hosted
household system written to run locally on a Raspberry Pi 5, but I'm
happy to receive tidy contributions from others.

Issues and PR descriptions in English are preferred so they're accessible
to the broader contributor community.

---

## Quick Summary

1. Open an [issue](https://github.com/ChristerFrestad/FamilyAssistant/issues)
   first if you're planning a larger change — that way we can clarify
   scope before you spend time on the code.
2. Create a branch (see [Branch Naming](#branch-naming)).
3. Do the work. Run `npm run ci` before commit.
4. Open a PR against `main`. CI runs all gates automatically.
5. I review. Once everything is green and we agree, the PR is squash-merged.

---

## Reporting Bugs

Use [GitHub Issues](https://github.com/ChristerFrestad/FamilyAssistant/issues)
and include:

- A short description of the problem
- How to reproduce (step by step)
- Expected vs. actual behavior
- Node version (`node --version`), OS, whether it's Docker/bare-metal
- Relevant log excerpts from `~/.familieassistenten/logs/` or Docker logs

If you've found a **security vulnerability**, do not open a public issue
— see [SECURITY.md](SECURITY.md) for how to report privately.

---

## Suggesting Features

Open an issue with the `enhancement` label and describe:

- The user problem you're solving (not just the solution)
- Why this fits the app's scope (local, family-focused, simple operation)
- Alternatives you've considered

I'm conservative with new features. The app should remain easy to operate
on a Raspberry Pi by a family without an IT background. Features that
require external dependencies, cloud accounts, or significant complexity
are typically rejected.

---

## Development Setup

See [CI.md](CI.md) for the full description. Short version:

```bash
git clone https://github.com/ChristerFrestad/FamilyAssistant.git
cd FamilyAssistant
npm ci                        # not 'npm install'
npm run ci                    # verify everything is green locally
```

Node 20.x or 22.x. SQLite support via `better-sqlite3` (native binding
built by `npm ci`) or `sql.js` as a fallback.

---

## Branch Naming

Use a prefix that matches Conventional Commits (see the next section):

| Prefix | Use |
|---|---|
| `feat/` | New functionality |
| `fix/` | Bug fix |
| `chore/` | Maintenance, not user-facing (build, CI, deps) |
| `docs/` | Documentation-only changes |
| `refactor/` | Structural changes without behavior change |
| `test/` | Test additions/changes only |
| `ci/` | CI/CD config changes |
| `deps/` | Dependency upgrades (Dependabot uses this) |

Example: `feat/weekly-menu-export`, `fix/pantry-unit-conversion`,
`chore/prettier-config`.

---

## Commit Messages (Conventional Commits)

The project follows [Conventional Commits 1.0](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`,
`perf`, `style`, `deps`.

**Rules:**

- Subject in imperative, lowercase, no period: `add X`, `fix Y`, not
  `Added X.`
- Max 72 chars in subject, 100 chars per line in body
- Body explains **why**, not **what** (the diff shows what)
- Reference issues with `Refs #42` or `Closes #42` in the footer

**Example (from history):**

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

## Code Conventions

- **ESLint flat config** (`eslint.config.mjs`) — 0 errors allowed
- **Prettier** (`.prettierrc.json`) — 100 chars, single quotes, trailing
  commas (ES5)
- **TypeScript in JSDoc** — opt-in via `// @ts-check` at the top of files.
  See `docs/TYPE_COVERAGE.md`
- **Tests** — `node --test` (no Jest/Mocha). All new features must have
  tests. The coverage gate must pass
- **Comments** — English in new code; Norwegian in older files is accepted
  for now

Run `npm run lint:fix && npm run format:fix` before commit.

---

## Frontend Structure: `app/` vs `dev/`

The v2 frontend (React redesign under `client/`) has a hard boundary
between production code and dev-only tools. The rule is simple:

- Everything under `client/src/app/` (and `client/src/main.tsx`, which is
  the entry point for the production app) is **production code** and
  ends up in the bundle.
- Everything under `client/src/dev/` is **developer tooling** — component
  galleries, debug panels, preview pages, experiments — and never ends
  up in production.
- **Production code CANNOT import from `dev/`.** Dev code may import
  freely from `app/` (a preview page for `Button` should of course use
  the real `Button` component).

The boundary is enforced mechanically:

- `client/vite-plugins/enforce-isolation.ts` catches any `app → dev`
  import attempt and crashes the build with a clear error message that
  names both the importer and the target. The plugin runs in both
  `npm run dev:client` and `npm run build:client`.
- `tests/client-dev-isolation.test.js` proves the plugin works by running
  a real Vite build against a probe that breaks the boundary (expects
  failure) and one that doesn't (expects success). The test runs as part
  of `npm test`.

If you find yourself in a situation where code in `dev/` would be useful
in production, move it to `client/src/app/lib/` first — and then import
it from both places. Don't reach across the boundary.

See also `client/src/dev/README.md` for details and CLAUDE.md section 7.7
for the broader rule about technical debt that this boundary is one
manifestation of.

---

## Test Requirements

All PRs must pass:

| Gate | Threshold |
|---|---|
| `npm run lint` | 0 errors |
| `npm run format` | 0 mismatches |
| `npm run typecheck` | 0 errors |
| `npm test` | 100 % |
| Coverage | 80 % lines, 68 % branches, 72 % functions |
| `npm audit --omit=dev` | 0 high+ |
| OSV-scan | 0 high+/critical |

CI runs everything on Linux/macOS/Windows × Node 20/22.

---

## Pull Request Process

1. **Rebase on main** before opening a PR:
   ```bash
   git fetch origin && git rebase origin/main
   ```
2. Push your branch: `git push -u origin <branch-name>`
3. Open a PR against `main`
4. Describe the **why** in the PR body, link to issue if relevant
5. Wait for green CI (all 6 jobs)
6. Wait for review from [CODEOWNERS](.github/CODEOWNERS)
7. Address review comments by pushing new commits (don't force-push while
   review is in progress — it makes it hard to see what's changed since
   the previous round)
8. Once approved, the PR is squash-merged into main

**What I look for as a reviewer:**

- Does the PR solve what it claims to?
- Is scope focused? (no unsuggested refactorings on the side)
- Tests that verify the new behavior
- No regressions in existing tests
- Documentation updated (CHANGELOG, relevant `*.md`)
- No sensitive data (API keys, personal information, private paths)

---

## License and Origin

By contributing, you agree that your code is released under the project's
MIT license (see the `license` field in `package.json`). You also declare
that:

- You hold the copyright to what you contribute, or
- The contribution is under a compatible license and you have the right
  to submit it

There is no formal CLA. No `Signed-off-by` line is required, but you're
welcome to use `git commit -s` if you prefer DCO style.

---

## Code Attribution

All code merged to `main` shall have the contributor themselves as the
git author. Don't create commits where other people, tools, or AI
assistants appear as (co-)author unless they actually wrote the code
independently.

This also applies to footers in commit messages: don't paste in
tool-generated tracking URLs or "Generated with X" notes.

---

## Security

Vulnerabilities are reported privately, not as an issue. See
[SECURITY.md](SECURITY.md).

---

## Questions

If something is unclear, open an issue with the `question` label or
leave a comment on an existing PR.

---

## For Maintainers

This section is for the repo owner and others with admin access.

### Branch Protection on `main`

Configure via the GitHub UI: **Settings → Branches → Add branch ruleset**
(or **Branch protection rules** on older repos). Recommended configuration:

- **Branch name pattern:** `main`
- ☑ **Require a pull request before merging**
  - ☑ Require approvals: **1**
  - ☑ Dismiss stale pull request approvals when new commits are pushed
  - ☑ Require review from Code Owners
- ☑ **Require status checks to pass before merging**
  - ☑ Require branches to be up to date before merging
  - **Required checks** (all must exist in `ci.yml` first):
    - `Test (Node 20.x, ubuntu-latest)`
    - `Test (Node 22.x, ubuntu-latest)`
    - `Test (Node 20.x, macos-latest)`
    - `Test (Node 20.x, windows-latest)`
    - `Coverage gate`
    - `Security audit`
    - `SBOM generation`
    - `OSV vulnerability scan`
- ☑ **Require conversation resolution before merging**
- ☑ **Require signed commits** (optional, but recommended)
- ☑ **Require linear history** (fits the squash-merge policy)
- ☑ **Do not allow bypassing the above settings** (applies to admins too —
  only turn off if you have a genuine emergency)
- ☐ Allow force pushes — **leave this off**
- ☐ Allow deletions — **leave this off**

### Squash-merge as Default

**Settings → General → Pull Requests:**

- ☑ Allow squash merging (default commit = PR title + body)
- ☐ Allow merge commits
- ☐ Allow rebase merging
- ☑ Always suggest updating pull request branches
- ☑ Automatically delete head branches

### Dependabot Auto-merge (optional)

For dev-dep minor/patch bumps you can enable auto-merge once all gates
are green — see `.github/dependabot.yml`, which already groups them.

### Signed Tagging

Release tags (`v1.3.0` etc.) should be GPG-signed. Configure with
`git config --global commit.gpgsign true` and confirm in your local git
setup.
