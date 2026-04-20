#!/usr/bin/env bash
# Local CI pyramid — runs the same gates as GitHub CI, but locally.
#
# Purpose: per CLAUDE.md DEL 5.2, we work local-first and batch-push.
# This script is the single entrypoint for "I think I'm done with this
# logical unit — should I commit?". It runs all three tiers of the
# local CI pyramid and fails fast with a clear message.
#
# Tiers:
#   1. Instant (~seconds): lint, format:check, typecheck
#   2. Fast (~30-60s):     npm test
#   3. Full (~2-3 min):    coverage gate + npm audit
#
# Any failure causes an immediate exit with a non-zero status and a
# descriptive message. No partial success.
#
# Usage:
#   scripts/local-ci.sh           # default: full pyramid
#   scripts/local-ci.sh --instant # just tier 1 (useful during editing)
#   scripts/local-ci.sh --fast    # tiers 1+2 (skip coverage/audit)
#
# On Windows, call the .ps1 variant instead (same behaviour).

set -euo pipefail

LEVEL="${1:-full}"

step() {
  echo ""
  echo "───────────────────────────────────────────────────────────────"
  echo "▶ $1"
  echo "───────────────────────────────────────────────────────────────"
}

fail() {
  echo ""
  echo "✖ LOCAL CI FAILED at: $1"
  echo "  Fix locally before committing. Do not batch-push with failing gates."
  exit 1
}

# ---------------------------------------------------------------------------
# Tier 1 — Instant (seconds)
# ---------------------------------------------------------------------------
step "Lint (ESLint)"
npm run lint || fail "lint"

step "Format check (Prettier)"
npm run format || fail "format"

step "Typecheck (tsc --noEmit)"
npm run typecheck || fail "typecheck"

if [ "$LEVEL" = "--instant" ]; then
  echo ""
  echo "✓ Tier 1 (instant) passed. Skipping tiers 2+3 per --instant."
  exit 0
fi

# ---------------------------------------------------------------------------
# Tier 2 — Fast (~30-60s)
# ---------------------------------------------------------------------------
step "Unit tests (node --test)"
NODE_ENV=test npm test || fail "test"

if [ "$LEVEL" = "--fast" ]; then
  echo ""
  echo "✓ Tiers 1+2 passed. Skipping tier 3 per --fast."
  exit 0
fi

# ---------------------------------------------------------------------------
# Tier 3 — Full (~2-3 min)
# ---------------------------------------------------------------------------
step "Coverage gate"
NODE_ENV=test npm run test:coverage:gate || fail "coverage gate"

step "Security audit (runtime deps, fail on high+)"
npm run audit:prod || fail "npm audit"

echo ""
echo "───────────────────────────────────────────────────────────────"
echo "✓ ALL LOCAL CI GATES PASSED"
echo "  Ready to commit. Push only when Christer explicitly says 'nå kan vi pushe'."
echo "───────────────────────────────────────────────────────────────"
