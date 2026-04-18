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

### 14.8 Portainer-deploy på RPi5

Portainer CE er et vanlig valg for å administrere Docker på RPi5 via et web-UI.
Denne seksjonen dekker deploy av Familieassistenten som en Portainer **Stack**.

> ⚠️ **Viktig:** Portainer leser **ikke** `.env`-filen automatisk når en stack
> deployes fra Git eller en innlimt compose-fil. `docker-compose.yml` bruker
> `${AUTH_TOKEN:?…}`-syntaks som krever at variabelen er satt **før** compose
> interpolerer. Alle påkrevde env-variabler må legges inn i Portainer-UI-et.
>
> Typisk feilmelding hvis dette glemmes:
> ```
> error while interpolating services.app.environment.AUTH_TOKEN:
> required variable AUTH_TOKEN is missing a value:
> AUTH_TOKEN er påkrevd i prod (min 16 tegn)
> ```

#### 14.8.1 Forutsetninger

- Docker Engine og Portainer CE allerede installert og kjører på RPi5
  (f.eks. via `docker run -d -p 9443:9443 portainer/portainer-ce:latest`).
- SSH-tilgang til RPi5 for å opprette `./data`-mappen med riktige permissions.

#### 14.8.2 Forbered host

På RPi5 via SSH, opprett dataområdet med eierskap som matcher distroless-brukeren
(UID 65532 — samme som §14.6):

```bash
sudo mkdir -p /opt/familieassistenten/data
sudo chown -R 65532:65532 /opt/familieassistenten/data
```

Banen kan være fritt valgt — sørg for at `./data`-mount-en i stacken refererer
til samme sti hvis du redigerer compose-filen.

#### 14.8.3 Generer AUTH_TOKEN

Kjør på en trygg maskin (ikke lim inn en token fra nettet):

```bash
openssl rand -hex 32
```

Kopier outputen — den settes i neste steg.

#### 14.8.4 Opprett stack i Portainer

1. **Stacks** → **+ Add stack**.
2. **Name:** `familieassistenten`.
3. **Build method** — velg én:
   - **Repository** (anbefalt): Repository URL
     `https://github.com/ChristerFrestad/FamilyAssistant`, Reference `refs/heads/main`,
     Compose path `docker-compose.yml`.
   - **Web editor:** lim inn innholdet av `docker-compose.yml` direkte.
4. **Environment variables** — klikk **+ add environment variable** for hver:

   | Navn | Verdi | Notat |
   |------|-------|-------|
   | `AUTH_TOKEN` | (output av `openssl rand -hex 32`) | Påkrevd, min 16 tegn |
   | `ALLOWED_ORIGINS` | `https://familieassistenten.local` | Eller din RPi-hostname |
   | `AUTH_TOKEN_CREATED_AT` | (output av `date -u +%Y-%m-%dT%H:%M:%SZ`) | Timestamp for token-rotasjon |
   | `TAG` | `latest` | Eller pinnet versjon, f.eks. `v1.3.0` |
   | `OLLAMA_HOST` | `http://host.docker.internal:11434` | Valgfri — hvis Ollama kjører på host |
   | `OLLAMA_MODEL` | `qwen2.5:3b` | Valgfri |
   | `LOG_LEVEL` | `info` | Valgfri |

5. **Deploy the stack**.

#### 14.8.5 Caddy-merknad

Stacken inkluderer `caddy` på port 80/443. Hvis RPi-hosten allerede har en
reverse proxy (nginx, Traefik, eller en annen Caddy), må du enten:

- Fjerne `caddy`-tjenesten fra compose-filen før deploy, eller
- Endre port-mappingen i `caddy`-tjenesten til ledige porter.

Ellers vil Portainer rapportere port-konflikt ved oppstart.

#### 14.8.6 Verifikasjon

Etter deploy:

- **Portainer** → **Containers** → `familieassistenten` → **Logs** — sjekk at
  serveren starter uten `AUTH_TOKEN`-feil.
- Fra RPi-host eller LAN:
  ```bash
  curl -sf http://<rpi-ip>:3000/health && echo " — OK"
  curl -H "Authorization: Bearer <token>" http://<rpi-ip>:3000/api/today
  ```
- Hvis Caddy er aktiv: `curl -I https://familieassistenten.local/health`.

#### 14.8.7 Oppgradering via Portainer

- **Stacks** → `familieassistenten` → **Pull and redeploy** (Git-metode), eller
- Oppdater `TAG` env-variabel til ny versjon og klikk **Update the stack**.

Data i `./data/` beholdes så lenge volumet ikke slettes.

---

## 15. Deploy på Railway (sky, multi-tenant)

Railway-deploy er for sky-instansen som støtter flere familier med Google OAuth og magic-link-innlogging. RPi-deployen fra §1–13 er helt separat — samme kodebase, annen config.

### 15.1 Forutsetninger

- Railway-konto med et nytt prosjekt.
- Eget domene (f.eks. `appdomene.no`). DNS-administrator tilgjengelig.
- Google Cloud Console-prosjekt for OAuth-credentials.
- Resend-konto for magic-link-e-post (gratis tier dekker ~100 e-post/døgn).
- Valgfritt: Sentry-prosjekt for observability, Backblaze B2 for off-site backup.

### 15.2 railway.json

Repoet har allerede `railway.json` i rot:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": {
    "startCommand": "node server/index.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 10,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "numReplicas": 1
  }
}
```

Railway bygger fra `Dockerfile`, sjekker `/health` hvert 30. sekund og restarter opp til 10 ganger ved feil.

### 15.3 Volume

1. Railway → `Settings` → `Volumes` → `+ Create Volume`.
2. Mount path: `/app/data` (matcher `DB_PATH` og `BACKUP_DIR` i Dockerfile-env).
3. Størrelse: 1 GB holder lenge for ~50 familier.

### 15.4 Env-variabler

Sett alle disse i Railway → `Variables`. Bruk `openssl rand -hex 32` for hemmeligheter.

| Variabel | Verdi | Kommentar |
|----------|-------|-----------|
| `NODE_ENV` | `production` | |
| `APP_URL` | `https://appdomene.no` | Uten trailing slash |
| `ALLOWED_ORIGINS` | Samme som `APP_URL` | |
| `SESSION_SECRET` | 32 bytes hex | |
| `ENCRYPTION_KEY` | 32 bytes hex | Må ikke være lik `SESSION_SECRET` |
| `GOOGLE_CLIENT_ID` | Fra Google Console | |
| `GOOGLE_CLIENT_SECRET` | Fra Google Console | |
| `RESEND_API_KEY` | Fra Resend dashboard | |
| `RESEND_FROM` | `noreply@appdomene.no` | Krever verifisert domene |
| `HTTPS_TERMINATED` | `true` | Railway terminerer TLS |
| `TRUST_PROXY` | `true` | Les X-Forwarded-For for riktig klient-IP |
| `SENTRY_DSN` | (valgfri) | Trigger install av `@sentry/node` |
| `SENTRY_ENVIRONMENT` | `production` | |

**Ikke sett** `AUTH_TOKEN` i sky — server bruker sessions i stedet. Hvis den er satt aksepteres den for lokal-verktøy (curl/health-probes), men det er ikke nødvendig.

### 15.5 Google OAuth redirect

1. Google Cloud Console → `APIs & Services` → `Credentials` → din OAuth-client.
2. `Authorized redirect URIs` → legg til `${APP_URL}/api/auth/google/callback` (eksakt match, uten trailing slash).
3. `Authorized JavaScript origins` → `${APP_URL}`.
4. Scope: `openid email profile`. Ingen andre.

### 15.6 Resend DNS

Resend krever SPF + DKIM før din FROM-adresse kan sende. I domene-registraren (Cloudflare, Domeneshop, GoDaddy):

| Type | Name | Value |
|------|------|-------|
| TXT | `@` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | (Resend genererer dette — kopier fra dashbordet) |
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` prio 10 |

Propagering tar 5–60 min. Verifiser i Resend dashbordet før deploy.

### 15.7 Backup til Backblaze B2 (valgfritt)

Daglig off-site backup lagrer database-snapshots eksternt.

1. Lag Backblaze-konto og bucket `familieassistenten-backup`.
2. Lag en Application Key med `listFiles`, `readFiles`, `writeFiles`.
3. Railway scheduled job (Cron plugin eller Railway-Scheduler-service):
   ```bash
   sqlite3 /app/data/familieassistenten.db ".backup /tmp/backup.db" \
     && rclone copy /tmp/backup.db b2:familieassistenten-backup/$(date +%F).db
   ```
4. Sett bucket lifecycle policy: slett objekter eldre enn 7 dager.

Alternativt: la app-intern backup kjøre som i RPi-versjonen, og sett `BACKUP_REMOTE_PATH=user@jump-host:/backups/familieassistenten` hvis du har en jumpbox.

### 15.8 Sentry (valgfri, phase 17)

Hvis du vil ha observability:

1. Opprett Sentry-prosjekt (Node.js).
2. Legg til `SENTRY_DSN` i Railway env.
3. Sørg for at `@sentry/node` er installert i build — Dockerfile sitter på `npm ci --omit=dev`, og pakken er allerede i `optionalDependencies`. Railway installerer den automatisk.
4. Sentry initialiseres ved oppstart (`server/observability/sentry.js`). Unntak scrubbes aggressivt — ingen e-post, ingen request-body. Se `server/observability/sentry.js` for scrub-reglene.

### 15.9 Første deploy

**Alternativ A — Railway GitHub App (raskest):**
```bash
git push origin main
```
Railway bygger automatisk hvis du har koblet GitHub-repoet i Railway-dashbordet. Følg loggen.

**Alternativ B — GitHub Actions workflow (phase 19):**

`.github/workflows/deploy.yml` deployer automatisk etter at `CI` passerer på `main`. Oppsett:

1. Railway → `Account Settings` → `Tokens` → generer en Project Token.
2. GitHub repo → `Settings` → `Secrets and variables` → `Actions`:
   - Secret: `RAILWAY_TOKEN` = tokenet fra steg 1.
   - Variable (valgfri): `APP_URL` = `https://appdomene.no`. Deploy-jobben pinger `/health` etter deploy hvis denne er satt.
3. Push til main. CI kjører; ved grønn trigger `Deploy to Railway`-workflow via `workflow_run`-event. Konkurrerende deploys cancelleres automatisk.

Manuell deploy: GitHub → `Actions` → `Deploy to Railway` → `Run workflow`.

Ved feil — sjekk Variables og Volume først. Workflow feiler fast hvis `RAILWAY_TOKEN` mangler.

### 15.10 Verifisering

- Åpne `${APP_URL}` → login-siden skal laste.
- Åpne `${APP_URL}/health` → `{"status":"ok"}`.
- Åpne `${APP_URL}/privacy.html` → statisk side uten auth.
- Logg inn med Google → ny bruker skal redirectes til `/onboarding.html` (3-stegs wizard).
- Sjekk Railway-loggen: `Sentry initialized` om DSN er satt, og daglig backup-linje neste natt.

### 15.11 Custom domene

1. Kjøp domene hos registrar.
2. Railway → `Settings` → `Domains` → `+ Custom Domain` → følg CNAME-instruksjonene.
3. Oppdater `APP_URL`, `ALLOWED_ORIGINS`, Google redirect URI, og Resend FROM-adressen.
4. Redeploy.

### 15.12 Rollback

Railway → `Deployments` → velg forrige vellykkede deploy → `Redeploy`. Databasen i volumet blir ikke rørt — kun appen rulles tilbake.

