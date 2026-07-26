# Portainer deploy — improvement plan

Status after the 2026-07 Portainer deploy-ready work.

## Done (this batch)

| # | Item | Why | Status |
|---|------|-----|--------|
| 1 | Restore `public/setup.html` (self-contained) | Sprint 8 deleted the wizard → 404 on first boot | Done |
| 2 | Allowlist `/setup.html` in static + auth middleware | Page must load without AUTH_TOKEN | Done |
| 3 | Skip SESSION_SECRET gate in `BOOTSTRAP_MODE` | Crashloop when MAGIC_LINK_CONSOLE/Resend set pre-wizard | Done |
| 4 | Root redirect → `/setup.html` in bootstrap mode | Operators open `:7777/` not `:7777/setup.html` | Done |
| 5 | Named volume in `docker-compose.yml` | Portainer Web editor breaks on `./data` bind mounts | Done |
| 6 | `HOST_PORT` env, `mem_limit`/`cpus`, brand env passthrough | Portainer ergonomics + resource enforcement outside Swarm | Done |
| 7 | UID docs 65532 → 1000 | Image is slim+gosu, not distroless | Done |
| 8 | CI verifies `setup.html` in image | Prevent silent regression | Done |
| 9 | Tests: `tests/portainer-bootstrap.test.js` | Gate both known-issues | Done |

## Next improvements (prioritised)

### P0 — still blocking a smooth pilot for non-technical families

1. **ENCRYPTION_KEY in wizard**  
   Wizard writes `sessionSecret` but not `encryptionKey`. Google OAuth /
   stored LLM keys still need a manual env var. Generate + persist
   alongside SESSION_SECRET in `handleComplete`.

2. **Post-wizard redirect to real login**  
   After restart, `/v2/` may still show PilotPasswordGate / empty
   onboarding without clear copy. Add a one-shot "Setup complete — next:
   create your family" banner driven by `bootstrap.json.completedAt`.

3. **Public GHCR package**  
   Confirm `ghcr.io/christerfrestad/familyassistant` is public so
   Portainer can pull without a PAT. Document the Registries step if not.

### P1 — operator experience

4. **Portainer template / App template JSON**  
   Ship `.portainer/stack.json` or a Portainer App Template so deploy is
   "pick from catalog" instead of paste-compose.

5. **Healthcheck start_period tuning**  
   Cold start on RPi5 arm64 can exceed 30s under load. Raised to 45s;
   monitor pilot and raise further if needed.

6. **Backup path in named volume**  
   Document `docker run --rm -v familyassistant_data:/data …` export
   recipe for operators without SSH bind mounts.

7. **Compose profiles in Portainer**  
   Profiles are invisible in Portainer CE Web editor. Either document
   the "delete profiles key" step more loudly, or ship a second
   `docker-compose.caddy.yml` for HTTPS.

### P2 — polish

8. **v2 setup route** (`/v2/setup`) matching brand tokens from
   `/api/config` — optional; static `setup.html` is enough for zero-config.

9. **Watchtower / Diun labels** for auto-update of `:main` with
   restart-on-healthy.

10. **SBOM + cosign** on GHCR images so Portainer operators can verify
    provenance.

## Verification checklist (operator)

After deploying this branch's image:

```bash
# 1. Pull + run with empty volume
docker compose pull
docker compose down -v   # ONLY on a throwaway host
docker compose up -d

# 2. Logs show bootstrap
docker compose logs app | grep -i 'BOOTSTRAP MODE'

# 3. Wizard reachable
curl -sI http://localhost:7777/setup.html | head -1   # 200
curl -sI http://localhost:7777/ | head -1             # 302 → /setup.html

# 4. Complete wizard in browser, then:
curl -sf http://localhost:7777/health
curl -sI http://localhost:7777/ | head -1             # 302 → /v2/
```

## References

- `DEPLOY.md` §16
- `docs/runbooks/deploy-portainer.md`
- `docs/known-issues/setup-html-missing-after-sprint-8-cleanup.md`
- `docs/known-issues/portainer-session-secret-deploy-gate.md`
