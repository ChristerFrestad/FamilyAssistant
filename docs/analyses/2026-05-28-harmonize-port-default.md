# ANALYSE: Harmonize PORT default to 7777 (issue #125)

**Bakgrunn:** PORT-defaulten har vært inkonsistent siden Sprint 1.
Zod-default i `server/config.js` sa 3000, `.env.example` sa 3000,
men `Dockerfile`, `docker-compose.yml`, `README.md`, `AGENTS.md`
DEL 7.8 port-matrix og `client/vite.config.ts` proxy sa 7777. Per
issue #125 betyr dette at en utvikler som følger README-quickstart-
flyten (`npm install + cp .env.example .env + npm start`) ender med
backend på 3000 og Vite-proxy som 502'er på alle `/api/*`-kall.

## Scope

Trivielt-merket per CLAUDE.md DEL 11 (config + dokumentasjon-fix,
ingen domeneendring, ingen forretningsregel).

Fix per issue #125 Option A: **gjør 7777 til ny default overalt**.

## Filer som endres

| Fil | Fra | Til |
|---|---|---|
| `server/config.js` | `PORT: ... .default(3000)` | `... .default(7777)` |
| `.env.example` | `PORT=3000` | `PORT=7777` |
| `familieassistenten.service` (legacy systemd) | `Environment=PORT=3000` | `Environment=PORT=7777` |
| `Caddyfile` (legacy systemd) | `reverse_proxy 127.0.0.1:3000` | `... 127.0.0.1:7777` |
| `install.sh` | `localhost:3000` (×5) | `localhost:7777` |
| `upgrade.sh` | `localhost:3000` (×1) | `localhost:7777` |
| `scripts/load-baseline.js` | `localhost:3000` (×2) | `localhost:7777` |
| `openapi.yaml` | `localhost:3000` | `localhost:7777` |
| `DEPLOY.md` | `raspberrypi.local:3000` (×3), `port 3000` (×1), `PORT=3000` (×1) | `... :7777`, `port 7777`, `PORT=7777` |
| `RUNBOOK.md` | `localhost:3000` (×16) | `localhost:7777` |

## Reisen

1. Ny utvikler kloner repo
2. `npm install`
3. `cp .env.example .env` → `.env` sier `PORT=7777` (var 3000)
4. `npm start` → backend på 7777
5. `npm run dev:client` → Vite på 7778, proxy → 7777 (allerede 7777
   per `client/vite.config.ts`)
6. Alle `/api/*`-kall fungerer end-to-end uten manuell override

## Domenemodell-påvirkning

Ingen.

## Edge-cases (under terskel for triviell)

1. Eksisterende deploy som har `PORT=3000` eksplisitt i `.env`
   påvirkes ikke — env-var har høyere prioritet enn Zod-default.
2. Operatorer på legacy systemd-path må enten ha port 7777 ledig
   eller fortsatt sette `PORT=3000` i systemd-unit. Begge funker;
   default endrer seg, eksisterende deploys overlever.
3. Portainer/Docker-path er allerede 7777, ingen endring.

## ISO 25010-påvirkning

- Vedlikeholdbarhet: +0.1 (én konsistent PORT-default fjerner én
  klassisk "hvorfor virker det ikke?"-felle for nye utviklere)
- Andre karakteristikker: uendret

## Portainer-oppstartsrisiko

Nei. `Dockerfile` har `ENV PORT=7777` (uendret),
`docker-compose.yml` har `PORT: ${PORT:-7777}` (uendret). Eneste
ting som potensielt kunne skapt forvirring var
`familieassistenten.service` (systemd, ikke brukt i Portainer).

## Plan

1. Denne analysen — commit 1
2. Comprehensive sweep — commit 2
3. Full lokal CI
4. Push + PR + auto-merge etter grønn CI per DEL 5.1 (`chore/`-
   prefiks)
