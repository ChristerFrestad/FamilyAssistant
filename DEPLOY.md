# FamilyAssistant v1.2 — Deploy on Raspberry Pi 5

> **Paths in this document** use `$APP_ROOT` as a placeholder.
> Default: `export APP_ROOT=$APP_ROOT`

> ## ⚠️ Production requirements (M1)
>
> Before setting `NODE_ENV=production`, the following must be in place:
>
> 1. **`AUTH_TOKEN`** (at least 16, preferably 32 characters) — the server refuses to start without it in prod.
>    Generate: `openssl rand -hex 32`
> 2. **`ALLOWED_ORIGINS`** — comma-separated list of allowed origins.
>    `*` is not allowed in prod. Example: `https://familieassistenten.local,https://raspberrypi.local`
> 3. **HTTPS via Caddy** — see section 13 below. Set `HTTPS_TERMINATED=true` in the environment
>    so the server adds the `Strict-Transport-Security` header.
> 4. **API keys in .env** (not in systemd!) — file permissions `chmod 600 .env`,
>    owner `pi:pi`. Keys are set via the Settings UI which writes through env-store.service.


## 1. Copy the files

```bash
scp -r FamilyAssistant/ pi@raspberrypi.local:~
```

## 2. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 3. Install SQLite support (recommended)

```bash
cd $APP_ROOT
npm init -y
npm install better-sqlite3
# Or if better-sqlite3 fails:
npm install sql.js
```

Without SQLite the server uses a JSON fallback (works, but slower and no vector search).

## 4. Start manually (for testing)

```bash
cd $APP_ROOT
chmod +x start.sh
./start.sh
```

Open `http://raspberrypi.local:7777` to verify that it works.

## 5. Automatic startup (systemd)

```bash
sudo cp familieassistenten.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable familieassistenten
sudo systemctl start familieassistenten
```

Check status: `sudo systemctl status familieassistenten`
View logs: `journalctl -u familieassistenten -f`

## 6. LLM setup

### Option A: Ollama (simplest)

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:3b
```

### Option B: llama.cpp (faster, lower RAM)

```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp && make -j4 GGML_VULKAN=1  # Vulkan for GPU acceleration
# Download Qwen2.5-3B in GGUF format:
wget https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf

# Start server:
./llama-server -m qwen2.5-3b-instruct-q4_k_m.gguf \
  -c 3072 -t 3 --host 0.0.0.0 --port 8080
```

Set `LLM_BACKEND=llamacpp` in `.env` or the systemd service.

### Model selection for RPI5 8GB

| Model | RAM | Speed | Recommended? |
|--------|-----|-----------|-----------|
| qwen2.5:1.5b | ~1.2 GB | 15-25 t/s | Fast, simpler answers |
| qwen2.5:3b | ~2.5 GB | 8-15 t/s | Best balance for 8GB |
| qwen2.5:7b | ~5 GB | 3-8 t/s | Best quality, risk of swap |

Default is `qwen2.5:3b`. Change via `OLLAMA_MODEL` in the environment.

## 7. STT / Speech recognition (optional)

### whisper.cpp (recommended for offline Norwegian)

```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make -j4

# Download NB-Whisper (Norwegian-optimized):
wget https://huggingface.co/NbAiLab/nb-whisper-base/resolve/main/ggml-model.bin \
  -O models/ggml-nb-whisper-base.bin

# Install ffmpeg (for audio conversion):
sudo apt install -y ffmpeg
```

Set in `.env` or systemd:
```
WHISPER_CPP_PATH=/opt/whisper.cpp/main
WHISPER_MODEL_PATH=/opt/whisper.cpp/models/ggml-nb-whisper-base.bin
```

Without whisper.cpp, the browser's Web Speech API is used (requires internet).

## 8. Environment variables

Create `$APP_ROOT/.env` or set in systemd:

```bash
PORT=7777
LLM_BACKEND=ollama          # or 'llamacpp'
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
LLAMACPP_HOST=http://localhost:8080
MAX_CONTEXT_TOKENS=3072
STT_BACKEND=whisper_cpp
WHISPER_CPP_PATH=/opt/whisper.cpp/main
WHISPER_MODEL_PATH=/opt/whisper.cpp/models/ggml-nb-whisper-base.bin
WHISPER_THREADS=3
```

## 9. iPhone shortcut

1. Open Safari on iPhone
2. Go to `http://raspberrypi.local:7777`
3. Tap the Share button > "Add to Home Screen"
4. Name: "FamilyAssistant"

## 10. Access outside the home

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

## 11. RAM optimization

Recommended setup to avoid swapping:

```bash
# Enable zram (compressed swap)
sudo apt install -y zram-tools
echo 'ALGO=zstd' | sudo tee /etc/default/zramswap
echo 'PERCENT=50' | sudo tee -a /etc/default/zramswap
sudo systemctl restart zramswap

# Limit GPU memory (frees RAM)
echo 'gpu_mem=64' | sudo tee -a /boot/config.txt
sudo reboot
```

Typical RAM usage with everything running:
- OS + systemd: ~800 MB
- Node.js server: ~100 MB
- Ollama + qwen2.5:3b: ~2.5 GB
- whisper.cpp (on-demand): ~400 MB (only during transcription)
- Total: ~3.8 GB — comfortably within 8 GB

## 13. HTTPS via Caddy (M1.6 — required before external access)

FamilyAssistant exposes sensitive data (family calendar, shopping list, LLM chat).
Plain HTTP is not acceptable outside a strict LAN. Use Caddy as a reverse proxy
in front of the Node server on port 7777.

### 13.1 Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 13.2 Install the Caddyfile

```bash
sudo cp $APP_ROOT/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

The Caddyfile has 3 options — **A) LAN-only with internal CA (recommended for family)**,
B) Tailscale Serve, C) public domain. Edit the file and comment out the ones you do not use.

### 13.3 Install Caddy's root certificate on iPhone

Option A uses Caddy's local CA. The iPhone must approve the root certificate once:

```bash
# On the RPi5:
sudo caddy trust
sudo cp /etc/caddy/pki/authorities/local/root.crt ~/caddy-root.crt
```

Copy `~/caddy-root.crt` to the iPhone (AirDrop/mail), open it, and:
**Settings → Profiles → Approve → Settings → General → VPN and Device Management → Certificate Trust Settings → Enable "FamilyAssistant"**.

After this, open `https://familieassistenten.local` in Safari and you get a green padlock icon.

### 13.4 Update systemd with prod env

Add to `/etc/systemd/system/familieassistenten.service`:

```ini
Environment=NODE_ENV=production
Environment=HTTPS_TERMINATED=true
Environment=ALLOWED_ORIGINS=https://familieassistenten.local,https://raspberrypi.local
Environment=AUTH_TOKEN=<generated-32-hex-characters>
```

Generate token:
```bash
openssl rand -hex 32
```

`sudo systemctl daemon-reload && sudo systemctl restart familieassistenten`.
Verify that startup succeeds — the server rejects invalid config with a clear error message.

### 13.5 Verify HTTPS + auth

```bash
# 1. HTTPS with valid cert (after root cert is installed)
curl -I https://familieassistenten.local/health
# Expected: 200 OK, Strict-Transport-Security, Content-Security-Policy

# 2. API requires token
curl -I https://familieassistenten.local/api/today
# Expected: 401 Unauthorized

curl -H "Authorization: Bearer <token>" https://familieassistenten.local/api/today
# Expected: 200 OK with data

# 3. /health and /ready are open (for monitoring)
curl https://familieassistenten.local/ready
# Expected: 200 OK without token
```

### 13.6 Firewall — do not expose port 7777 directly

```bash
sudo ufw allow 443/tcp    # HTTPS
sudo ufw allow 80/tcp     # HTTP redirect → HTTPS
sudo ufw deny 7777/tcp    # Node only via Caddy
sudo ufw enable
```

---

## 12. Upgrade: Hailo AI HAT+

For significantly faster LLM:

```bash
sudo apt install hailo-all
# Provides up to 26 TOPS acceleration
# See: https://www.raspberrypi.com/products/ai-hat-plus/
```

## Troubleshooting

- **Server does not start:** `journalctl -u familieassistenten -f`
- **LLM slow:** Switch to qwen2.5:1.5b, or use llama.cpp with Q4_K_M quant
- **STT does not work:** Check that ffmpeg is installed and the whisper.cpp binary exists
- **Cannot reach from iPhone:** `sudo ufw allow 7777`
- **Database reset:** Delete `data/familieassistenten.db` (or `.json`) and start over
- **Migration:** Old JSON database is migrated automatically to SQLite on startup

---

## 14. Docker deployment (week 7 PORT-6)

FamilyAssistant ships as a prebuilt multiarch Docker image on
GitHub Container Registry. This is the recommended deployment method for
new installs on RPi5 — simpler than systemd + manual npm install.

### 14.1 Prerequisites

```bash
# Install Docker Engine and the Docker Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in to activate group membership

# Verify
docker --version
docker compose version
```

### 14.2 Quick start

```bash
# Clone repo for Caddyfile + docker-compose.yml + .env.example
git clone https://github.com/ChristerFrestad/FamilyAssistant.git
cd FamilyAssistant

# Create production config
cp .env.example .env
nano .env
# Set at minimum:
#   AUTH_TOKEN=<output of openssl rand -hex 32>
#   ALLOWED_ORIGINS=https://familieassistenten.local
#   AUTH_TOKEN_CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Create data directory
mkdir -p data

# Start
docker compose up -d

# Verify
docker compose ps
curl -sf http://localhost:7777/health && echo " — OK"
```

The app is now at `http://localhost:7777` and Caddy serves HTTPS at
`https://familieassistenten.local` (if mDNS is set up).

### 14.3 Upgrade

```bash
cd ~/FamilyAssistant
docker compose pull     # Pull latest image from ghcr.io
docker compose up -d    # Restart with new image
docker compose logs -f app  # Follow logs for 1 min
```

Data in `./data/` is retained across upgrades. DB migrations
run automatically on startup.

### 14.4 Backup / restore via Docker

```bash
# Backup while app is running (uses SQLite online backup)
docker compose exec app /nodejs/bin/node -e "
  const { initDB } = require('./server/db');
  const { backupNow } = require('./server/backup');
  (async () => {
    const h = await initDB();
    console.log(backupNow(h.db));
  })();
"

# Latest backup is in ./data/backups/
ls -lh data/backups/

# Restore — stop app, copy backup, start app
docker compose stop app
cp data/backups/familieassistenten-2026-04-11.db data/familieassistenten.db
docker compose start app
```

### 14.5 Using `install.sh --docker`

Alternatively, use the install script that does everything above:

```bash
curl -fsSL https://raw.githubusercontent.com/ChristerFrestad/FamilyAssistant/main/install.sh | bash -s -- --docker

# Or locally after clone:
sudo ./install.sh --docker
```

The script:
- Installs Docker Engine if missing
- Generates AUTH_TOKEN automatically
- Creates `.env` with sensible defaults
- Starts `docker compose up -d`
- Verifies `/health`

### 14.6 Troubleshooting Docker

**Container restarts in a loop:**
```bash
docker compose logs app --tail 100
# Look for: AUTH_TOKEN, ALLOWED_ORIGINS, DB-path
```

**Cannot reach Ollama on host:**
- Linux: Set `OLLAMA_HOST=http://host.docker.internal:11434`
  (docker-compose.yml has `host-gateway` mapping)
- macOS / Windows: Same, `host.docker.internal` works by default

**Permission denied on data directory:**
```bash
# Distroless uses UID 65532 (nonroot)
sudo chown -R 65532:65532 data/
```

**Upgrade multiarch image to ARM64 manually:**
```bash
docker pull --platform linux/arm64 ghcr.io/christerfrestad/familyassistant:latest
```

### 14.7 systemd OR Docker — never both

Pick one method. If you previously used `familieassistenten.service`,
stop and disable it before switching to Docker:

```bash
sudo systemctl stop familieassistenten
sudo systemctl disable familieassistenten
sudo rm /etc/systemd/system/familieassistenten.service
sudo systemctl daemon-reload
```

Do not delete the data directory — the Docker variant uses the same SQLite file.

---

## 15. Cloud / multi-tenant deploy

The cloud / multi-tenant deploy path (Google OAuth + magic-link
across families) is **not currently shipped**. The repo previously
held a Railway-targeted recipe in this section; that path was
retired on 2026-04-29 in favour of a single deploy story:

> Docker → Portainer → RPi5 → Cloudflare Tunnel

See the master plan in `docs/master-plan/` (or whichever revision
is in flight) for the deploy architecture currently being built
toward, and §16 below for the Portainer recipe that lands first.

A future cloud option may return when the pilot has stabilised on
the Portainer story; if so, this section will be re-written
against that target rather than reinstated as Railway-specific.


---


## 16. Deploy via Portainer (zero-config)

Portainer targets self-hosters who expect "click deploy → open in browser → configure" — the same UX as Jellyfin, Sonarr, Immich, Vaultwarden. The stack therefore starts without a pre-set `AUTH_TOKEN`: on first boot the server runs a setup wizard at `/setup.html` that generates and persists the token for you.

All of §16 is written for Portainer CE (no SSH, no shell). Every step uses the Portainer web UI.

### 16.1 Prerequisites

- Portainer CE or Business, version ≥ 2.19
- A Docker host with internet access (needs to pull `ghcr.io/christerfrestad/familyassistant:main`)
- A volume or host directory that Portainer can mount at `/app/data`
- (Optional) Ollama running on the host or as a separate container for LLM features
- (If the GHCR package is private) a GitHub Personal Access Token with `read:packages` scope, registered under Portainer → **Registries** → **Custom registry** → `ghcr.io`

### 16.2 Create the stack

Two equally valid modes.

**Option A — Web editor (simplest, recommended)**

1. Portainer → **Stacks** → **+ Add stack**
2. Name: `familyassistant`
3. Build method: **Web editor**
4. Paste the contents of `docker-compose.yml` from the repo root
5. Leave **Environment variables** empty
6. **Deploy the stack**

**Option B — Repository (GitOps, auto-pull every 60 min)**

1. Portainer → **Stacks** → **+ Add stack**
2. Name: `familyassistant`
3. Build method: **Repository**
4. Repository URL: `https://github.com/ChristerFrestad/FamilyAssistant`
5. Repository reference: `refs/heads/main`
6. Compose path: `docker-compose.yml`
7. Authentication: on (username + PAT with `repo` scope) only if the repo is private
8. Leave **Environment variables** empty
9. **Deploy the stack**

> Do not use Portainer's "Use custom template variables (`.env`)" field on the first deploy — the stack is designed to start with zero variables and walk you through setup in the UI.

### 16.3 First-run setup

1. Wait until the container shows **Running** (≈ 15 seconds). Portainer → **Containers** → `familieassistenten`.
2. Check the logs for the bootstrap signal. Portainer → container → **Logs**. You should see a line like:
   ```
   🔧 BOOTSTRAP MODE ACTIVE — open http://<host>:7777/setup.html to finish setup.
   ```
3. Open `http://<docker-host>:7777/setup.html` in a browser (replace `<docker-host>` with the host's LAN IP or hostname).
   - Port 7777 is chosen as the default because 3000 is routinely taken by Grafana and generic Node apps on self-host machines. Both the internal container port and the host mapping use 7777, so the URL is consistent.
   - Collision caveat: Ombi also defaults to 7777. If you run Ombi, override the host-side mapping by editing the stack compose (`"8765:7777"` for example).
4. Fill in the form:
   - **Auth token**: click **Generate** (a 32-hex value from the server). Copy it now — it is shown once.
   - **Allowed origins**: your real origin, e.g. `http://raspberrypi.local:7777` or `http://192.168.1.50:7777`. Do not use `*` — it is rejected.
   - **LLM backend**: Ollama (default) or llama.cpp.
   - **Ollama host**: default `http://host.docker.internal:11434` works if Ollama runs on the Docker host.
   - **Log level**: `info` (default).
5. Click **Complete setup**.
6. The container restarts automatically (≈ 10 seconds). The browser auto-reloads once `/health` is back.

Everything you entered is persisted to `/app/data/bootstrap.json` with 0600 permissions. Next boot reads from there and the server runs in normal production mode with your generated token.

### 16.4 Activate Caddy (optional, HTTPS)

The Caddy service is gated behind the compose profile `production` so it does not start before bootstrap. Once you are ready:

1. Edit `Caddyfile` (in the repo root) with your domain.
2. Portainer → **Stacks** → your stack → **Editor** (Web editor mode) or commit a change in Repository mode.
3. Add a stack-level environment variable `HTTPS_TERMINATED=true`.
4. Activate the `production` profile. The Web editor does not expose compose profiles, so easiest is to either:
   - Delete the `profiles: - production` line from the Caddy service in the stack editor, or
   - Add Caddy as a separate stack that reverse-proxies to this one.

### 16.5 Recovering a broken or stuck deploy

If the stack is in a crash loop, shows blank **Published Ports**, or repeats `AUTH_TOKEN er påkrevd` in the logs, you are most likely running a stale cached image. Portainer CE cannot force-pull a fresh image without recreating the stack, so:

1. Portainer → **Stacks** → your stack → **Delete stack**. Tick **Remove volumes** if the option is offered.
2. Portainer → **Images** → search for `ghcr.io/christerfrestad/familyassistant` → remove every tag you find.
3. Portainer → **Volumes** → remove any volume whose name contains `familyassistant` or `familieassistenten`.
4. Go back to §16.2 and create the stack from scratch. The new stack will force-pull `:main` because of `pull_policy: always`.

### 16.6 Switching to manual AUTH_TOKEN handling

If you later want to manage the token via Portainer variables instead of the persisted `bootstrap.json`:

1. Portainer → your stack → **Editor**.
2. Add `AUTH_TOKEN=<your-token>` to **Environment variables**.
3. **Update the stack**.
4. Environment variables take precedence over `bootstrap.json`, so the persisted value is ignored (but the file stays on disk as a fallback).
5. To fully remove the persisted copy you need shell access: `docker exec --user root familieassistenten rm /app/data/bootstrap.json`.

### 16.7 Troubleshooting

| Symptom | Cause + fix |
|---|---|
| `Failed to deploy a stack: ... address already in use 0.0.0.0:7777/tcp` | Another process or container already listens on 7777. Edit the stack compose and change the host-side mapping (`"8765:7777"`), then redeploy. |
| `failed to resolve reference "ghcr.io/.../familyassistant:latest": 403 Forbidden` | Either the `:latest` tag does not exist (only v-tags emit it) or the Portainer registry credentials are missing. Set `TAG=main` as a stack variable, or register a GHCR PAT under Portainer → Registries. |
| Container shows **Running** but **Published Ports** is empty | The container is crash-looping and never stabilises long enough for Docker to bind ports. Check the logs for the real error (usually a stale image). Follow §16.5 to force a clean redeploy. |
| `required variable AUTH_TOKEN is missing a value` during `compose up` | You are on a pre-phase-22 compose file that still had `${AUTH_TOKEN:?}`-required syntax. Pull the latest `docker-compose.yml` from the repo. |
| `/setup.html` returns 503 or 404 | The container is not in BOOTSTRAP_MODE. Check the logs for the `🔧 BOOTSTRAP MODE ACTIVE` line. If it is absent, the data volume has a leftover `familieassistenten.db` from a previous run. Follow §16.5. |
| `Complete setup` returns 409 conflict | Two setup requests raced. Reload `/setup.html` — the wizard will detect that `bootstrap.json` now exists and redirect to the main app. |
| Container fails to start after bootstrap | The data volume is not writable by UID 65532 (distroless `nonroot`). Shell access required: `docker exec --user root familieassistenten chown -R 65532:65532 /app/data`. |
| `host.docker.internal` does not resolve on Linux | Linux Docker ≥ 20.10 is required. The compose file adds `extra_hosts: host.docker.internal:host-gateway` which only works on that version. Upgrade Docker. |
