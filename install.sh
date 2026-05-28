#!/usr/bin/env bash
#
# FamilyAssistant — idempotent installer (M7)
#
# Runs on a clean Raspberry Pi OS (Bookworm or newer). Safe to run
# multiple times — each step checks and skips work that is already
# done.
#
# Steps:
#   1. Node 20 LTS (via nodesource)
#   2. Build deps for better-sqlite3 (build-essential, python3)
#   3. npm ci --omit=dev
#   4. data/ + backups/ directories
#   5. .env from .env.example if missing, generate AUTH_TOKEN
#   6. systemd unit from repo file, daemon-reload, enable + start
#   7. Check /ready and report green/red status
#
# Run from the repo root: ./install.sh

set -euo pipefail

# ============================================================
# Argument parsing (week 7 PORT-6)
# ============================================================
INSTALL_MODE="systemd"
for arg in "$@"; do
  case "$arg" in
    --docker) INSTALL_MODE="docker" ;;
    --systemd) INSTALL_MODE="systemd" ;;
    -h|--help)
      cat <<'HELP'
FamilyAssistant installer

Usage:
  ./install.sh              # systemd deploy (default, runs Node directly)
  ./install.sh --docker     # Docker Compose deploy
  ./install.sh --systemd    # explicit systemd mode
  ./install.sh --help       # print this message
HELP
      exit 0
      ;;
    *) echo "Unknown argument: $arg (use --help)" >&2; exit 1 ;;
  esac
done

# ============================================================
# Helpers
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { printf "${BLUE}[install]${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}OK${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}WARN${NC} %s\n" "$1"; }
err()   { printf "${RED}FAIL${NC} %s\n" "$1" >&2; }
die()   { err "$1"; exit 1; }

need_root_for() {
  if [[ $EUID -ne 0 ]] && ! command -v sudo >/dev/null 2>&1; then
    die "Need root or sudo for: $1"
  fi
}

run_sudo() {
  if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

# ============================================================
# Pre-flight
# ============================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f package.json ]]; then
  die "Run this script from the FamilyAssistant repo root"
fi

log "FamilyAssistant installer v1.2"
log "Working directory: $SCRIPT_DIR"
log "User: $(whoami)"

# ============================================================
# 1. Node.js 20 LTS
# ============================================================
install_node() {
  log "Checking Node.js..."
  if command -v node >/dev/null 2>&1; then
    local v
    v="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "$v" -ge 20 ]]; then
      ok "Node.js $(node -v) already installed"
      return
    fi
    warn "Node.js $(node -v) is too old (need >= 20)"
  fi

  log "Installing Node.js 20 LTS via nodesource..."
  need_root_for "Node.js install"
  curl -fsSL https://deb.nodesource.com/setup_20.x | run_sudo -E bash -
  run_sudo apt-get install -y nodejs
  ok "Node.js $(node -v) installed"
}

# ============================================================
# 2. Build deps for better-sqlite3
# ============================================================
install_build_deps() {
  log "Checking build deps for better-sqlite3..."
  local missing=()
  for pkg in build-essential python3 make g++; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      missing+=("$pkg")
    fi
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    ok "All build deps present"
    return
  fi
  log "Installing: ${missing[*]}"
  need_root_for "apt install"
  run_sudo apt-get update -qq
  run_sudo apt-get install -y "${missing[@]}"
  ok "Build deps installed"
}

# ============================================================
# 3. npm packages
# ============================================================
install_npm() {
  log "Installing npm packages..."
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev 2>&1 | tail -5 || {
      warn "npm ci failed - trying npm install"
      npm install --omit=dev 2>&1 | tail -5
    }
  else
    npm install --omit=dev 2>&1 | tail -5
  fi
  # Verify that better-sqlite3 built
  if node -e "require('better-sqlite3')" 2>/dev/null; then
    ok "better-sqlite3 built OK"
  else
    warn "better-sqlite3 could not build - falling back to sql.js"
  fi
}

# ============================================================
# 4. Create directories
# ============================================================
create_dirs() {
  log "Creating data directories..."
  mkdir -p data data/backups
  chmod 755 data data/backups
  ok "data/ and data/backups/ ready"
}

# ============================================================
# 5. .env generation
# ============================================================
setup_env() {
  log "Checking .env..."
  if [[ -f .env ]]; then
    ok ".env already present"
  else
    if [[ ! -f .env.example ]]; then
      die ".env.example missing - run from a full repo checkout"
    fi
    log "Creating .env from .env.example..."
    cp .env.example .env
  fi

  # Generate AUTH_TOKEN if not set
  if ! grep -qE '^AUTH_TOKEN=.+' .env; then
    log "Generating AUTH_TOKEN (openssl rand -hex 32)..."
    local token
    if command -v openssl >/dev/null 2>&1; then
      token="$(openssl rand -hex 32)"
    else
      token="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    fi
    # Use perl for cross-platform in-place edit (macOS sed needs -i '')
    perl -i -pe "s|^AUTH_TOKEN=.*|AUTH_TOKEN=$token|" .env
    ok "AUTH_TOKEN generated ($(echo -n "$token" | head -c 8)...)"
  else
    ok "AUTH_TOKEN already set"
  fi

  # Secure permissions
  chmod 600 .env
  if [[ "$(whoami)" != "root" ]]; then
    chown "$(whoami):$(whoami)" .env 2>/dev/null || true
  fi
  ok ".env set to 0600"
}

# ============================================================
# 6. systemd service
# ============================================================
install_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemd not present - skipping service install"
    return
  fi

  log "Installing systemd service..."
  if [[ ! -f familieassistenten.service ]]; then
    die "familieassistenten.service missing in repo"
  fi

  # Patch User + WorkingDirectory to actual environment before install
  local tmp
  tmp="$(mktemp)"
  sed \
    -e "s|^User=.*|User=$(whoami)|" \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=$SCRIPT_DIR|" \
    -e "s|^ExecStart=.*|ExecStart=$(command -v node) server/index.js|" \
    -e "s|^ReadWritePaths=.*|ReadWritePaths=$SCRIPT_DIR/data $SCRIPT_DIR/.env|" \
    familieassistenten.service > "$tmp"

  need_root_for "systemd install"
  run_sudo cp "$tmp" /etc/systemd/system/familieassistenten.service
  rm -f "$tmp"
  run_sudo systemctl daemon-reload

  if run_sudo systemctl is-enabled familieassistenten >/dev/null 2>&1; then
    ok "Service already enabled"
  else
    run_sudo systemctl enable familieassistenten
    ok "Service enabled"
  fi

  # Quick syntax check before we restart
  log "Running quick syntax check..."
  if NODE_ENV=test node -e "require('./server/index.js'); setTimeout(()=>process.exit(0), 300)" 2>&1 | tail -3; then
    ok "Code parses OK"
  else
    die "Code throws on require - see error above"
  fi

  log "Starting/restarting service..."
  run_sudo systemctl restart familieassistenten
  sleep 3
}

# ============================================================
# 7. Health check
# ============================================================
verify() {
  log "Verifying installation..."

  # Systemd status
  if command -v systemctl >/dev/null 2>&1; then
    if run_sudo systemctl is-active familieassistenten >/dev/null 2>&1; then
      ok "systemd service: active"
    else
      err "systemd service: not active"
      run_sudo systemctl status familieassistenten --no-pager -n 20 || true
      return 1
    fi
  fi

  # Health endpoint
  local attempts=5
  while (( attempts-- > 0 )); do
    if curl -sf http://localhost:7777/health >/dev/null 2>&1; then
      ok "/health returned 200"
      break
    fi
    sleep 1
  done
  if (( attempts < 0 )); then
    err "/health did not respond within 5 seconds"
    return 1
  fi

  # Ready endpoint
  local ready_body
  ready_body="$(curl -sf http://localhost:7777/ready 2>/dev/null || echo '{}')"
  if echo "$ready_body" | grep -q '"ready":true'; then
    ok "/ready reports OK"
  else
    warn "/ready does not report ready=true:"
    echo "$ready_body" | head -c 300
    echo
  fi
}

# ============================================================
# Docker mode helpers (week 7 PORT-6)
# ============================================================
install_docker() {
  log "Checking Docker..."
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) and Compose plugin already installed"
    return
  fi
  log "Installing Docker Engine via get.docker.com..."
  need_root_for "Docker install"
  curl -fsSL https://get.docker.com | run_sudo sh
  # Add user to docker group
  run_sudo usermod -aG docker "$(whoami)" || true
  warn "Log out and back in to activate 'docker' group membership"
  ok "Docker installed"
}

docker_compose_up() {
  log "Starting Docker Compose..."
  if [[ ! -f docker-compose.yml ]]; then
    die "docker-compose.yml missing - run from repo root"
  fi
  if [[ ! -f .env ]]; then
    die ".env missing - setup_env must run first"
  fi
  docker compose pull || warn "pull failed (first-time build will happen)"
  docker compose up -d
  ok "docker compose up -d complete"
}

verify_docker() {
  log "Waiting for /health via Docker..."
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf http://localhost:7777/health >/dev/null 2>&1; then
      ok "Health check OK after $i sec"
      return
    fi
    sleep 1
  done
  err "/health did not respond within 10 sec. Check: docker compose logs app"
  exit 1
}

# ============================================================
# Main flow
# ============================================================
if [[ "$INSTALL_MODE" == "docker" ]]; then
  log "Installing in DOCKER mode"
  install_docker
  create_dirs
  setup_env
  docker_compose_up
  verify_docker
else
  log "Installing in SYSTEMD mode"
  install_node
  install_build_deps
  install_npm
  create_dirs
  setup_env
  install_systemd
  verify
fi

echo
echo "============================================"
ok "Installation complete!"
echo "============================================"
echo
echo "LAN address:"
echo "   http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):7777"
echo
echo "AUTH_TOKEN is stored in .env (0600, owner $(whoami))"
echo "   Required to call /api/* endpoints."
echo "   Read: grep AUTH_TOKEN .env"
echo
echo "Next steps:"
echo "   1. Install Caddy for HTTPS (see DEPLOY.md §13)"
echo "   2. Install Ollama and pull a model:"
echo "      curl -fsSL https://ollama.com/install.sh | sh"
echo "      ollama pull qwen2.5:3b"
echo "   3. Add an iPhone home-screen shortcut (see DEPLOY.md §9)"
echo
echo "Useful commands (see RUNBOOK.md):"
echo "   sudo systemctl status familieassistenten"
echo "   journalctl -u familieassistenten -f"
echo "   curl -s http://localhost:7777/api/status | jq"
echo
