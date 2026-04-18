# Familieassistenten

Selvhostet husholdningsassistent for norske familier — planlegger ukesmeny,
handleliste, pantry-inventory og husarbeid. Kjører enten lokalt på en
Raspberry Pi 5 eller som multi-tenant SaaS på Railway.

## Hovedfunksjoner

- **Ukesmeny** med porsjons-skalering per familiemedlem
- **Pantry-inventory** koblet til handleliste — vet hva du har hjemme
- **Handleliste** auto-generert når uken er komplett
- **Husarbeid** med timeplan og «huk av»-logg
- **Oppskrifts-import** fra URL, med AI-parsing
- **Allergi-filter** to-lags (LLM-kontekst + deterministisk post-filter)
- **Kvittering-OCR** mot Kassal-katalogen
- **AI-chat** som bruker familiens pantry og menyhistorikk som kontekst
- **Multi-tenant**: hver familie har egen data, rolle-basert tilgang
  (`owner`/`adult`/`child`), valgfri Google OAuth eller magic-link-innlogging
- **Per-familie LLM**: velg Anthropic, OpenAI, xAI eller Ollama — hver
  familie bruker egen API-nøkkel (AES-256-GCM-kryptert)
- **PWA**: installeres på mobil, fungerer offline for lesing
- **GDPR**: eksport, soft-delete med 30-dagers grace, kaskade-slett ved
  familie-sletting

## Quickstart

To kjøremåter — begge bruker samme kodebase.

### 1) Raspberry Pi 5 (lokal-bare-metal)

Én familie, `AUTH_TOKEN` i stedet for innlogging, valgfri Google-OAuth for
fjern-tilgang. Se [`DEPLOY.md` §1–14](DEPLOY.md) for full oppskrift.

```bash
git clone <repo>
cd FamilyAssistant
cp .env.example .env      # fyll inn AUTH_TOKEN + ALLOWED_ORIGINS
chmod 600 .env
npm ci --omit=dev
npm start
```

### 2) Railway (sky, multi-tenant)

Google OAuth + magic-link, per-familie LLM-konfig, Sentry valgfritt.
Se [`DEPLOY.md` §15](DEPLOY.md) for full oppskrift inkludert DNS, Resend,
volume-mount og backup.

```bash
# I Railway-dashbordet:
#   1. Opprett prosjekt fra denne repoen
#   2. Mount volume på /app/data
#   3. Sett env-variabler (se .env.example)
#   4. Push til main → CI → auto-deploy
```

## Dokumentasjon

| Fil | Beskrivelse |
|---|---|
| [`DEPLOY.md`](DEPLOY.md) | Deploy på RPi5 eller Railway |
| [`RUNBOOK.md`](RUNBOOK.md) | Drift, on-call, backup/restore |
| [`SECURITY.md`](SECURITY.md) | Trusselsmodell, sårbarhets-rapportering |
| [`CI.md`](CI.md) | CI-gates, test/lint/coverage-kommandoer |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Bidrag, PR-flyt, kodestil |
| [`CHANGELOG.md`](CHANGELOG.md) | Versjonshistorikk |
| [`docs/DB_INDEXES.md`](docs/DB_INDEXES.md) | SQLite-indekser og EXPLAIN QUERY PLAN |

## Teknologi

- **Node.js ≥ 20**, ingen rammeverk — `node:http` med egen router
- **SQLite** via `better-sqlite3` (synkron, raskest på RPi5)
- **Validering**: Zod
- **Logging**: pino
- **Frontend**: klassisk HTML/CSS/JS + service worker, ingen build-steg
- **LLM-abstraksjon**: per-familie valg mellom Anthropic, OpenAI, xAI, Ollama
  og lokal llama.cpp

## Produksjons-krav

`NODE_ENV=production` krever minimum:

1. `AUTH_TOKEN` (minst 16, helst 32+ tegn) — `openssl rand -hex 32`
2. `ALLOWED_ORIGINS` — komma-separert liste, ikke `*`
3. HTTPS (via Caddy for RPi5, eller automatisk på Railway) og
   `HTTPS_TERMINATED=true`
4. For multi-tenant: `SESSION_SECRET`, `ENCRYPTION_KEY`, `APP_URL`

Serveren nekter oppstart hvis 1 eller 2 mangler.

## Lisens

MIT — se [`LICENSE`](LICENSE). © Christer Frestad.

## Sikkerhetsrapporter

Se [`SECURITY.md`](SECURITY.md) for ansvarlig rapportering av sårbarheter.
