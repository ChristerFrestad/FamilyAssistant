# ANALYSE: Post-public improvements (2026-05-28)

**Bakgrunn:** Etter at repoet ble gjort public 2026-05-28 (PR #146 +
PR #147 fjernet PII / brand-detaljer), kom en ekstern vurdering inn
på 8.5/10. Vurderingen pekte på fem forbedringer som hever
"first-impression"-verdien for nye besøkere uten å endre noe av
arkitekturen.

Christer godkjente: "iverksett".

## Scope

Denne oppgaven er per CLAUDE.md DEL 11 en **trivielt-merket** sak
(docs + tester, ingen domenemodell-endring, ingen forretningsregel).
Kort analyse er tilstrekkelig.

1. `docs/ARCHITECTURE.md` — én-side oversikt + ASCII-diagram av
   request-flow, deploy-topology og service-lag.
2. `README.md` — ny seksjon "Screenshots" med plassholder-struktur
   Christer kan fylle inn manuelt etter pilot-start.
3. `tests/recipe-import-rate-limit.test.js` — eksplisitt verifisering
   av at `/api/recipes/import-from-text` og `/api/recipes/import-from-image`
   ligger bak `rateLimit`-middleware-kjeden.
4. `tests/llm-input-sanitization.test.js` — eksplisitt verifisering
   av at `sanitizeForPrompt` strips prompt-injection-mønstre fra
   tekst som går til LLM (defence-in-depth, eksisterende kode er
   allerede dekket men ikke i en dedikert test).
5. `tests/llm-integration.opt-in.test.js` — opt-in LLM-integration-
   suite som kun kjører når `LLM_INTEGRATION_TESTS=1` er satt, slik
   at CI ikke trenger LLM-credentials eller nettverk for å bli grønn.

## Reisen

Ekstern reviewer kloner repo →
1.1. Ser `README.md` — finner ingen visuell appeal (screenshots-
     mangelen var en av punktene)
1.2. Klikker `docs/` for å forstå arkitekturen — finner
     `DB_INDEXES.md`, `DOMAIN_MODEL.md`, `BRAND_SYSTEM.md`. Ingen
     én-side overordnet view.
1.3. Klikker `server/services/` — 22 filer, ingen forklaring av
     forholdet mellom dem.
1.4. Gir opp eller fortsetter med fragmentert mental modell.

Etter dette PR-et:
2.1. Ser `README.md` — har screenshots-seksjon (selv om bilder kommer
     senere, strukturen er der).
2.2. Klikker `docs/ARCHITECTURE.md` — får én-side overblikk av:
     request-flow, deploy-stack, lag-arkitektur, security-overflate.
2.3. Følger lenkene videre til `DOMAIN_MODEL.md` /
     `server/services/` med en mental modell allerede etablert.

## Domenemodell-påvirkning

Ingen. Dette er rent dokumentasjon- og test-arbeid.

## Edge-cases (5, ikke 8 — under DEL 11-terskelen for triviell)

- ARCHITECTURE.md må ikke gå ut av synk med koden. Mitigering: peker
  til `server/` med relative stier; ingen kopiering av detaljer som
  endrer seg ofte.
- `phase21-repo-hygiene.test.js` whitelistet kun
  `BRAND_SYSTEM/DB_INDEXES/DOMAIN_MODEL` i `docs/`-roten. Ny fil må
  legges til whitelisten (policy-test per DEL 6.5 — kan oppdateres).
- Screenshot-seksjon må ikke peke til ikke-eksisterende filer (404
  i README ser dårlig ut). Bruker `docs/screenshots/`-folder + alt-
  text-pattern som degraderer pent.
- Rate-limit-test må ikke bryte når default-limits endres. Bruker
  config-override via `startTestServer` heller enn hardkoding.
- LLM-integration-suite må SKIPPES automatisk uten credentials,
  ikke FEILE. Bruker `node:test`s skip-mekanisme + env-gate i top
  of file.

## Konsekvenser på tvers

- `tests/phase21-repo-hygiene.test.js` whitelist utvides (policy-test
  oppdatering, dokumentert i PR — DEL 6.5).
- `package.json` får ny test-script `test:llm` som kjører med env-var
  satt — gjør opt-in eksplisitt.
- Ingen kode-endringer i `server/`. Alt nytt er tester +
  dokumentasjon.

## ISO 25010-påvirkning

- Vedlikeholdbarhet: 8.3 → 8.4 (+0.1, ARCHITECTURE.md gjør
  onboarding-tid lavere)
- Sikkerhet: 8.2 → 8.3 (+0.1, eksplisitte tester for rate-limit +
  sanitization er nytt sikkerhetsnett)
- Funksjonell egnethet: uendret
- Pålitelighet: uendret

## Portainer-oppstartsrisiko

Nei. Ingen endring i `Dockerfile`, `server/index.js`,
`server/config.js`, `server/db.js`, eller migrasjoner.

## Plan

1. `docs/analyses/` — denne analysen (dette commit)
2. `docs/ARCHITECTURE.md` + `tests/phase21-repo-hygiene.test.js`
   whitelist-oppdatering — én commit
3. `README.md` — screenshot-seksjon med plassholdere
4. `tests/recipe-import-rate-limit.test.js` +
   `tests/llm-input-sanitization.test.js` — én commit
5. `tests/llm-integration.opt-in.test.js` + `package.json` script —
   én commit
6. Full lokal CI før Christer sier push.

Etter push: ingen merge før Christer bekrefter — dette er `chore/`-
branch men inkluderer test-tillegg, og selv om DEL 5.1 tillater
autonom merge for `chore/`, vil jeg vente på Christer for review siden
ARCHITECTURE.md er en ny strukturell doc.
