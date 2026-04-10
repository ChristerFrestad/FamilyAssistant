# Familieassistenten v1.2 — Deploy på Raspberry Pi 5

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
scp -r Familieassistenten/ pi@raspberrypi.local:/home/pi/
```

## 2. Installer Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 3. Installer SQLite-støtte (anbefalt)

```bash
cd /home/pi/Familieassistenten
npm init -y
npm install better-sqlite3
# Eller om bedre-sqlite3 feiler:
npm install sql.js
```

Uten SQLite bruker serveren JSON-fallback (fungerer, men tregere og ingen vektorsøk).

## 4. Start manuelt (for testing)

```bash
cd /home/pi/Familieassistenten
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

Opprett `/home/pi/Familieassistenten/.env` eller sett i systemd:

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
sudo cp /home/pi/Familieassistenten/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddyfile har 3 alternativer — **A) LAN-only med intern CA (anbefalt for familie)**,
B) Tailscale Serve, C) public domain. Rediger filen og kommenter ut de du ikke bruker.

### 13.3 Installer Caddys rot-sertifikat på iPhone

Alternativ A bruker Caddys lokale CA. iPhone må godkjenne rot-sertifikatet én gang:

```bash
# På RPi5:
sudo caddy trust
sudo cp /etc/caddy/pki/authorities/local/root.crt /home/pi/caddy-root.crt
```

Kopier `/home/pi/caddy-root.crt` til iPhone (AirDrop/mail), åpne det, og:
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
