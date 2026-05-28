# CI / CD Pipeline Reference

**Status:** Stable. Full pipeline established pre-pilot.

## Workflows

### `.github/workflows/ci.yml` — Test + lint + audit

**Triggers:**
- `pull_request` to main → minimal PR gate (Linux Node 20 only)
- `push` to main → full cross-platform matrix (4 combos)
- `schedule` Sunday 02:00 UTC → OSV vulnerability scan + SBOM generation

**Jobs:**
- `Test (Node 20.x, ubuntu-latest)` — required PR check; lint + typecheck + tests + coverage gate
- `Test (Node 20.x, macos-latest)` / `windows-latest` / `Test (Node 22.x, ubuntu-latest)` — main-push only
- `Coverage gate` — always (lines ≥ 80%, branches ≥ 68%, functions ≥ 72%)
- `Security audit` — always (`npm audit --omit=dev --audit-level=high`)
- `SBOM generation` — main-push + schedule
- `OSV vulnerability scan` — main-push + schedule

Pipeline policy + cost-reduction rationale: see AGENTS.md DEL 5.2.

### `.github/workflows/docker.yml` — Image build + GHCR push

**Triggers:**
- `push` to main (when Dockerfile, server/, public/, package.json, or workflow itself changes) → `:main` + `:sha-XXXX`
- `tag v*` → `:1.3.0` + `:1.3` + `:latest`
- `pull_request` (Dockerfile/.dockerignore/package.json) → build only, no push (validation)
- `workflow_dispatch` → manual build (operator-initiated)

**Output:** Multi-arch image (`linux/amd64` + `linux/arm64`) at `ghcr.io/christerfrestad/familyassistant:<tag>`.

**Cache:** GHA cache keyed by `familyassistant` scope.

**Provenance + SBOM:** Both attached to the image.

## How to trigger a manual build

```
GitHub repo → Actions → Docker → Run workflow → main → Run
```

Or via gh CLI:
```bash
gh workflow run docker.yml --ref main
```

## How to roll back to a previous image

Each push to main produces:
- `:main` (mutable, latest commit)
- `:sha-<short>` (immutable, specific commit)

To roll back the production stack to a known-good build:

1. Find the desired SHA in `Actions → Docker → <run>` summary or in `git log`:
   ```bash
   git log --oneline -10
   ```

2. In Portainer → Stacks → familieassistenten → Editor:
   ```yaml
   image: ghcr.io/christerfrestad/familyassistant:sha-<short>
   ```

3. Click **Update the stack** → Portainer pulls the immutable tag.

4. Verify with curl:
   ```bash
   curl https://app.familyassistant.com/health
   ```

5. After incident is understood and a forward-fix lands, update the
   stack back to `:main` (or `${TAG:-main}`).

## Tag releases (semver)

Christer creates an annotated tag locally:
```bash
git tag -a v1.4.0 -m "v1.4.0 — pilot release"
git push origin v1.4.0
```

The Docker workflow then publishes:
- `ghcr.io/christerfrestad/familyassistant:1.4.0`
- `ghcr.io/christerfrestad/familyassistant:1.4`
- `ghcr.io/christerfrestad/familyassistant:latest`

`:latest` only exists on tag-pushes — not on every commit. Production
stacks should pin to `:main` (auto-updates) or `:sha-XXXX`/`:1.4.0`
(immutable).

## Branch-protection requirements

Required status checks on PR merge:
- `Test (Node 20.x, ubuntu-latest)`
- `Coverage gate`
- `Security audit`

Optional (informational on PR, blocking on main-push):
- `Test (Node 20.x, macos-latest)`
- `Test (Node 20.x, windows-latest)`
- `Test (Node 22.x, ubuntu-latest)`
- `SBOM generation`
- `OSV vulnerability scan`

## Local-first workflow reminder

Per AGENTS.md DEL 5.2: developers run full lint + tests locally before
pushing. CI is a backstop, not a substitute for local verification.
Push only when local CI is green and Christer says "push".
