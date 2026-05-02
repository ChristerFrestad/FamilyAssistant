# i18n error-string candidates

Created during Sprint 6 Phase 3B (English-conversion) per CLAUDE.md
DEL 7.11. These are error strings currently emitted by the backend
that bubble up to API responses. They were converted from Norwegian
to English for developer-readability and consistency, but ultimately
should go through `react-i18next` (or backend equivalent) so the
client can display them in the user's language.

When the dedicated i18n-migration sprint is scheduled, work through
this list and:

1. Add a key to the appropriate frontend i18n bundle (e.g.
   `client/src/app/i18n/locales/{no,en}/errors.json`).
2. Update the API client / error-handler to map the error code
   (or string) to the i18n key.
3. Replace the literal string on the backend with a stable error code
   (e.g. `code: 'PRODUCT_KEY_REQUIRED'` instead of the message text).

The list below is the seed — it is **not** exhaustive. Future engineers
adding new throw-strings should append here.

---

## server/services/

### env-store.service.js (sanitize / write)
- `'Value must be a string'`
- `'Value cannot be empty'`
- `'Value is too long (max 500 chars)'`
- `'Value contains invalid characters (newlines, null-bytes or control chars)'`
- `'Value cannot contain double-quote characters'`
- `` `Unknown key '${key}'. Allowed: ${WHITELIST.join(', ')}` ``
- `` `Invalid format for ${key}` ``
- `'No API key set'` (in `testIntegration`)
- `` `Unknown integration: ${name}` ``
- `'Unknown error'`

### pantry.service.js
- `'productKey and positive qty are required'`
- `'productKey and non-negative newQty are required'`

### recipe-url-import.service.js
- `'Invalid URL.'`
- `'URL must start with http:// or https://'`
- `'URL must point to a public website.'`
- `'Instagram links require login and cannot be imported automatically.'`
- `'Pinterest links require an API token and cannot be imported automatically.'`
- `'TikTok links cannot be imported automatically.'`
- `` `Source responded with HTTP ${res.status}.` ``
- `` `Source returned ${ct || 'unknown type'}, not HTML.` ``
- `'Page is too large to read (> 2 MB).'`
- `'No structured recipe data (JSON-LD) found on the page.'`
- `'Page has JSON-LD but no Recipe node.'`

### recipe-import.service.js
- `'Empty LLM response'`
- `'No JSON in LLM response'`
- `` `JSON parse failed: ${err.message}` ``
- `` `LLM call failed: ${err.message}` ``
- `'Recipe text is too short (minimum 20 chars)'`
- `'Missing recipe name in LLM response'`
- `'No valid ingredients parsed'`
- `'Empty or invalid image buffer'`
- `'Image is too large (max 10MB)'`
- `` `Invalid image type: ${mime}` ``
- `'OCR returned too little text — not a recipe or unreadable image'`
- `` `OCR failed: ${err.message}` ``

### shopping-list.service.js
- `'Week is not complete — all 7 days must have a choice (dinner, away, skipped or removed)'`
  *(also exposes error code `WEEK_NOT_COMPLETE` — prefer code-based display)*

### meal-planning.service.js
- `` `Invalid category: ${category}` ``

### receipt.service.js
- `'Empty file'`
- `'File too large (max 10MB)'`
- `'Empty or too short OCR text'`
- `'No JSON in LLM response'`
- `` `Receipt ${receiptId} not found` ``

### circuit-breaker.js
- `'createBreaker: name is required'`
- `` `Circuit for '${name}' is open, retry in ${retrySec}s` ``

## server/routes.js (errors.badRequest / errors.notFound)
- `'recipe.ingredients must be an array'`
- `'imageBase64 is required and must be a base64-encoded string'`
- `` `Invalid mime: ${mime}. Allowed: ${...}` ``
- `'Item must be marked as bought before setting expiry date'`
- `'Expiry date cannot be before purchase date'`
- `'Missing purchase date — send purchasedAt or set last_purchased'`
- `'productKey is required'`
- `'key is required'`
- `'value is required'`
- `'url is required'`
- `'url must start with http:// or https://'`
- `'not supported'`
- `'filterId is required'`
- `'action must be "enabled" or "disabled"'`
- `'productKey or ean must be provided'`
- `'q is required'`
- `` `Invalid MIME type: ${mimeType}. Allowed: ${...}` ``
- `'Invalid id'`
- `` `Shopping list ${id} not found` ``
- `` `Item ${itemId} not found` ``
- `'Invalid recipe id'`
- `'No active shopping list — generate from this week\'s meals first'`
  *(error code: `NO_ACTIVE_LIST`)*
- `'productKey is required'` *(line 1283 — separate context)*

## server/index.js
- `` `Seed failed — DB may be corrupt: ${e.message}` ``

## server/state-snapshot.js
- `` `state-snapshot.register(${type}): serialize and hydrate must be functions` ``

---

## Strategy notes for the i18n migration

- **Codes-first, strings-second.** The most important field to add
  to API errors is a stable `code` field (we already have a few:
  `WEEK_NOT_COMPLETE`, `NO_ACTIVE_LIST`, `CIRCUIT_OPEN`). The error
  message can stay in the dev language; the client looks up a
  localised display via the code.

- **Validation errors should come from Zod.** Zod schemas in
  `server/schemas.js` already produce structured errors — extend the
  schemas to cover the cases above and let Zod's path/message format
  feed the i18n lookup. This avoids hand-written throw-strings.

- **Don't try to translate everything in one sprint.** Start with the
  ~10 most commonly-displayed errors (auth, shopping, pantry add) and
  expand outward. The rest can stay English-fallback for months.

- **Server logs stay English.** Logger output (`logger.info`,
  `logger.warn`, etc.) is operator-facing, not user-facing.
  No i18n needed.
