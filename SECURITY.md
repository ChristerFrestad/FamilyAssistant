# Security Policy

**Last updated:** 2026-04-10
**Applies to:** Familieassistenten v1.2.0+

Familieassistenten er designet for bruk på et privat hjemmenett, typisk på
en Raspberry Pi 5 bak en router. Sikkerhetsmodellen reflekterer dette: vi
forsvarer mot tilfeldig ondsinnet trafikk og promptinjeksjoner, ikke mot
statsaktører.

---

## 1. Trusselmodell (STRIDE)

| Kategori | Trussel | Mitigasjon |
|---|---|---|
| **S**poofing | Uautorisert klient på LAN | `AUTH_TOKEN` (≥16 tegn) obligatorisk i produksjon, bearer auth på alle `/api/*` unntatt `/health`, `/ready`, `/metrics` |
| | Caddy serverer feil sertifikat | Caddy intern CA, `caddy trust` installerer rot-cert lokalt |
| | Angriper på offentlig nett | Tailscale Serve eller Let's Encrypt for ekstern tilgang |
| **T**ampering | XSS via recipe-import / LLM | `escapeHtml` i alle `innerHTML`, CSP `script-src 'self' 'unsafe-inline'`, backend `sanitizeString` trimmer tags/control chars |
| | Prompt-injection i LLM-kontekst | `sanitizeForPrompt` fjerner "ignore previous", rolle-hijack, kontrolltegn |
| | Modifisering av lokal DB | SQLite-fil eid av `pi:pi` med `0644`, systemd `ReadWritePaths` begrenser til `data/` |
| | MITM på LAN | HTTPS via Caddy, HSTS når `HTTPS_TERMINATED=true` |
| **R**epudiation | Uklart hvem som gjorde hva | `requestId` i alle log-linjer + problem-body, men single-user på dette nivået |
| **I**nformation disclosure | API-nøkkel i loggen | `pino` redact-paths for `KASSAL_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `AUTH_TOKEN`, `Authorization`-header, `cookie` |
| | `.env`-fil lest av annen bruker | systemd `User=pi`, `.env` settes til `0600 pi:pi` i installasjonsscriptet |
| | Env-nøkler returnert i `/api/settings/env` | `readMasked()` returnerer `●●●●●●●●●•XYZW` — aldri klartekst |
| | Error-traces lekker detaljer i prod | `server/http/server.js` masker interne meldinger til "Intern feil" når `NODE_ENV=production` |
| **D**enial of service | Flood av requests | `RATE_LIMIT_MAX=300`/min per IP (default), Caddy `request_body { max_size 5MB }` |
| | Henger på ekstern backend | Circuit breakers på ollama (3 fails, 30s cooldown), kassal/anthropic (5, 60s) |
| | Uendelig backup-loop | Schedule-driven, én gang per 24t, prune etter 14 dager |
| | Massive payloads | `MAX_BODY_BYTES=1MB` (configurable) |
| **E**levation of privilege | systemd prosess kompromittert | `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp`, `PrivateDevices`, `ProtectKernel*`, `RestrictSUIDSGID` |
| | Symbolic link attack | `ReadWritePaths=/home/pi/Familieassistenten/data` — DB-filen er eneste skriving |

---

## 2. Sensitiv data i prosjektet

Dette er data som finnes i produksjonsinstallasjonen og krever ekstra vare:

- **API-nøkler** (Kassal, OpenAI, Anthropic, xAI) — lagres i `.env`,
  permissions `0600`, aldri logged. Kan settes/rotert via Settings-UI
  som skriver via `env-store.service` med atomic write + backup.
- **AUTH_TOKEN** — systemd environment (`systemctl edit`) eller separate
  `/etc/familieassistenten.env`. Minimum 32 hex-tegn (`openssl rand -hex 32`).
- **Familiedata** — medlemmer, allergier, mislikt mat, handlemønster,
  LLM-chat-historikk. Alt ligger i SQLite-filen `data/familieassistenten.db`.
  Backup-filer krypteres ikke (hjemme-nett only) — bruk `rsync` over SSH
  for off-site og stol på SSH-nøkkelen, eller manuell GPG-kryptering.
- **Kvitteringer + OCR-tekst** — tekst-ekstrakter kan inneholde navn/adresser.
  Lagres i `receipts`-tabellen, samme sensitivitet som DB ellers.

## 3. Kjente svakheter og trade-offs

Disse er akseptert risiko, dokumentert her så nye utviklere forstår:

- **CSP har `'unsafe-inline'` for script** — `public/index.html` er én stor
  fil med inline-handlers (`onclick="..."`). Planen var å modularisere i M5,
  men ble utsatt til v1.3 for å unngå blast radius av en 3700-linje refaktor.
  `escapeHtml`-helperen gir bunden sikkerhet selv uten nonce/hash-baserte CSP.
- **Ingen audit-logg** — mutasjoner på `/api/*` logges i pino, men det finnes
  ingen separat audit-tabell for å kunne rekonstruere "hvem endret hva, når".
  OK for single-family-bruk.
- **Rate-limit er in-memory** — nullstilles ved restart, ikke delt mellom
  noder. Akseptabelt for single-node RPi5.
- **Ingen 2FA** — kun bearer-token. Token-kompromittering gir full tilgang.
- **`sw.js` bufrer API GET-responses** — inneholder ikke-sensitive data
  (meal plans, chores) men en fysisk enhet med cache-tilgang kan lese
  gammel data. Scope er samme device, så samme risiko som DB-tilgangen.

## 4. Oppdaterings-policy

- **Node.js**: hold på siste LTS (20.x p.t.). Sjekk `package.json#engines`.
- **better-sqlite3**: oppdateres ved større Node-versjoner. Fallback til
  `sql.js` hvis kompilering feiler.
- **zod, pino, pino-pretty**: patch-level fra time til time, minor-level
  månedlig hvis endringslog er ren.
- **Avhengigheter fra Caddy/Ollama/whisper.cpp**: operatør holder disse
  oppdatert separat via `apt` / releases.

Sjekk utdaterte pakker:
```bash
cd /home/pi/Familieassistenten
npm outdated
# Pr. v1.2 holder vi oss til stabile minor-versjoner og patcher
# CVE-er innen 7 dager.
```

## 5. Rapporter en sikkerhetssvakhet

Familieassistenten er et privat prosjekt, ikke en offentlig tjeneste.
Hvis du er en del av familien eller en tidligere utvikler som finner
noe bekymringsverdig:

1. **Ikke** åpne en public GitHub-issue med tekniske detaljer.
2. Send en privat melding til prosjektets eier med:
   - Hva du observerte
   - Hvordan du reproduserte det
   - Hvilken versjon (commit-hash fra `git rev-parse HEAD`)
3. Responstid: vi målfører innen 48 timer, fix innen 7 dager for
   kritiske funn.

For public GitHub-repo (`ChristerFrestad/FamilyAssistant`), bruk
GitHub Security Advisories (private disclosures) hvis den funksjonen er
aktivert.

## 6. Sikkerhets-sjekkliste før deploy

Kjør gjennom denne før `systemctl start familieassistenten` i prod:

- [ ] `NODE_ENV=production` satt
- [ ] `AUTH_TOKEN` generert med `openssl rand -hex 32`
- [ ] `ALLOWED_ORIGINS` satt til konkrete host-verdier (ikke `*`)
- [ ] `.env` har `chmod 600` og `chown pi:pi`
- [ ] `HTTPS_TERMINATED=true` hvis bak Caddy
- [ ] `BACKUP_REMOTE_PATH` satt hvis off-site backup er ønsket
- [ ] Caddyfile konfigurert (LAN intern CA eller Tailscale)
- [ ] `ufw` tillater bare 80/443, ikke 3000
- [ ] `sudo journalctl -u familieassistenten -p warn` viser ingen
      `AUTH_TOKEN er påkrevd`-feil
- [ ] `curl -H "Authorization: Bearer $TOKEN" https://host/api/today`
      returnerer 200
- [ ] `curl https://host/api/today` uten token returnerer 401
- [ ] `curl -k https://host/health` returnerer 200 med CSP-header
- [ ] `curl https://host/api/status | jq '.breakers'` viser alle CLOSED
- [ ] Minimum én lokal backup <24t gammel i `data/backups/`
- [ ] (Off-site) Minimum én ekstern backup <24t gammel
