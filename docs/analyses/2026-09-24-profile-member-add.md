# 2026-09-24 — ProfileMember / add roster without invite (#221)

Audit follow-up: document the entity and API that #221 wired in the UI.

## Entity: ProfileMember
- Table: `family_profile_members` (migrations 014, 020, 023)
- Repo: `server/repositories/family.repo.js` → `addMember`
- Routes: `POST|PUT /api/family/members` requireRole(`adult`); `DELETE` owner-only
- No unique(name) constraint; works for existing families with 1+ members; no migration; no feature flag
- Onboarding creates the first member only; further adds use POST

## OpenAPI (to merge into openapi.yaml)
```yaml
  /api/family/members:
    post:
      summary: Add a name-only roster member (no invite/email)
      # requireRole adult; body: name, category?, portionFactor?
      # response: { ok, member: ProfileMember }
  /api/family/members/{id}:
    put: # adult
    delete: # owner
```

## DOMAIN_MODEL
Add entity section **ProfileMember** (full text in local commit `374d9c6`
on `/workspace/fa-investigate2` branch `docs/profile-member-openapi-domain`).

## Live deploy note
main HEAD `c0de35c` has UI; live bundle `main-jUMQXpzD.js` still lacks
AddMemberModal and still has stale EN hint
"Invite others once the feature is ready." Docker image for c0de35c may
still be building; Portainer pull required after GHCR `:main` / `:<sha>` push.
