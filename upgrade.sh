#!/usr/bin/env bash
#
# FamilyAssistant — safe upgrade (M7.2)
#
# Safe upgrade flow:
#   1. Safety backup of the DB (before migrations run)
#   2. git fetch + show what is coming
#   3. npm test (local, without touching the running service)
#   4. If tests pass: git pull + npm ci + systemctl restart
#   5. Post-upgrade /ready + /api/status
#   6. On failure: automatic rollback to the previous commit + DB restore
#
# Run from the repo root: ./upgrade.sh
#
# Flags:
#   --skip-tests    Skip the test gate (not recommended)
#   --no-restart    Do not restart systemd after pull (for dry-run)
#   --force         Do not prompt for confirmation

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { printf "${BLUE}[upgrade]${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}OK${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}WARN${NC} %s\n" "$1"; }
err()   { printf "${RED}FAIL${NC} %s\n" "$1" >&2; }
die()   { err "$1"; exit 1; }

# ============================================================
# Args
# ============================================================
SKIP_TESTS=0
NO_RESTART=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=1 ;;
    --no-restart) NO_RESTART=1 ;;
    --force)      FORCE=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//' | head -30
      exit 0
      ;;
    *) die "Unknown flag: $arg" ;;
  esac
done

# ============================================================
# Pre-flight
# ============================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

[[ -f package.json ]] || die "Not a FamilyAssistant repo"
[[ -d .git ]] || die "Not a git repo - cannot upgrade"
command -v git >/dev/null 2>&1 || die "git is not installed"
command -v node >/dev/null 2>&1 || die "node is not installed"

CURRENT_COMMIT="$(git rev-parse HEAD)"
CURRENT_SHORT="$(git rev-parse --short HEAD)"
log "Current commit: $CURRENT_SHORT"

# Check that the working tree is clean (except for data/)
if [[ -n "$(git status --porcelain -- ':!data/' ':!backups/')" ]]; then
  err "Working tree has uncommitted changes:"
  git status --short -- ':!data/' ':!backups/'
  die "Stash or commit the changes first"
fi

# ============================================================
# 1. Safety backup of DB
# ============================================================
backup_db() {
  log "Taking safety backup of DB..."
  local stamp
  stamp="pre-upgrade-$(date +%Y-%m-%d-%H%M)"
  local backup_file="data/backups/${stamp}.db"
  mkdir -p data/backups

  if [[ ! -f data/familieassistenten.db ]]; then
    warn "data/familieassistenten.db does not exist - skipping backup"
    return
  fi

  # VACUUM INTO is atomic even while the server is running
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 data/familieassistenten.db "VACUUM INTO '$backup_file'"
  else
    # Fallback: cold copy (requires that the server is stopped or tolerates concurrent reads)
    cp data/familieassistenten.db "$backup_file"
  fi
  ok "Safety backup: $backup_file ($(du -h "$backup_file" | cut -f1))"
  SAFETY_BACKUP="$backup_file"
}

# ============================================================
# 2. Check what is coming
# ============================================================
fetch_and_preview() {
  log "Fetching changes from origin..."
  git fetch origin

  local upstream
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo 'origin/main')"
  local behind
  behind="$(git rev-list --count HEAD.."$upstream")"

  if [[ "$behind" -eq 0 ]]; then
    ok "Already on the latest commit - nothing to do"
    exit 0
  fi

  log "$behind commit(s) behind $upstream:"
  git log --oneline HEAD.."$upstream" | sed 's/^/    /'

  if [[ "$FORCE" -eq 0 ]]; then
    echo
    read -r -p "Continue with the upgrade? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || die "Aborted by user"
  fi
}

# ============================================================
# 3. Test gate
# ============================================================
run_tests() {
  if [[ "$SKIP_TESTS" -eq 1 ]]; then
    warn "Skipping test gate (--skip-tests)"
    return
  fi
  log "Running the test suite..."
  if npm test 2>&1 | tail -10 | tee /tmp/fam-upgrade-tests.log; then
    ok "Tests passing"
  else
    warn "Tests failed ON THE CURRENT commit (before pull) - aborting"
    die "Fix the failure on HEAD first"
  fi
}

# ============================================================
# 4. Pull + install
# ============================================================
apply_upgrade() {
  log "Pulling changes..."
  git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)"

  log "npm ci --omit=dev..."
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev 2>&1 | tail -5
  else
    npm install --omit=dev 2>&1 | tail -5
  fi

  if [[ "$SKIP_TESTS" -eq 0 ]]; then
    log "Running tests on new commit..."
    if ! npm test 2>&1 | tail -10; then
      warn "Tests fail on the new commit - rolling back"
      rollback
      die "Rollback complete"
    fi
  fi

  if [[ "$NO_RESTART" -eq 1 ]]; then
    warn "--no-restart: skipping systemctl restart"
    return
  fi

  log "Restarting service..."
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl restart familieassistenten
    sleep 3
  fi
}

# ============================================================
# 5. Post-upgrade verify
# ============================================================
verify() {
  log "Verifying..."
  if command -v systemctl >/dev/null 2>&1 && ! sudo systemctl is-active familieassistenten >/dev/null 2>&1; then
    warn "Service is not active after restart - rolling back"
    rollback
    die "Rollback complete"
  fi

  local attempts=5
  while (( attempts-- > 0 )); do
    if curl -sf http://localhost:7777/ready >/dev/null 2>&1; then
      ok "/ready returned OK"
      break
    fi
    sleep 2
  done
  if (( attempts < 0 )); then
    warn "/ready did not respond - rolling back"
    rollback
    die "Rollback complete"
  fi

  ok "Upgrade complete: $(git rev-parse --short HEAD)"
}

# ============================================================
# Rollback
# ============================================================
rollback() {
  log "Rolling back to $CURRENT_SHORT..."
  git reset --hard "$CURRENT_COMMIT"
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev 2>&1 | tail -3 || true
  fi
  if [[ -n "${SAFETY_BACKUP:-}" && -f "$SAFETY_BACKUP" ]]; then
    log "Restoring DB from $SAFETY_BACKUP..."
    if command -v systemctl >/dev/null 2>&1; then
      sudo systemctl stop familieassistenten || true
    fi
    cp "$SAFETY_BACKUP" data/familieassistenten.db
    if command -v systemctl >/dev/null 2>&1; then
      sudo systemctl start familieassistenten || true
    fi
    ok "DB restored"
  fi
  warn "Rollback finished - check logs: journalctl -u familieassistenten -n 50"
}

# ============================================================
# Main flow
# ============================================================
backup_db
fetch_and_preview
run_tests
apply_upgrade
verify

echo
ok "Upgrade complete. Safety backup: ${SAFETY_BACKUP:-(none)}"
