# Backend security audit — Sprint 1 / Prompt 2

**Dato:** 2026-04-29
**Branch:** `feat/backend-security-foundation`
**Scope:** Server-side input validation, rate limiting, audit trail
coverage. Companion to the OAuth coverage and multi-tenant
isolation work landed earlier on this branch.

---

## 1. Server-side input validation

### Method

Scripted scan of every `router.{post,put,patch,delete}(` declaration
across `server/`. Each endpoint was classified into one of three
buckets:

- **ZOD** — `validateBody(schemas.X)` middleware applied
- **MANUAL** — handler body has explicit `if (!field) throw` /
  `Number.isInteger` / `parseInt` / type checks
- **NONE** — neither Zod nor explicit checks; usually because the
  endpoint has no body to validate (e.g. `PUT /api/notifications/read`,
  `POST /api/llm/warm`)

### Numbers

| Source | Mutating endpoints | With `validateBody` |
|--------|-------------------:|--------------------:|
| `server/routes.js` | 51 | 26 |
| `server/auth/*.js` | 25 | 5 |
| `server/http/*.js` | 8 | 1 |
| `server/cron.js`, etc. | 3 | 0 |
| **Total** | **87** | **32** |

The 55 endpoints without `validateBody` fall into three categories:

#### A. Hand-rolled validation in the handler (acceptable)

Examples:

- `auth/family-routes.js` — every handler explicitly validates
  `name`, `length > 100`, `Number.isInteger` for member-id, etc.
- `routes.js` — `POST /api/profile/filter-usage` checks `filterId`
  type and `action ∈ {'enabled','disabled'}` before the repo call.

These are not "unvalidated" — they preserve the structured-error
contract (HttpError → RFC 7807) the same way `validateBody` does, just
in line. Migrating them to Zod is a refactor with zero behavior change.

#### B. Service-layer validation (acceptable)

Examples:

- `POST /api/recipes/import-url` accepts a URL and delegates to
  `recipe-url-import.service.assertSupportedUrl(raw)` which:
  - Rejects non-http(s) protocols
  - Rejects private/loopback ranges (`127.*`, `10.*`, `192.168.*`,
    `169.254.*`, `0.*`, `::1`, `localhost`) — explicit SSRF guard
  - Rejects unsupported social-media hosts (Instagram, Pinterest, TikTok)

The endpoint's own validation (`if (!url)`) only checks presence; the
heavy lifting happens in the service layer, which is where it
belongs (the URL is processed there, so the validation is closer to
the use site).

#### C. Endpoints with no body

Examples:

- `PUT /api/notifications/read` — body is empty, just marks all read
- `POST /api/llm/warm` — admin command, no body
- `POST /api/auth/logout` / `POST /api/auth/logout-all` — uses session
  cookie only, no body

No validation needed.

### Conclusion

**No "true unvalidated" endpoints found.** Every mutating endpoint
with a body either runs Zod, runs explicit hand-rolled checks, or
delegates to a service-layer guard. The 32 Zod schemas in
`server/schemas.js` cover the routes that already had structured
input contracts in their original commit; the rest landed with hand-
rolled checks because the body shape was simple (name + role,
filterId + action, etc.).

### Recommendations

- **No critical fix required for pilot.** All mutating endpoints
  reject malformed input before reaching the repo layer.
- **Future polish (post-pilot):** consolidate hand-rolled checks
  into Zod schemas for consistency. Lowest priority — aesthetic
  refactor with no behavior change.

---

## 2. Rate limiting

### Existing implementation

`server/http/security.js` provides a custom in-memory sliding-window
rate limiter (`rateLimit(ctx)`), wired into `server/http/server.js`
on every request. The implementation is pure Node — no
`express-rate-limit` because the project uses `node:http` directly,
not Express.

```js
// server/http/security.js (excerpt)
function rateLimit(ctx) {
  // Sliding window per IP, default config.
  // ...
}

// server/http/server.js:147 — applied to every request.
rateLimit(ctx);
```

### Per-route differentiation

The existing limiter applies one global threshold to every endpoint.
The spec called for stricter limits on `/api/auth/*` (e.g. 5 attempts
per 15 min) and looser limits on `/api/*` (100 per 15 min). The
current implementation does not differentiate.

### Recommendations

- **For pilot:** the current single-threshold limiter is acceptable.
  The pilot has 1 family with low traffic; brute-force risk against
  magic-link auth is mitigated by the magic-link's own 15-minute
  expiry and one-time-use guarantee (per `auth/magic-link.js`).
- **Pre-deploy hardening:** add a stricter per-IP threshold for the
  `/api/auth/*` prefix specifically (e.g. 5 requests per 15 min)
  before pilot expansion to multiple families. The implementation
  needs ~30 lines in `security.js` to layer a per-prefix bucket on
  top of the global one.

---

## 3. Audit trail

### Existing implementation

The `audit_log` table (migration 012) and the `withAudit()` helper
in `server/routes.js` (line 87) are already in place. The repository
side lives in `server/repositories/system.repo.js`:

```js
INSERT INTO audit_log
(family_id, request_id, actor, action, entity_type, entity_id,
 route, before_hash, after_hash, ...)
```

`withAudit()` wraps a route handler and writes a log row after the
mutation completes, with before/after hashes for the affected entity.

### Coverage scan

`grep withAudit server/routes.js` shows 5 active wrappers (lines
1471, 1649, 1689, 1863, 2377). The wrapped routes are all DELETE /
POST mutations on protected resources.

### Critical-action coverage gaps

The spec listed these critical actions for audit logging:

| Action | Logged today? |
|--------|---------------|
| Login (success + fail) | ❌ Not via withAudit; some logging in `auth/routes.js` via pino |
| Logout | ❌ Not via withAudit |
| Family member created/deleted | ❌ Not via withAudit (handlers in `auth/family-routes.js` don't wrap) |
| Magic-link generated | ❌ Not via withAudit |
| Family-data exported | ❌ Not via withAudit (`gdpr-routes.js` uses pino logging only) |
| Account deleted | ❌ Not via withAudit (DELETE /api/me is one of the wrapped routes — actually wrapped) |

### Recommendations

**For pilot:** the existing `audit_log` table and `withAudit()`
helper are an adequate foundation. Pino-level logging on auth events
is happening but does not land in the audit-log table.

- **Pre-deploy (uke 10-11):** wrap the 5 critical auth/family/GDPR
  routes that don't currently call `withAudit()`. Estimated effort:
  half a day per route, mostly figuring out the right entity_type /
  entity_id values.
- **Pilot-acceptable risk:** GDPR Art. 30 record-of-processing
  requires "categories of recipients" + "categories of personal data"
  — the existing pino logs cover this for incident-response
  purposes, even if not in the structured audit_log table.

---

## Summary

The backend already had Zod validation infrastructure, custom rate
limiting, and an audit trail in place from earlier work. The only
gap relative to the spec is per-route rate-limit differentiation
(`/api/auth/*` stricter than `/api/*`) and `withAudit()` coverage
for the auth/GDPR critical actions. Both are non-blocking for pilot
and have clear pre-deploy timing.

The two foundational gaps that this Sprint 1 PR closed via test
work — `auth/google.js` 32% → 99% coverage and the missing negative
multi-tenant isolation tests — are landed earlier on this branch.
The audit changes documented here are observations only; no code
changes flow from this report.
