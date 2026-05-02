# Local CI pyramid (PowerShell edition) — runs the same gates as
# GitHub CI, but locally. Mirrors scripts/local-ci.sh.
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
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/local-ci.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/local-ci.ps1 -Level instant
#   powershell -ExecutionPolicy Bypass -File scripts/local-ci.ps1 -Level fast
#
# On non-Windows, call scripts/local-ci.sh instead (same behaviour).

param(
    [ValidateSet('full', 'fast', 'instant')]
    [string]$Level = 'full'
)

$ErrorActionPreference = 'Stop'

function Step($msg) {
    Write-Host ''
    Write-Host '───────────────────────────────────────────────────────────────'
    Write-Host "▶ $msg"
    Write-Host '───────────────────────────────────────────────────────────────'
}

function Fail($what) {
    Write-Host ''
    Write-Host "✖ LOCAL CI FAILED at: $what" -ForegroundColor Red
    Write-Host '  Fix locally before committing. Do not batch-push with failing gates.'
    exit 1
}

function Run($cmd, $label) {
    & cmd /c $cmd
    if ($LASTEXITCODE -ne 0) { Fail $label }
}

# ---------------------------------------------------------------------------
# Tier 1 — Instant (seconds)
# ---------------------------------------------------------------------------
Step 'Lint (ESLint)'
Run 'npm run lint' 'lint'

Step 'Format check (Prettier)'
Run 'npm run format' 'format'

Step 'Typecheck (tsc --noEmit)'
Run 'npm run typecheck' 'typecheck'

if ($Level -eq 'instant') {
    Write-Host ''
    Write-Host '✓ Tier 1 (instant) passed. Skipping tiers 2+3 per -Level instant.'
    exit 0
}

# ---------------------------------------------------------------------------
# Tier 2 — Fast (~30-60s)
# ---------------------------------------------------------------------------
Step 'Unit tests (node --test)'
$env:NODE_ENV = 'test'
Run 'npm test' 'test'

if ($Level -eq 'fast') {
    Write-Host ''
    Write-Host '✓ Tiers 1+2 passed. Skipping tier 3 per -Level fast.'
    exit 0
}

# ---------------------------------------------------------------------------
# Tier 3 — Full (~2-3 min)
# ---------------------------------------------------------------------------
Step 'Coverage gate'
Run 'npm run test:coverage:gate' 'coverage gate'

Step 'Security audit (runtime deps, fail on high+)'
Run 'npm run audit:prod' 'npm audit'

Write-Host ''
Write-Host '───────────────────────────────────────────────────────────────'
Write-Host '✓ ALL LOCAL CI GATES PASSED' -ForegroundColor Green
Write-Host "  Ready to commit. Push only when Christer explicitly says 'nå kan vi pushe' (Christer's literal Norwegian trigger phrase)."
Write-Host '───────────────────────────────────────────────────────────────'
