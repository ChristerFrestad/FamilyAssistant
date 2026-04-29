# Familieassistenten v1.2 — Deploy på Raspberry Pi 5

> **Stier i dette dokumentet** bruker `$APP_ROOT` som plassholder.
> Standard: `export APP_ROOT=$APP_ROOT`

> ## ⚠️ Produksjons-krav (M1)
>
> Før du setter `NODE_ENV=production` må følgende være på plass:
>
> 1. **`AUTH_TOKEN`** (minst 16, helst 32 tegn) — serveren nekter oppstart uten den i prod.
>    Generer: `openssl rand -hex 32`
> 2. **`ALLOWED_ORIGINS`** — komma-separert liste over tillatte origins.
>    `*` er ikke tillatt i prod. Eksempel: `https://familieassistenten.local,https://raspberrypi.local`
> 3. **HTTPS via Caddy** — se seksjon 13 under. Sett `HTTPS_TERMINATED=true` i environment
>    så serveren legger til `Strict-Transport-Security`-header.
> 4. **API-nøkler i .env** (ikke i systemd!) — fil-permissions `chmod 600 .env`,
>    eier `pi:pi`. Nøkler settes via Settings-UI som skriver via env-store.service.


## 1. Kopier filene

```bash
scp -r Familieassistenten/ pi@raspberrypi.local:~
```

## 2. Installer Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 3. Installer SQLite-støtte (anbefalt)

```bash
cd $APP_ROOT
npm init -y
npm install better-sqlite3
# Eller om bedre-sqlite3 feiler:
npm install sql.js
```

Uten SQLite bruker serveren JSON-fallback (fungerer, men tregere og ingen vektorsøk).

## 4. Start manuelt (for testing)

```bash
cd $APP_ROOT
chmod +x start.sh
./start.sh
```

Åpne `http://raspberrypi.local:3000` for å sjekke at det fungerer.

## 5. Automatisk oppstart (systemd)

```bash
sudo cp familieassistenten.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable familieassistenten
sudo systemctl start familieassistenten
```

Sjekk status: `sudo systemctl status familieassistenten`
Se logger: `journalctl -u familieassistenten -f`

## 6. LLM-oppsett

### Alternativ A: Ollama (enklest)

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:3b
```

### Alternativ B: llama.cpp (raskere, lavere RAM)

```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp && make -j4 GGML_VULKAN=1  # Vulkan for GPU-akselerasjon
# Last ned Qwen2.5-3B i GGUF-format:
wget https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf

# Start server:
./llama-server -m qwen2.5-3b-instruct-q4_k_m.gguf \
  -c 3072 -t 3 --host 0.0.0.0 --port 8080
```

Sett `LLM_BACKEND=llamacpp` i `.env` eller systemd-service.

### Modellvalg for RPI5 8GB

| Modell | RAM | Hastighet | Anbefalt? |
|--------|-----|-----------|-----------|
| qwen2.5:1.5b | ~1.2 GB | 15-25 t/s | Rask, enklere svar |
| qwen2.5:3b | ~2.5 GB | 8-15 t/s | Beste balanse for 8GB |
| qwen2.5:7b | ~5 GB | 3-8 t/s | Best kvalitet, risikerer swap |

Standard er `qwen2.5:3b`. Endre via `OLLAMA_MODEL` i environment.

## 7. STT/Stemmegjenkjenning (valgfritt)

### whisper.cpp (anbefalt for offline norsk)

```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make -j4

# Last ned NB-Whisper (norsk-optimalisert):
wget https://huggingface.co/NbAiLab/nb-whisper-base/resolve/main/ggml-model.bin \
  -O models/ggml-nb-whisper-base.bin

# Installer ffmpeg (for lydkonvertering):
sudo apt install -y ffmpeg
```

Sett i `.env` eller systemd:
```
WHISPER_CPP_PATH=/opt/whisper.cpp/main
WHISPER_MODEL_PATH=/opt/whisper.cpp/models/ggml-nb-whisper-base.bin
```

Uten whisper.cpp brukes nettleserens Web Speech API (krever internett).

## 8. Miljøvariabler

Opprett `$APP_ROOT/.env` eller sett i systemd:

```bash
PORT=3000
LLM_BACKEND=ollama          # eller 'llamacpp'
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
LLAMACPP_HOST=http://localhost:8080
MAX_CONTEXT_TOKENS=3072
STT_BACKEND=whisper_cpp
WHISPER_CPP_PATH=/opt/whisper.cpp/main
WHISPER_MODEL_PATH=/opt/whisper.cpp/models/ggml-nb-whisper-base.bin
WHISPER_THREADS=3
```

## 9. iPhone-snarvei

1. Åpne Safari på iPhone
2. Gå til `http://raspberrypi.local:3000`
3. Trykk Del-knappen > "Legg til på Hjem-skjerm"
4. Navn: "Familieassistenten"

## 10. Tilgang utenfor hjemmet

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

## 11. RAM-optimalisering

Anbefalt oppsett for å unngå swapping:

```bash
# Aktiver zram (komprimert swap)
sudo apt install -y zram-tools
echo 'ALGO=zstd' | sudo tee /etc/default/zramswap
echo 'PERCENT=50' | sudo tee -a /etc/default/zramswap
sudo systemctl restart zramswap

# Begrens GPU-minne (frigjør RAM)
echo 'gpu_mem=64' | sudo tee -a /boot/config.txt
sudo reboot
```

Typisk RAM-bruk med alt kjørende:
- OS + systemd: ~800 MB
- Node.js server: ~100 MB
- Ollama + qwen2.5:3b: ~2.5 GB
- whisper.cpp (on-demand): ~400 MB (bare under transkribering)
- Totalt: ~3.8 GB — godt innenfor 8 GB

## 13. HTTPS via Caddy (M1.6 — obligatorisk før ekstern tilgang)

Familieassistenten eksponerer sensitive data (familiekalender, handleliste, LLM-chat).
Ren HTTP er ikke akseptabelt utenfor et strengt LAN. Bruk Caddy som reverse proxy
foran Node-serveren på port 3000.

### 13.1 Installer Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 13.2 Installer Caddyfile

```bash
sudo cp $APP_ROOT/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddyfile har 3 alternativer — **A) LAN-only med intern CA (anbefalt for familie)**,
B) Tailscale Serve, C) public domain. Rediger filen og kommenter ut de du ikke bruker.

### 13.3 Installer Caddys rot-sertifikat på iPhone

Alternativ A bruker Caddys lokale CA. iPhone må godkjenne rot-sertifikatet én gang:

```bash
# På RPi5:
sudo caddy trust
sudo cp /etc/caddy/pki/authorities/local/root.crt ~/caddy-root.crt
```

Kopier `~/caddy-root.crt` til iPhone (AirDrop/mail), åpne det, og:
**Innstillinger → Profiler → Godkjenn → Innstillinger → Generelt → VPN og enhetsadministrering → Sertifikat-innstillinger → Slå på "Familieassistenten"**.

Etter dette åpner du `https://familieassistenten.local` i Safari og får grønt hengelåsikon.

### 13.4 Oppdater systemd med prod-env

Legg til i `/etc/systemd/system/familieassistenten.service`:

```ini
Environment=NODE_ENV=production
Environment=HTTPS_TERMINATED=true
Environment=ALLOWED_ORIGINS=https://familieassistenten.local,https://raspberrypi.local
Environment=AUTH_TOKEN=<generert-32-hex-tegn>
```

Generer token:
```bash
openssl rand -hex 32
```

`sudo systemctl daemon-reload && sudo systemctl restart familieassistenten`.
Sjekk at oppstarten lykkes — serveren avviser ugyldig config med tydelig feilmelding.

### 13.5 Verifiser HTTPS + auth

```bash
# 1. HTTPS med gyldig cert (etter rot-cert er installert)
curl -I https://familieassistenten.local/health
# Forvent: 200 OK, Strict-Transport-Security, Content-Security-Policy

# 2. API krever token
curl -I https://familieassistenten.local/api/today
# Forvent: 401 Unauthorized

curl -H "Authorization: Bearer <token>" https://familieassistenten.local/api/today
# Forvent: 200 OK med data

# 3. /health og /ready er åpne (for monitoring)
curl https://familieassistenten.local/ready
# Forvent: 200 OK uten token
```

### 13.6 Brannmur — ikke eksponer port 3000 direkte

```bash
sudo ufw allow 443/tcp    # HTTPS
sudo ufw allow 80/tcp     # HTTP redirect → HTTPS
sudo ufw deny 3000/tcp    # Node kun via Caddy
sudo ufw enable
```

---

## 12. Oppgradering: Hailo AI HAT+

For betydelig raskere LLM:

```bash
sudo apt install hailo-all
# Gir opptil 26 TOPS akselerasjon
# Se: https://www.raspberrypi.com/products/ai-hat-plus/
```

## Feilsøking

- **Server starter ikke:** `journalctl -u familieassistenten -f`
- **LLM treg:** Bytt til qwen2.5:1.5b, eller bruk llama.cpp med Q4_K_M quant
- **STT fungerer ikke:** Sjekk at ffmpeg er installert, whisper.cpp-binaryen finnes
- **Kan ikke nå fra iPhone:** `sudo ufw allow 3000`
- **Database resett:** Slett `data/familieassistenten.db` (eller `.json`) og start på nytt
- **Migrering:** Gammel JSON-database migreres automatisk til SQLite ved oppstart

---

## 14. Docker-deployment (uke 7 PORT-6)

Familieassistenten leveres som et ferdig multiarch Docker-image på
GitHub Container Registry. Dette er anbefalt deployment-metode for
nye installasjoner på RPi5 — enklere enn systemd + manuell npm install.

### 14.1 Forutsetninger

```bash
# Installer Docker Engine og Docker Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log ut og inn igjen for å aktivere group membership

# Verifiser
docker --version
docker compose version
```

### 14.2 Rask start

```bash
# Clone repo for Caddyfile + docker-compose.yml + .env.example
git clone https://github.com/ChristerFrestad/FamilyAssistant.git
cd FamilyAssistant

# Lag produksjons-config
cp .env.example .env
nano .env
# Sett minimum:
#   AUTH_TOKEN=<output av openssl rand -hex 32>
#   ALLOWED_ORIGINS=https://familieassistenten.local
#   AUTH_TOKEN_CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Opprett data-mappe
mkdir -p data

# Start
docker compose up -d

# Verifiser
docker compose ps
curl -sf http://localhost:3000/health && echo " — OK"
```

Appen er nå på `http://localhost:3000` og Caddy serverer HTTPS på
`https://familieassistenten.local` (hvis mDNS er satt opp).

### 14.3 Oppgradering

```bash
cd ~/FamilyAssistant
docker compose pull     # Hent siste image fra ghcr.io
docker compose up -d    # Restart med nytt image
docker compose logs -f app  # Følg loggene i 1 min
```

Dataene i `./data/` beholdes på tvers av oppgraderinger. DB-migrasjoner
kjøres automatisk ved oppstart.

### 14.4 Backup / restore via Docker

```bash
# Backup mens app kjører (bruker SQLite online-backup)
docker compose exec app /nodejs/bin/node -e "
  const { initDB } = require('./server/db');
  const { backupNow } = require('./server/backup');
  (async () => {
    const h = await initDB();
    console.log(backupNow(h.db));
  })();
"

# Siste backup ligger i ./data/backups/
ls -lh data/backups/

# Restore — stopp app, kopier backup, start app
docker compose stop app
cp data/backups/familieassistenten-2026-04-11.db data/familieassistenten.db
docker compose start app
```

### 14.5 Bruker `install.sh --docker`

Alternativt kan du bruke installasjonsscriptet som gjør alt ovenfor:

```bash
curl -fsSL https://raw.githubusercontent.com/ChristerFrestad/FamilyAssistant/main/install.sh | bash -s -- --docker

# Eller lokalt etter clone:
sudo ./install.sh --docker
```

Scriptet:
- Installerer Docker Engine hvis det mangler
- Genererer AUTH_TOKEN automatisk
- Lager `.env` med fornuftige defaults
- Starter `docker compose up -d`
- Verifiserer `/health`

### 14.6 Troubleshooting Docker

**Container restarter i loop:**
```bash
docker compose logs app --tail 100
# Se etter: AUTH_TOKEN, ALLOWED_ORIGINS, DB-path
```

**Kan ikke nå Ollama på host:**
- Linux: Sett `OLLAMA_HOST=http://host.docker.internal:11434`
  (docker-compose.yml har `host-gateway` mapping)
- macOS / Windows: Samme, `host.docker.internal` fungerer by default

**Permission denied på data-mappe:**
```bash
# Distroless bruker UID 65532 (nonroot)
sudo chown -R 65532:65532 data/
```

**Oppgrader multiarch-image til ARM64 manuelt:**
```bash
docker pull --platform linux/arm64 ghcr.io/christerfrestad/familyassistant:latest
```

### 14.7 systemd ELLER Docker — aldri begge

Velg én metode. Hvis du tidligere brukte `familieassistenten.service`,
stopp og deaktiver den før du går over til Docker:

```bash
sudo systemctl stop familieassistenten
sudo systemctl disable familieassistenten
sudo rm /etc/systemd/system/familieassistenten.service
sudo systemctl daemon-reload
```

Ikke slett data-mappen — Docker-varianten bruker samme SQLite-fil.

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

