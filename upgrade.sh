#!/usr/bin/env bash
#
# Familieassistenten — Safe upgrade (M7.2)
#
# Trygg oppgraderings-flyt:
#   1. Safety-backup av DB (før migrasjoner kjører)
#   2. git fetch + vis hva som kommer
#   3. npm test (lokal, uten å røre running service)
#   4. Hvis tester grønne: git pull + npm ci + systemctl restart
#   5. Post-upgrade /ready + /api/status
#   6. Ved feil: automatisk rollback til forrige commit + DB-restore
#
# Kjøres fra repo-roten: ./upgrade.sh
#
# Flags:
#   --skip-tests    Hopp over test-gate (ikke anbefalt)
#   --no-restart    Ikke restart systemd etter pull (for dry-run)
#   --force         Ikke spør om confirm

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { printf "${BLUE}[upgrade]${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
err()   { printf "${RED}✗${NC} %s\n" "$1" >&2; }
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
    *) die "Ukjent flag: $arg" ;;
  esac
done

# ============================================================
# Pre-flight
# ============================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

[[ -f package.json ]] || die "Ikke et Familieassistenten-repo"
[[ -d .git ]] || die "Ikke et git-repo — kan ikke oppgradere"
command -v git >/dev/null 2>&1 || die "git er ikke installert"
command -v node >/dev/null 2>&1 || die "node er ikke installert"

CURRENT_COMMIT="$(git rev-parse HEAD)"
CURRENT_SHORT="$(git rev-parse --short HEAD)"
log "Nåværende commit: $CURRENT_SHORT"

# Sjekk at working tree er ren (unntatt data/)
if [[ -n "$(git status --porcelain -- ':!data/' ':!backups/')" ]]; then
  err "Working tree har ukommiterte endringer:"
  git status --short -- ':!data/' ':!backups/'
  die "Stash eller commit endringene først"
fi

# ============================================================
# 1. Safety-backup av DB
# ============================================================
backup_db() {
  log "Tar safety-backup av DB..."
  local stamp
  stamp="pre-upgrade-$(date +%Y-%m-%d-%H%M)"
  local backup_file="data/backups/${stamp}.db"
  mkdir -p data/backups

  if [[ ! -f data/familieassistenten.db ]]; then
    warn "data/familieassistenten.db finnes ikke — hopper over backup"
    return
  fi

  # VACUUM INTO er atomisk selv mens serveren kjører
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 data/familieassistenten.db "VACUUM INTO '$backup_file'"
  else
    # Fallback: kald kopi (krever at serveren er stoppet eller tåler at vi leser)
    cp data/familieassistenten.db "$backup_file"
  fi
  ok "Safety-backup: $backup_file ($(du -h "$backup_file" | cut -f1))"
  SAFETY_BACKUP="$backup_file"
}

# ============================================================
# 2. Sjekk hva som kommer
# ============================================================
fetch_and_preview() {
  log "Henter endringer fra origin..."
  git fetch origin

  local upstream
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo 'origin/main')"
  local behind
  behind="$(git rev-list --count HEAD.."$upstream")"

  if [[ "$behind" -eq 0 ]]; then
    ok "Allerede på nyeste commit — ingenting å gjøre"
    exit 0
  fi

  log "$behind commit(s) bak $upstream:"
  git log --oneline HEAD.."$upstream" | sed 's/^/    /'

  if [[ "$FORCE" -eq 0 ]]; then
    echo
    read -r -p "Fortsette med upgrade? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || die "Avbrutt av bruker"
  fi
}

# ============================================================
# 3. Test-gate
# ============================================================
run_tests() {
  if [[ "$SKIP_TESTS" -eq 1 ]]; then
    warn "Hopper over test-gate (--skip-tests)"
    return
  fi
  log "Kjører test-suite..."
  if npm test 2>&1 | tail -10 | tee /tmp/fam-upgrade-tests.log; then
    ok "Tester grønne"
  else
    warn "Tester feilet PÅ NÅVÆRENDE commit (før pull) — avbryter"
    die "Fiks brekken på HEAD først"
  fi
}

# ============================================================
# 4. Pull + install
# ============================================================
apply_upgrade() {
  log "Pulling endringer..."
  git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)"

  log "npm ci --omit=dev..."
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev 2>&1 | tail -5
  else
    npm install --omit=dev 2>&1 | tail -5
  fi

  if [[ "$SKIP_TESTS" -eq 0 ]]; then
    log "Kjører tester på ny commit..."
    if ! npm test 2>&1 | tail -10; then
      warn "Tester feiler på ny commit — ruller tilbake"
      rollback
      die "Rollback fullført"
    fi
  fi

  if [[ "$NO_RESTART" -eq 1 ]]; then
    warn "--no-restart: hopper over systemctl restart"
    return
  fi

  log "Restart service..."
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl restart familieassistenten
    sleep 3
  fi
}

# ============================================================
# 5. Post-upgrade verify
# ============================================================
verify() {
  log "Verifiserer..."
  if command -v systemctl >/dev/null 2>&1 && ! sudo systemctl is-active familieassistenten >/dev/null 2>&1; then
    warn "Service er ikke active etter restart — ruller tilbake"
    rollback
    die "Rollback fullført"
  fi

  local attempts=5
  while (( attempts-- > 0 )); do
    if curl -sf http://localhost:3000/ready >/dev/null 2>&1; then
      ok "/ready svarer OK"
      break
    fi
    sleep 2
  done
  if (( attempts < 0 )); then
    warn "/ready svarte ikke — ruller tilbake"
    rollback
    die "Rollback fullført"
  fi

  ok "Upgrade fullført: $(git rev-parse --short HEAD)"
}

# ============================================================
# Rollback
# ============================================================
rollback() {
  log "Ruller tilbake til $CURRENT_SHORT..."
  git reset --hard "$CURRENT_COMMIT"
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev 2>&1 | tail -3 || true
  fi
  if [[ -n "${SAFETY_BACKUP:-}" && -f "$SAFETY_BACKUP" ]]; then
    log "Restoring DB fra $SAFETY_BACKUP..."
    if command -v systemctl >/dev/null 2>&1; then
      sudo systemctl stop familieassistenten || true
    fi
    cp "$SAFETY_BACKUP" data/familieassistenten.db
    if command -v systemctl >/dev/null 2>&1; then
      sudo systemctl start familieassistenten || true
    fi
    ok "DB restored"
  fi
  warn "Rollback ferdig — sjekk logger: journalctl -u familieassistenten -n 50"
}

# ============================================================
# Hovedflyt
# ============================================================
backup_db
fetch_and_preview
run_tests
apply_upgrade
verify

echo
ok "Oppgradering komplett. Safety-backup: ${SAFETY_BACKUP:-(ingen)}"
