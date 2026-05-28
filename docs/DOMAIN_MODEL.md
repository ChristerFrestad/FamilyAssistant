# DOMAIN_MODEL.md – Domain model and business rules

> This document is the system's collective understanding of itself.
> Claude reads it before every task and updates it when the domain
> expands or changes. If this file and the code are in conflict:
> STOP and notify Christer. One of them is wrong.

> This document is **intentionally started empty**. The project already
> has 22 services and rich domain understanding in the code – backfilling
> everything here would be a multi-week task on par with the ISO lift.
> Instead, the document grows as Claude touches domain areas, one task
> at a time.

---

## HOW TO READ THIS DOCUMENT

Until an entity, rule, or edge case is documented here, code truth in
`server/services/*.service.js` and `server/repositories.js` is the
authoritative source. When Claude works on a new task:

1. Check whether affected entities/rules exist here
2. If yes: use as reference, update if changed
3. If no: when the task is complete, document what was established
   or discovered during the work

---

## ENTITIES

> Each entity describes: fields, relationships, rules, lifecycle.
> Short and concrete. The code is the truth; this is the explanation.

*(No entities documented yet. Grows organically.)*

### Format to follow when adding an entity

````markdown
### <EntityName>

**Source file:** `server/services/<name>.service.js`
**Repository:** `repos.<entity>` in `server/repositories.js`
**Table:** `<table_name>` (migration `server/migrations/<NNN>_*.sql`)

**What it is:** 2–3 sentences explaining what the entity represents
in the family/household.

**Fields:**
- `id` – PK
- `<field>` (type) – brief explanation
- `created_at`, `updated_at`

**Relationships:**
- 1 ↔ N with <OtherEntity>
- ...

**Rules:**
- <rule 1>
- <rule 2>
- Reference BR-N if the rule is documented in business rules

**Lifecycle:**
<How the entity is created, modified, and removed.>

**Covered by tests:**
- `tests/<file>.test.js`
````

---

## BUSINESS RULES

> Rules that cut across multiple entities. Numbered for reference
> from code and tests. Format: BR-<number> (Business Rule).

### BR-INVITE-1: Pre-validation on invitation creation

**What:** When an owner creates an invitation with an email address,
the server rejects with 409 if the email is already a member
(`EMAIL_ALREADY_MEMBER`) or already has an active pending
invitation (`EMAIL_ALREADY_INVITED`) in the same family.

**Why:** Prevents users from being bombarded with duplicate
invitations and prevents the invitation list from growing with
"ghost" rows. The check is family-scoped so the same email can be
invited to multiple families simultaneously (DEL 14 cross-tenant
isolation).

**Detailed Flow:**
1. Client sends POST `/api/family/invitations` with email + role +
   message + locale
2. Server normalizes email: `trim().toLowerCase()`
3. `findExistingMemberByEmail(familyId, email)` (case-insensitive
   match against `users.email` for `family_id = ?` and `deleted_at IS NULL`)
4. If hit → 409 `{code: 'EMAIL_ALREADY_MEMBER'}`
5. `findActiveInvitationByEmail(familyId, email)` (against
   `family_invitations` with `accepted_at IS NULL AND revoked_at IS
   NULL AND expires_at > now`)
6. If hit → 409 `{code: 'EMAIL_ALREADY_INVITED'}`
7. Otherwise: insert + send email

**Affected files:**
- `server/auth/family-routes.js` (`handleCreateInvitation`)
- `server/repositories/family.repo.js`
  (`findExistingMemberByEmail`, `findActiveInvitationByEmail`)
- `tests/family-invitation-prevalidation.test.js`

**Documented:** 2026-05-05, PR #119

### BR-INVITE-2: Resend rotates the token and invalidates the old one

**What:** Resend generates a new `token` value and updates
`expires_at` to now + 7 days. The old token value is deleted, so
the old `/v2/invite/<oldToken>` link stops working immediately.

**Why:** Standard SaaS pattern. If the original email leaks or the
invitation link is compromised, resend produces a new rotated
token without creating a duplicate row. invited_email,
invitation_message, and locale are inherited from the original
row — the owner's intent is "send the same invitation again", not
"change it".

**Detailed Flow:**
1. Owner clicks "Resend" on the pending list
2. Client POSTs `/api/family/invitations/:id/resend`
3. Server validates family_id match and pending state
4. `randomToken(32)` → new token
5. UPDATE `family_invitations` SET token = ?, expires_at = ?
   WHERE id = ? AND family_id = ? AND accepted_at IS NULL AND
   revoked_at IS NULL
6. Email is sent again with new URL and same message/locale
7. Old token returns null from `findInvitationByToken` → clicking
   the old link gives STATE 5 NOT_FOUND

**Affected files:**
- `server/auth/family-routes.js` (`handleResendInvitation`)
- `server/repositories/family.repo.js` (`resendInvitation`)
- `tests/family-invitation-resend.test.js`

**Documented:** 2026-05-05, PR #119

### BR-INVITE-3: An invitation owns its own locale + personal message

**What:** Each `family_invitations` row stores `locale`
(`'no' | 'en'`, NOT NULL DEFAULT 'no') and an optional
`invitation_message` (TEXT, max 500 characters). Email rendering
uses these fields directly — without depending on the inviter's or
recipient's current language preference.

**Why:** Resend must be able to send the email in the same language
as the first time. `users.preferred_language` does not exist (out
of scope for pilot), so the invitation itself must own the locale
choice.

**Detailed Flow:**
1. Frontend reads `i18n.language` at create time
2. Client POSTs body `{email, role, invitationMessage, locale}`
3. Backend Zod-style validation: locale ∈ {'no','en'}, message ≤ 500
4. Server INSERT — locale + message persisted on the row
5. Email rendering picks template `invitation-{locale}.html` +
   `.txt`, substitutes `{{INVITATION_MESSAGE_BLOCK}}` (HTML-escaped
   blockquote or plain-text quote)
6. Resend reads the same fields — no re-fetch of user preferences

**Affected files:**
- `server/migrations/029_invitation_message_locale.sql`
- `server/repositories/family.repo.js` (`createInvitation`)
- `server/services/email.service.js` (`renderInvitationTemplate`,
  `sendInvitationEmail`)
- `server/email/templates/invitation-{no,en}.{html,txt}`
- `tests/family-invitation-message.test.js`,
  `tests/email-invitation-locale.test.js`

**Documented:** 2026-05-05, PR #119

### BR-INVITE-4: Invitation tokens are SHA-256 hashed at rest

**What:** `family_invitations.token_hash` stores `SHA-256(plainToken)`,
not the plain token. The plain token is generated by the create
and resend handlers, returned one-shot in the API response (and
emailed if Resend is configured), and never read back from the
database. Mirrors the magic-link pattern (`magic_link_tokens.token_hash`,
migration 022).

**Why:** Operator-level DB read access used to enable token replay
within the 7-day TTL (`SELECT token FROM family_invitations WHERE
expires_at > datetime('now')` → POST that token to
`/api/invitations/<token>/accept`). Hashing closes that window: an
attacker with DB read access sees only digests, which cannot be
reversed and cannot be replayed against the accept endpoint
(passing the hash itself re-hashes and misses). The Christer-pilot
threat model already trusted the operator; the change matters the
day the DB file lands somewhere less trusted (backup leak, support
copy, or a second family deploying the codebase on their own host).

**Detailed Flow:**
1. Client POSTs to `/api/family/invitations`
2. Route generates a 256-bit random plain token via
   `randomToken(32)`
3. Route calls `repos.family.createInvitation({token, ...})`
4. Repo hashes the plain token (`sha256(plain)`) and INSERTs the
   digest into `token_hash`
5. Repo SELECTs the row back by `token_hash` and returns it. The
   returned row has `token_hash`, not `token` — the route does not
   read this field
6. Route returns the plain token + the share-URL in the response,
   typed as `InvitationWithSecret` (one-shot delivery)
7. Email service uses the plain token to build the magic-link URL
   in the outgoing email
8. Accept-handler receives the plain token on path,
   `repos.family.findInvitationByToken(plain)` hashes it again, and
   looks up by `token_hash = ?`
9. The listing endpoint (`GET /api/family/invitations`) returns the
   `Invitation` shape WITHOUT `token` or `url` — they are
   irrecoverable after creation

**Affected files:**
- `server/migrations/030_invitation_token_hash.sql`
- `server/repositories/family.repo.js` (`createInvitation`,
  `findInvitationByToken`, `resendInvitation`, `hashInvitationToken`
  helper)
- `server/auth/family-routes.js` (`handleListInvitations` drops
  `token`/`url` from response)
- `client/src/app/family/familyInvitationsApi.ts` (`Invitation` type
  split into base + `InvitationWithSecret`)
- `tests/family-invitation-token-hash.test.js`
- Migration follows the same DELETE-then-RENAME idiom as migration
  022; in-flight invitations at deploy-time become unusable and the
  owner has to re-send.

**Documented:** 2026-05-28, issue #120

### BR-BRAND-1: Brand config comes only from env variables

**What:** Each white-label instance (Husby,
FamilyAssistant, and future ones) gets brand config (app name,
wordmark split, favicon letter, tagline, primary/accent/dot colors)
from eight env variables. No hardcoded app names, taglines, or
colors exist in React components, HTML, or email templates.

**Why:** The same Docker image must be able to serve all brands
without rebuild. The build-time mechanism (`VITE_APP_NAME`) used
from Sprint 2.5 to Sprint 9 broke this promise — the `:main` image
had a built-in `appName` that could not be overridden at deploy
time. Sprint 10 (PR #122) replaced the build-time mechanism with
`GET /api/config`, which the client fetches at app mount.

**Detailed Flow:**
1. Operator sets `APP_NAME`, `APP_NAME_PRIMARY`, `APP_NAME_ACCENT`,
   `APP_FAVICON_LETTER`, `APP_TAGLINE`, `APP_PRIMARY_COLOR`,
   `APP_ACCENT_COLOR`, `APP_DOT_COLOR` in the Portainer stack
2. `server/config.js` Zod-validates at startup; defaults reflect
   FamilyAssistant
3. `server/index.js` logs the active brand at boot via pino +
   any cross-validation warnings
4. `server/http/branding.js` exposes non-sensitive fields via
   `GET /api/config` (cache 1 h)
5. Client fetches `/api/config` in `client/src/main.tsx` before React mount
6. `applyBrandTokens(config)` injects CSS tokens on `:root`;
   `i18n.addResource('common.appName', ...)` drives the existing
   `{{appName}}` interpolation
7. `Wordmark` + email templates read from config — no hardcoding

**Affected files:**
- `server/config.js` (envSchema, collectBrandWarnings)
- `server/http/branding.js` (`/api/config`, `/favicon.svg`,
  `/logo-mark.svg`, `/manifest.json`)
- `client/src/app/hooks/useBrandConfig.ts`
- `client/src/main.tsx` (early fetch + side effects)
- `tests/brand-config-validation.test.js`,
  `tests/branding-routes.test.js`

**Documented:** 2026-05-05, PR #122

### BR-BRAND-2: Wordmark is two-part with color split

**What:** The app name is always rendered as two concatenated
segments (`APP_NAME_PRIMARY` + `APP_NAME_ACCENT`) where each
segment has its own color — primary and accent. The color split
marks a conceptual two-part structure in the name (compound word
in Norwegian, two-word name in English). The
`<Wordmark size="..." />` component is used everywhere the app
name should be shown as a logo. Plain text contexts (browser
title, meta tags, email subject) use `config.appName` directly.

**Why:** A visual signature that is recognizable across brand
instances without requiring graphical illustration. Each instance
shares the same structural DNA but has its own words and colors
via env.

**Detailed Flow:**
1. `Wordmark` reads `useBrandConfig().config.{namePrimary, nameAccent}`
2. While config is null (cold load): renders a width-reserved invisible
   placeholder. Better empty for ~200 ms than wrong brand for 200 ms —
   no `'FamilyAssistant'` fallback during cold load
3. When config arrives: `<span style="color:primary">{namePrimary}</span><span style="color:accent">{nameAccent}</span>`
4. `aria-label` is set to the concatenation so screen-readers read
   "Husby" as one word

**Affected files:**
- `client/src/app/components/brand/Wordmark.tsx`
- `client/src/app/hooks/useBrandConfig.ts`
- `client/src/app/components/layout/AppShell.tsx` (header)
- `client/src/app/components/brand/Wordmark.test.tsx`,
  `client/src/app/hooks/useBrandConfig.test.ts`

**Documented:** 2026-05-05, PR #122

### BR-BRAND-3: Favicon = one letter in a dark-green container

**What:** The favicon is one letter (`APP_FAVICON_LETTER`) in the
same typography as the wordmark, placed on a dark-green rounded-rect
container (`#1F3F26` default) with a small sage-green dot
(`#7BA05B` default) in the upper right corner. The letter is the
first character in `APP_NAME_PRIMARY`. Rendered dynamically from
`server/branding/templates/favicon.template.svg` on request to
`GET /favicon.svg`.

**Why:** A symbol that is recognizable on the tab bar without being
tied to a specific app function (calendar, check, food). The same
container formula works for each brand — only the letter and
optionally the colors change. SVG-only until PNG derivatives
(sharp) are picked up as tech debt before external pilot.

**Detailed Flow:**
1. `client/index.html` has `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
2. Browser fetches `/favicon.svg`
3. `server/http/branding.js` reads cached template + substitutes
   `{{LETTER}}` (sanitized to a-zA-Z) and `{{APP_NAME}}` (XML-escaped)
4. Server returns `image/svg+xml` with `Cache-Control: public,
   max-age=3600, immutable`
5. The same template in larger format is used for `/logo-mark.svg`
   (PWA install icon, post-pilot OG image)

**Affected files:**
- `server/branding/templates/favicon.template.svg`
- `server/branding/templates/logo-mark.template.svg`
- `server/http/branding.js`
- `tests/branding-routes.test.js`

**Documented:** 2026-05-05, PR #122

### BR-BRAND-4: PNG raster derivatives are rendered on demand and cached per brand-snapshot

**What:** Five PNG endpoints rasterise the brand-aware SVG templates
into PNG buffers when first requested and cache the result keyed on
the SHA-256 hash of the current brand-env snapshot. Endpoints:
`/favicon-32.png` (32×32), `/apple-touch-icon.png` (180×180),
`/android-chrome-192.png`, `/android-chrome-512.png`, and
`/og-image.png` (1200×630 wordmark-on-cream layout). All five share
the same cache and the same brand-snapshot-hash; when the operator
flips brand env-vars and restarts the process, the cache starts
cold and the first request per endpoint re-renders.

**Why:** Older browsers and iOS home-screen installs do not honour
SVG favicons. Social-media crawlers expect a PNG `og:image` for
card previews. Rendering on demand keeps the runtime cost
proportional to traffic — a Christer-family pilot with two users
hits each PNG once and serves from the in-memory cache for the
rest of the process lifetime. Cache-Control is 24 h on the client
side and ETag is the first 16 hex chars of the snapshot hash so
crawlers can `If-None-Match` and get 304.

**Detailed Flow:**
1. Client / crawler requests one of the five PNG paths
2. `server/http/branding.js` calls `renderTemplate(svg, config)`
   to substitute `{{LETTER}}` / `{{APP_NAME}}` / `{{APP_TAGLINE}}`
3. `server/branding/png-renderer.js` builds a cache key
   `<endpoint>:<sha256(env-snapshot)>` and looks up. Hit → return
   cached buffer. Miss → `sharp(svgBuffer, {density: 384}).resize(w, h).png().toBuffer()`,
   cache-set (max 32 entries, LRU eviction), return
4. Handler writes `Content-Type: image/png`, `Cache-Control:
   public, max-age=86400`, `ETag: "<snapshot-hash-prefix>"`,
   then streams the buffer
5. Sharp not loadable → 503 with a clear "PNG renderer unavailable"
   problem-details body. Frontend falls back to the SVG favicon /
   logo-mark which always works

**Affected files:**
- `server/branding/templates/og-image.template.svg` (new)
- `server/branding/png-renderer.js` (new, sharp wrapper + cache)
- `server/http/branding.js` (`handlePng` + 5 new route bindings)
- `client/index.html` (apple-touch-icon + og:image meta tags)
- `tests/branding-png-endpoints.test.js`

**Documented:** 2026-05-28, issue #123

### Format to follow when adding a rule

````markdown
### BR-001: <Short title>

**What:** <The rule in 1–2 sentences>

**Why:** <Background and rationale>

**Detailed Flow:**
1. <step>
2. <step>
3. <step>

**Affected files:**
- `server/services/<name>.service.js` (implementation)
- `tests/<file>.test.js` (verification)

**Documented:** <date, PR number>
**Last modified:** <date, PR number>
````

---

## CROSS-CUTTING EDGE CASES

> Edge cases that touch multiple entities and must be handled
> consistently everywhere. Numbered for reference.

*(No edge cases documented yet.)*

---

## GLOSSARY

> When Christer or the code uses words, they should mean the same thing.

*(No terms defined yet. Built up over time.)*

### Format to follow

````markdown
- **<Term>:** <Short definition>. (Reference: `<file>`)
````

---

## HIGH-LEVEL RELATIONSHIPS

*(Diagram/overview coming when enough entities are documented.)*

---

## REFERENCES TO EXISTING ID SYSTEMS

The project has already established several ID systems from the ISO plan.
DOMAIN_MODEL.md uses **BR-N** for business rules and references
existing IDs where relevant – **it does not introduce parallel
systems**:

- **SAF-N** – safety (see `docs/SAFETY_CASE.md`, e.g. SAF-1 =
  deterministic allergy post-filter)
- **SBOM-N** – supply chain (e.g. SBOM-6 = audit_log)
- **OBS-N** – observability
- **PERF-N** – performance
- **PORT-N** – portability
- **TS-N** – type safety
- **R-N** – risks (see `docs/RISK_REGISTER.md`, R1-R12)

A business rule can reference a SAF or R where it makes sense,
e.g.:
> BR-005 implements SAF-1 (deterministic allergy check) for
> shopping-list-entries. See also R1.
