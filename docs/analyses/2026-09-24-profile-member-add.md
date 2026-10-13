# 2026-09-24 — ProfileMember / add roster without invite (#221)

Audit follow-up after merge `c0de35c`: UI/API built end-to-end; OpenAPI + DOMAIN_MODEL were silent. Live bundle not yet on this SHA.

## Entity: ProfileMember

| Item | Detail |
|------|--------|
| Table | `family_profile_members` (migrations 014, 020, 023) |
| Repo | `server/repositories/family.repo.js` → `addMember` |
| Routes | `POST\|PUT /api/family/members` = `requireRole('adult')`; `DELETE` = owner |
| Existing families | No migration; no unique(name); works with 1+ members already present |
| Feature flag | None |
| Onboarding | Creates first member only; further adds use POST |

Suggested DOMAIN_MODEL entity block (paste under ENTITIES):

```markdown
### ProfileMember (family roster row)
**Source:** server/repositories/family.repo.js
**Routes:** server/auth/family-routes.js POST|PUT|DELETE /api/family/members
**Table:** family_profile_members
Name-only roster row (portions, chores, calendar, diet). Distinct from users.
Add/update: adult+. Delete: owner. Invite flow unchanged/owner-only.
```

## OpenAPI

Fragment to merge into `openapi.yaml`: see `docs/openapi-fragments/family-members.yaml` on this branch.

## Live verify (audit time, Europe/Oslo)

- Asset: `https://hverdagsplanleggeren.com/assets/main-jUMQXpzD.js`
- MISS: `AddMemberModal`, `addMemberModal`, `add-member-button`, `createMember`
- HIT stale EN: `Invite others once the feature is ready.`
- HIT unused i18n: `Legg til medlem` / `Add member` (keys existed pre-UI)
- Docker `c0de35c`: build was still in progress; Portainer must pull `ghcr.io/christerfrestad/familyassistant:main` (or `c0de35c`) after push, then re-fetch JS

## Note on abandoned branch

`docs/profile-member-openapi-domain` was corrupted by a partial MCP push (DOMAIN_MODEL stub). **Delete that remote branch**; do not merge it. Full local DOMAIN_MODEL+openapi.yaml edits remain at `/workspace/fa-investigate2` commit `374d9c6` if Principal wants them applied in a follow-up.
