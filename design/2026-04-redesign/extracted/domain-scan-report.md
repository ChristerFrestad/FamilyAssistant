# Domene- og URL-skanningsrapport

**Scope:** Skanne `server/`, `public/`, `scripts/`, `.github/` og root-
konfig for hardkodede domener og absolute URL-konstruksjoner. Mål: sikre
at domene-bytte (fra f.eks. `hverdagsplanleggeren.com` til noe annet)
er konfig-drevet, ikke kode-endring.

**Dato:** 2026-04-23. **Branch:** `analysis/frontend-redesign-2026-04`.

**TL;DR:** Eksisterende kodebase bruker allerede `APP_URL` som primær
domene-nøkkel for OAuth, magic-link, og invitasjoner. Det er **ingen
forekomster av `hverdagsplanleggeren`** i koden. Hovedrisikoen er at
frontend og andre hjelpe-verktøy bygger URLer løst eller bruker
placeholders som kan bli misvisende. Anbefalt: en sentralisert
`urlBuilder`-utility + klient-side sanering.

---

## 1. Positive funn

### 1.1 `APP_URL` er allerede etablert som kanonisk domene-nøkkel
| Sted | Bruk |
|---|---|
| `.env.example:161` | `# APP_URL=https://appdomene.no` |
| `docker-compose.yml:97` | `APP_URL: ${APP_URL:-}` |
| `server/config.js:25` | `APP_URL: z.string().optional()` |
| `server/config.js:293` | Prod-gate varsler hvis `GOOGLE_CLIENT_ID` satt uten `APP_URL` |
| `server/auth/family-routes.js:17-21` | `invitationUrlFor(token)` leser `config.APP_URL` |
| `server/auth/google.js:180-186` | `redirectUriFor(appUrl)` bygger OAuth-callback URL fra `APP_URL` |
| `server/auth/magic-link.js:58-62` | `magicLinkUrlFor(token)` leser `config.APP_URL` |
| `DEPLOY.md` | Flere referanser som viser at alle URL-konstruksjoner er dokumentert å komme fra `APP_URL` |

**Vurdering:** Dette er godt design. Hele back-end-kjernen for
URL-sensitive operasjoner (OAuth-redirect, invitasjon-lenke, magic-link)
er allerede domene-uavhengig.

### 1.2 `ALLOWED_ORIGINS` separate fra `APP_URL`
`ALLOWED_ORIGINS` er komma-separert liste for CORS. Self-host på RPi
kan ha `APP_URL=https://familieassistenten.local` men også akseptere
forespørsler fra `https://raspberrypi.local`. Designet støtter dette.

### 1.3 Ingen forekomster av `hverdagsplanleggeren`
`grep -R "hverdagsplanleggeren" .` returnerer null treff. Domenet er
ikke embedded noen steder — ren konfig via `APP_URL`.

### 1.4 `public/manifest.json` bruker relative paths
`"start_url": "/"` (ikke absolutt). `sw.js`-scope defaulter til server-
origin. Begge er domene-uavhengige.

---

## 2. Hardkodede URL-er som IKKE er problemer

Disse er eksterne tjenester med stabile, globale endepunkter. Skal
IKKE gjøres konfigurerbare.

### 2.1 Google OAuth endepunkter
`server/auth/google.js:14-17`:
```js
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
```
**Status:** OK. Globale Google-endepunkter.

### 2.2 LLM API-endepunkter
| Fil | Endpoint |
|---|---|
| `server/llm/openai.js:3` | `https://api.openai.com/v1/chat/completions` |
| `server/llm/anthropic.js:11` | `https://api.anthropic.com/v1/messages` |
| `server/llm/xai.js:5` | `https://api.x.ai/v1/chat/completions` |
| `server/llm/ollama.js:11` | default `http://localhost:11434` (overridable per-family) |

**Status:** OK. Endepunkter er globale leverandører. `OLLAMA_HOST`
er override-variabel; per-familie-override via `family_llm_config.base_url`.

### 2.3 Kassal.app API
| Fil | Endpoint |
|---|---|
| `server/services/kassal-client.service.js:27` | `https://kassal.app/api/v1` |
| `server/services/price-reference.service.js:38` | samme |
| `server/services/env-store.service.js:247` | samme (smoke-test URL) |

**Status:** OK. Global tjeneste. Kan vurderes eksponert som
`KASSAL_BASE_URL`-env hvis man senere vil proxye via eget CDN, men ikke
nødvendig nå.

### 2.4 Resend e-post
`server/services/email.service.js:15`: `https://api.resend.com/emails`

**Status:** OK. Global tjeneste.

### 2.5 Whisper / STT host (localhost-default)
`server/stt.js:26`: `process.env.FASTER_WHISPER_HOST || 'http://localhost:8787'`

**Status:** OK. Env-overridable. Self-host kan bruke annen port eller remote host.

### 2.6 Seed-data recipe URLs (matprat.no, godt.no)
`server/seed.js:863-1483`: ~30 oppskrift-URLer mot matprat.no og godt.no.

**Status:** OK for seed. Disse er referanse-lenker til kilde-oppskrifter,
ikke domene-konfig. Kan i framtiden (se `integration-platform-future.md`)
erstattes med strukturerte referanser til flere lands recipe-kilder.

### 2.7 User-Agent referanse
`server/services/recipe-url-import.service.js:13`:
```js
const USER_AGENT = 'FamilyAssistant/1.0 (+https://github.com/ChristerFrestad/FamilyAssistant)';
```

**Status:** OK. Statisk git-repo-URL, akseptert praksis for User-Agent.

### 2.8 Test-fixtures
`tests/*.test.js` — mange `@example.com` e-poster, `https://example.com/feed.rss`,
osv. **Status:** OK. Fixture-data.

---

## 3. Områder som bør sjekkes / ryddes

### 3.1 `public/js/today.js:51` — apple.com maps-lenke
```js
<a href="https://maps.apple.com/?q=${encodeURIComponent(ev.location)}">
```

**Problem:** Hardkodet Apple Maps. Android-brukere får en underlig
fallback. En Apple-eier kan akseptere dette, men self-host-familie som
stort sett bruker Android vil synes det er rart.

**Forslag:** Bruk `geo:`-schema (fungerer cross-platform) eller la
preferansen være user-konfig:
```js
// geo:0,0?q=<location> fungerer på Android + iOS (iOS åpner Maps)
<a href="geo:0,0?q=${encodeURIComponent(ev.location)}">
```

Alternativ: `https://www.google.com/maps/search/?api=1&query=...`.

**Prioritet:** Lav. Ikke domene-relatert; mer generelt UX-valg.

### 3.2 `public/js/family-ui.js:18-46` — referanse-URLer til API-key-sider
```js
url: 'https://console.anthropic.com/',
url: 'https://platform.openai.com/api-keys',
url: 'https://x.ai/api',
url: 'https://ollama.com/download',
url: 'https://github.com/ggerganov/llama.cpp',
```

**Problem:** Ingen. Disse er "hvor finner du nøkkelen din?"-lenker, og
de er kanoniske URLer for tjenestene.

**Status:** OK. Kan legges til samme mønster for Kassal når D4-kravet
implementeres:
```js
{ id: 'kassal', url: 'https://kassal.app/api', label: 'Hent Kassal-nøkkel' }
```

### 3.3 `public/onboarding.html:236` — placeholder
```html
<input id="llmBaseUrl" placeholder="http://localhost:11434" />
```

**Status:** OK. Placeholder, ikke hardkodet URL.

### 3.4 `public/setup.html:216, 234` — placeholder
```html
placeholder="https://familieassistenten.local, https://raspberrypi.local"
value="http://host.docker.internal:11434"
```

**Status:** OK. Docker-default for internal Ollama-access + placeholder.

### 3.5 `public/js/meals.js:306` — placeholder
```html
placeholder="https://www.matprat.no/oppskrifter/..."
```

**Status:** OK. Placeholder viser hvilken URL-type forventes.

### 3.6 `server/index.js:87, 139` — logmelding
```js
`🔧 BOOTSTRAP MODE ACTIVE — open http://<host>:${config.PORT}/setup.html...`
`Familieassistenten kjører på http://localhost:${config.PORT}`
```

**Problem:** Logger hardkodet `localhost:PORT` selv om appen kjører på
et annet domene. Forvirrende i prod-logger.

**Forslag:**
```js
const displayUrl = config.APP_URL || `http://localhost:${config.PORT}`;
`Familieassistenten kjører på ${displayUrl}`
```

**Prioritet:** Lav. Kun logger-støy.

### 3.7 `.github/workflows/deploy.yml:63` — fallback URL
```yaml
url: ${{ vars.APP_URL || 'https://appdomene.no' }}
```

**Problem:** Fallback-URL `https://appdomene.no` er en placeholder.
Hvis `vars.APP_URL` ikke er satt, vil GitHub Actions bruke dette.

**Forslag:** La den være. "appdomene.no" er tydeligvis placeholder for
dokumentasjon, ikke en ekte avhengighet.

**Prioritet:** Null. Fint som er.

---

## 4. Frontend-arbeid (redesign) — anbefalinger

Når ny frontend bygges (Fase 1 senere i denne uken), må følgende sikres:

### 4.1 Relative URLer til egen backend
Frontend kaller `/api/...` (relative paths) — aldri `https://<domain>/api/...`.
Dette gjør frontend domene-uavhengig.

### 4.2 Klient-side URL-builder
```typescript
// client/src/lib/urls.ts
export function apiUrl(path: string): string {
  // Default: relative to current origin
  return path.startsWith('/') ? path : `/${path}`;
}

export function absoluteUrl(path: string): string {
  // Only for canonical URLs (OpenGraph meta, email-templates)
  // — reads from window.location.origin
  return `${window.location.origin}${apiUrl(path)}`;
}
```

### 4.3 Config-endpoint for runtime-verdier
Når klienten trenger å vite "hvor er jeg installert?" for å rendre
email-copies eller QR-koder:

```typescript
// GET /api/config/public returns { appUrl, deploymentMode, ... }
// Lastes én gang ved app-start, cached i React context
```

Dette finnes IKKE ennå. Bør bygges som del av Fase 1 (se `architecture-fit.md`
§5 — `/api/config/features`).

### 4.4 Ingen absolutt URL i meta-tags
`index.html`-ens `<meta property="og:url">` og tilsvarende må SSR'es eller
rendres server-side med `APP_URL`. Nåværende `public/index.html` har
ingen OpenGraph-tags, men redesign bør ha.

---

## 5. Konklusjon og forslag

**Tilstand:** Eksisterende kodebase er **i hovedsak domene-uavhengig**.
`APP_URL`-mønsteret er etablert og brukes riktig i alle kritiske URL-
byggere.

**Anbefalte forbedringer (lav prioritet, fikses i Fase 1):**

| # | Endring | Fil | Prioritet |
|---|---|---|---|
| 1 | Logmelding bruker `APP_URL` når satt | `server/index.js:87,139` | Lav |
| 2 | Erstatt `maps.apple.com` med cross-platform `geo:` eller user-konfig | `public/js/today.js:51` | Lav (UX) |
| 3 | Lag klient-side `urls.ts` utility i ny frontend | ny fil i `client/` | Må (Fase 1) |
| 4 | Implementer `/api/config/public`-endpoint | `server/routes.js` | Må (Fase 1b/1d) |
| 5 | Dokumenter URL-konvensjon i CONTRIBUTING.md | `CONTRIBUTING.md` | Lav |

**Ingen fiks anbefalt nå.** Alle punkter kan inkluderes naturlig når
tilhørende arbeid skjer (ny frontend, config-endpoint, etc.).

**Implisitt krav:** Fase 1 `/api/config/features`-endpoint må også
returnere `appUrl`, `deploymentMode` ('production' | 'self-host'), og
andre runtime-verdier frontend trenger for å rendre riktig. Dette er
allerede forventet i arkitektur-fit.md §5.
