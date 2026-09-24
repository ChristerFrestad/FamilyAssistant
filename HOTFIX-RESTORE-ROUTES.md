# Hotfix blocked: routes.js restore needs gh push

## Status (2026-09-24 Europe/Oslo)

- **Problem:** `main@7b29080` has corrupted minified/truncated `server/routes.js` (~53KB / 1 line). Lint: Unterminated string constant. Docker image for `7b29080` is **unsafe to Portainer-deploy**.
- **This branch tip:** intentional DO-NOT-DEPLOY stub in `server/routes.js` (MCP cannot carry the ~114KB good file intact — same class of failure as #223).
- **Good file (box):** `/workspace/fa-meals-week/server/routes.js`
  - bytes: 114069
  - newlines: 3059
  - sha256 prefix: `cb47f86683487b0a`
  - `node --check` passes; contains `ensureWeek`
- **Local commit ready (not on remote):** `76fee50` — `fix(server): restore routes.js corrupted by MCP push in #223`

## Unblock (Principal)

```bash
cd /workspace/fa-meals-week
gh auth login   # or set GH_TOKEN
git fetch origin hotfix/restore-routes-js
git push --force-with-lease origin 76fee50:hotfix/restore-routes-js
```

Then verify raw URL size ~113885±500, newlines ≥3000, `node --check`, then open PR to `main`.

**Do not merge without Principal. Do not deploy 7b29080.**
