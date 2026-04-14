# Test Coverage Analysis

**Date**: 2026-04-12
**Test runner**: Node.js built-in `node:test`
**Coverage tool**: `--experimental-test-coverage`

## Summary

| Metric     | Current | Threshold |
|------------|---------|-----------|
| Lines      | 89.34%  | 80.0%     |
| Branches   | 79.90%  | 68.0%     |
| Functions  | 89.11%  | 72.0%     |
| Tests      | 732     | —         |
| Failures   | 0       | 0         |

The project comfortably exceeds all three coverage gates. However, the aggregate
numbers mask several files with critically low coverage that represent real risk.
This document identifies those gaps and proposes concrete improvements.

---

## 1. Critical Gaps (< 40% line coverage)

These files contain important business logic or infrastructure code that is
almost entirely untested. A bug in any of them would likely reach production
undetected.

### 1.1 `server/stt.js` — 26% lines, 14% functions

| Function                      | Tested? |
|-------------------------------|---------|
| `transcribe()`                | No      |
| `transcribeWithWhisperCpp()`  | No      |
| `transcribeWithFasterWhisper()`| No     |
| `isSTTAvailable()`            | No      |
| `ensureTempDir()`             | No      |

**Why it matters**: STT is user-facing — voice input is a core feature on the
RPi5. A regression in audio format handling, temp-file cleanup, or timeout
behavior would break the voice assistant silently.

**Recommended tests**:
- Mock `child_process.execFile` and verify `transcribeWithWhisperCpp` builds
  correct arguments, handles errors, and cleans up temp files.
- Mock `http.request` and verify `transcribeWithFasterWhisper` sends correct
  multipart body and parses response.
- Test `isSTTAvailable()` returns `{ available: false }` when binary/model is
  missing and `{ available: true }` when present (mock `fs.existsSync`).
- Test the `transcribe()` dispatcher routes to the correct backend based on
  `STT_BACKEND`.

### 1.2 `server/llm.js` — 35% lines, 22% functions

| Function                      | Tested? |
|-------------------------------|---------|
| `httpRequest()`               | No      |
| `ollamaChat()`                | No      |
| `llamaCppChat()`              | No      |
| `llmChat()`                   | No      |
| `chat()`                      | No      |
| `generateMealSuggestions()`   | No      |
| `suggestRecipeFromText()`     | No      |
| `llmSundayPush()`            | No      |
| `extractIntent()`             | No      |
| `extractToolCallsFromText()`  | No      |
| `isLLMAvailable()`            | No      |
| `estimateTokens()`            | Yes     |
| `trimHistoryToFit()`          | Yes     |
| `buildRAGContext()`           | Yes     |

**Why it matters**: The LLM module powers the chat assistant, meal suggestions,
recipe generation, and intent extraction. These are the application's
differentiating features. Tool-call parsing from text
(`extractToolCallsFromText`) is pure logic that can be unit-tested trivially.

**Recommended tests**:
- **`extractToolCallsFromText()`** — pure function, no mocks needed. Test JSON
  code-block extraction, function-call pattern extraction, and edge cases
  (malformed JSON, nested blocks, no tool calls).
- **`estimateTokens()` / `trimHistoryToFit()`** — already covered, but add edge
  cases (empty history, history exactly at budget, single oversized message).
- **`ollamaChat()` / `llamaCppChat()`** — mock `httpRequest` to return canned
  Ollama/llama.cpp responses. Verify tool-call extraction from native format,
  text-only fallback, and error propagation.
- **`llmChat()`** — verify circuit-breaker integration: calls execute, wraps
  `CircuitOpenError` with user-friendly message, falls back correctly when
  breaker is null.
- **`chat()`** — integration test with mocked LLM. Verify system prompt
  assembly, RAG context inclusion, history trimming, and tool-call execution
  chain.
- **`isLLMAvailable()`** — mock HTTP to test both available/unavailable
  scenarios for each backend.

### 1.3 `server/backup.js` — 35% lines, 30% functions

| Function                  | Tested? |
|---------------------------|---------|
| `backupNow()`             | No      |
| `syncToRemote()`          | No      |
| `pruneOldBackups()`       | No      |
| `scheduleDailyBackup()`   | No      |
| `stopBackupScheduler()`   | No      |
| `classifyRemote()`        | Partial |

**Why it matters**: Backup is the only data-loss protection. If `backupNow()`
silently fails or `pruneOldBackups()` deletes too aggressively, the user has no
recovery path.

**Recommended tests**:
- **`classifyRemote()`** — pure function. Test 'rsync://', 'user@host:', and
  plain path classification.
- **`backupNow()`** — with an in-memory or temp SQLite DB, verify it creates the
  backup file, calls `pruneOldBackups`, and triggers `syncToRemote` when
  `REMOTE_PATH` is set. Verify it returns `null` and fires alerting on failure.
- **`pruneOldBackups()`** — create >14 dummy files in a temp dir and verify only
  the newest 14 survive.
- **`syncToRemote()` (mount path)** — mock `fs.existsSync`/`copyFileSync` to
  verify atomic write (tmp + rename).
- **`scheduleDailyBackup()` / `stopBackupScheduler()`** — verify timer is set
  and can be cleared (use fake timers).

### 1.4 `server/services/meal-planning.service.js` — 39% lines, 60% functions

| Function                  | Tested? |
|---------------------------|---------|
| `getSwapSuggestions()`    | Partial |
| `checkShelfLife()`        | No      |
| `generateSundayDraft()`   | No      |

**Why it matters**: Meal planning is a daily-use feature. `checkShelfLife()`
prevents food waste by warning about perishable ingredients.
`generateSundayDraft()` powers the weekly planning push notification.

**Recommended tests**:
- **`checkShelfLife()`** — provide a mock plan with a recipe whose ingredient
  has `shelfDays: 3`. Verify warnings are generated when the meal is scheduled
  for day 5. Verify `{ ok: true }` when all ingredients have sufficient shelf
  life.
- **`generateSundayDraft()`** — seed recipes across categories (rask, comfort,
  helg). Verify the draft assigns Mon-Thu = rask, Fri = comfort, Sat-Sun = helg.
  Verify it avoids repeating current-week recipes.
- **`getSwapSuggestions()`** — test with inventory data to verify
  `ingredientsAtHome` counting. Test the 5-suggestion cap.

---

## 2. Significant Gaps (40–75% line coverage)

These files have partial coverage but contain important untested code paths.

### 2.1 `server/state-snapshot.js` — 65% lines, 55% functions

Untested: `snapshotOne`, `restoreOne`, `snapshotAll`, `restoreAll`,
`startSnapshotScheduler`, `stopSnapshotScheduler`.

**Recommended tests**: Use a test-only `register()` with mock serialize/hydrate
functions. Verify snapshot writes to the repository, restore reads back, stale
snapshots are skipped, and JSON parse errors are handled gracefully.

### 2.2 `server/services/receipt.service.js` — 63% lines, 64% functions

Untested: `tesseractOcr`, `nullOcr`, `isOcrAvailable`, `extractReceiptFromText`,
`processUpload` (the full pipeline).

**Recommended tests**: Mock `execFileAsync` for OCR tests. Mock `llmChat` for
`extractReceiptFromText` — verify JSON extraction from LLM response, handling of
missing JSON, and short-text rejection.

### 2.3 `server/routes.js` — 73% lines, 70% functions

Untested route handlers include:
- `POST /api/stt/transcribe` and `GET /api/stt/status`
- `POST /api/llm/chat` and `POST /api/llm/recipe`
- `GET/POST/DELETE /api/calendar/events`
- `GET /api/notifications`, `PUT /api/notifications/read`
- `GET /api/audit`, `GET /api/audit/stats`
- `GET /api/kb/stats`, `GET /api/kb/search`
- `executeToolCall()` helper (all 5 tool branches)

**Recommended tests**: The calendar, notifications, audit, and KB endpoints are
straightforward CRUD — they need integration tests hitting them via the test
HTTP helper. The `executeToolCall()` function is pure logic and can be tested
directly.

### 2.4 `server/config.js` — 78% lines, 41% branches

Untested branches: production guards (`AUTH_TOKEN` required, `AUTH_TOKEN` length
check, `ALLOWED_ORIGINS=*` blocked in production), `LOG_PRETTY` derivation,
`ALLOWED_ORIGINS_LIST` parsing.

**Recommended tests**: Override `process.env` and call `loadConfig()` in
isolated contexts. Verify that missing `AUTH_TOKEN` in production exits, short
tokens exit, and wildcard origins in production exits. Use `process.exit` mocks
or child-process spawning to capture exit behavior.

### 2.5 `server/db.js` — 71% lines, 50% branches

Untested: `sql.js` fallback path, error handling in migration runs, WAL mode
setup.

**Recommended tests**: Force `better-sqlite3` import to fail and verify the
sql.js adapter is loaded as fallback. Verify WAL mode is enabled on successful
init.

---

## 3. Branch Coverage Weaknesses

These files have good line coverage but low branch coverage, meaning many
conditional paths are not exercised.

| File                              | Lines | Branches | Key untested branches |
|-----------------------------------|-------|----------|----------------------|
| `config.js`                       | 78%   | **41%**  | Production guards, CORS hardening, LOG_PRETTY derivation |
| `pantry-resolver.service.js`      | 87%   | **45%**  | Edge cases in fuzzy matching fallbacks |
| `state-snapshot.js`               | 65%   | **53%**  | Stale check, JSON parse failure, hydrate returning false |
| `shopping-list.service.js`        | 99%   | **57%**  | Week completeness edge cases, empty pantry deduction |
| `http/security.js`                | 84%   | **57%**  | Bearer auth paths, HSTS condition, rate limit cleanup |
| `http/metrics.js`                 | 99%   | **63%**  | Histogram bucket edge cases |

---

## 4. Structural / Architectural Gaps

### 4.1 No frontend JavaScript tests

The 16 files in `public/js/` (~2,400 lines) have zero test coverage. While the
`m-week4-frontend-features.test.js` file tests frontend *behavior* via HTTP
responses and HTML assertions, the actual client-side JavaScript logic (tab
switching, voice recording, chat rendering, service worker, offline handling) is
completely untested.

**Recommendation**: Consider adding a lightweight DOM testing setup (e.g.,
`jsdom` with `node:test`) for core modules like `core.js`, `chat.js`, and
`shopping.js`. Focus on event-handler logic and state management, not DOM
rendering.

### 4.2 No integration test for the full receipt pipeline

The receipt flow (upload image -> OCR -> LLM extraction -> product matching ->
confirmation -> inventory update) is tested in pieces but never end-to-end.
A mock-LLM integration test for `processUpload()` would catch glue-code bugs.

### 4.3 LLM tool-call execution is untested

The `executeToolCall()` function in `routes.js` handles 5 different tools
(shopping list, calendar, routines, meal suggestion, KB search). None of these
branches are covered. Since this is pure logic (no HTTP, no external deps), it
should be trivially testable.

### 4.4 Scheduler/timer code is never tested

`backup.js:scheduleDailyBackup()`, `state-snapshot.js:startSnapshotScheduler()`,
and cron-related timers are never exercised. Consider using Node's
`--experimental-test-snapshots` or mock timers to verify scheduling math
(`nextRunMs`, `msUntilDaily`).

---

## 5. Prioritized Recommendations

Ordered by risk reduction per effort:

| Priority | Area | Estimated effort | Risk mitigated |
|----------|------|-----------------|----------------|
| **P0** | `llm.js` — `extractToolCallsFromText()` | Small (pure function) | Tool-call parsing regression |
| **P0** | `meal-planning.service.js` — all 3 functions | Small-Medium | Meal planning and shelf-life bugs |
| **P0** | `routes.js` — `executeToolCall()` | Small (pure function) | LLM tool execution bugs |
| **P1** | `backup.js` — `backupNow()` + `pruneOldBackups()` | Medium | Data loss from silent backup failures |
| **P1** | `stt.js` — mock-based unit tests | Medium | Voice input regression |
| **P1** | `llm.js` — `ollamaChat()`/`llamaCppChat()` with mocked HTTP | Medium | Chat and suggestion features |
| **P2** | `state-snapshot.js` — snapshot/restore cycle | Small-Medium | Metrics persistence across restarts |
| **P2** | `receipt.service.js` — `extractReceiptFromText()` | Medium | Receipt scanning accuracy |
| **P2** | `routes.js` — calendar, notifications, audit, KB routes | Medium | CRUD endpoint regressions |
| **P2** | `config.js` — production guard branches | Small | Insecure production deployment |
| **P3** | `http/security.js` — rate limit + bearer auth branches | Small | Security middleware bypass |
| **P3** | `db.js` — sql.js fallback path | Small | Portability regression |
| **P3** | Frontend JS unit tests (`public/js/`) | Large | Client-side logic bugs |

---

## 6. Coverage Thresholds Review

Current thresholds (80% lines / 68% branches / 72% functions) are reasonable but
the branch threshold of 68% is quite lenient. With the current baseline at 79.9%
branches, consider raising thresholds to:

| Metric     | Current gate | Proposed gate |
|------------|-------------|---------------|
| Lines      | 80.0%       | 85.0%         |
| Branches   | 68.0%       | 74.0%         |
| Functions  | 72.0%       | 82.0%         |

This would still leave headroom above the gate while preventing coverage erosion
as new features are added.
