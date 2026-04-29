## Sammendrag

Sprint 2.6 — fjerner legacy Railway-deploy-arkitektur. Master-planen til pilot bruker `Docker → Portainer → RPi5 → Cloudflare Tunnel`; Railway-spor i repoet matchet ikke lenger denne planen og skapte forvirring i dokumentasjonen.

## Hvorfor

Før denne PR-en hadde repoet to deploy-fortellinger ved siden av hverandre: en aktiv Docker/Portainer-vei og en fryst (men eksisterende) Railway-vei med egen `railway.json`, `.github/workflows/deploy.yml` og `DEPLOY.md §15`. Frysingen var dokumentert i CLAUDE.md DEL 6 og holdt Railway-løpet i live "i tilfelle". Med Sprint 2.5 (white-labeling) ferdig og Christer's pilot-deploy fastsatt på `hverdagsplanleggeren.com` via Cloudflare Tunnel, finnes det ingen reell vei fremover som inkluderer Railway. Fortsatt frysing er aktiv vedlikeholdslast uten verdi — det er på tide å rydde.

Multi-tenant auth-koden (`server/auth/`) selv blir IKKE fjernet. Den er fortsatt under utvikling for fremtidige multi-tenant-deploys (mulig sky-comeback senere), bare ikke via Railway. DEL 6-frysing flyttes derfor fra "Railway / multi-tenant frys" til "Multi-tenant auth frys" — samme sikkerhetsnett, mindre forvirrende ramme.

## Hva ble fjernet

| Fil | Type | Note |
|-----|------|------|
| `railway.json` | Build/deploy-config | Slettet |
| `.github/workflows/deploy.yml` | CI/CD-workflow | Slettet (hele filen var Railway-spesifikk) |
| `tests/phase18-railway-config.test.js` | Static-analysis test (127 linjer) | Slettet — assertet `railway.json`-shape |
| `tests/phase19-deploy-workflow.test.js` | Static-analysis test (109 linjer) | Slettet — assertet `deploy.yml`-shape |
| `DEPLOY.md §15` | Railway recipe (~150 linjer) | Erstattet med kort "retired"-note som peker til master-plan |

## Hva ble modifisert (active docs)

| Fil | Endring |
|-----|---------|
| `README.md` | Opening blurb ("multi-tenant SaaS on Railway") + Quickstart §2 (Railway dashboard) → Portainer recipe; HTTPS-hint nevner ikke lenger "automatic on Railway" |
| `CLAUDE.md` DEL 1, 2.7, 6 | Section retitled "Multi-tenant auth frys"; Railway-spesifikke filer fjernet fra frosne-lista; soft-thaw på `server/auth/` beholdt verbatim; deleted phase18/phase19-tester fjernet fra fryselista |
| `CONTEXT.md` | Deployment-modus + IKKE-GJØR-LISTE oppdatert; Cloudflare Tunnel listet som fremtidig target |
| `SECURITY.md` | Mode 2 ("Sky, multi-tenant Railway + TLS") → "Multi-tenant via Docker/Portainer" med eksplisitt retirement-note |
| `REFERENCES.md` | Sentry observability-kommentar + phase-test-konvensjon + closing-note ryddet for Railway-omtale |
| `public/privacy.html` | Data-subprocessor-tabellen: "Railway" som kjøremiljø → "Egen Docker-host (RPi5 / Portainer)". GDPR-transparens-hensyn — privacy-policyen skal ikke liste sub-processors som ikke faktisk brukes |
| `server/db.js` | Volume-mangel-error-melding nevner ikke lenger "Railway: legg til Volume"; erstattet med Portainer-hint |

## Hva ble bevart (historisk dokumentasjon)

Tre dokumenter har Railway-referanser i forklaringen av sin egen samtid. De får hver et kort "Note (2026-04-29)"-header som forklarer at deploy-arkitekturen er endret i Sprint 2.6, men selve innholdet beholdes som historisk record:

- `docs/analyses/2026-04-20-multi-tenant-activation.md` — multi-tenant aktiveringsanalyse fra uke 2
- `docs/baselines/2026_W17.md` — ISO-baseline-snapshot for uke 17
- `docs/workflow/batch-1-pr-description.md` — Batch 1 PR-description som refererer DEL 6.1/6.1b i Railway-fryst-form

Disse er bevart fordi de dokumenterer beslutninger og state Christer faktisk traff på det tidspunktet. Å redigere dem ville falske historikk; å slette dem ville miste resonnement.

## Bekreftelse: ingen aktive Railway-referanser igjen

`grep -r "[Rr]ailway"` over hele repoet (eks. node_modules + .git) returnerer 7 filer:

- 3 historiske docs (har "Note (2026-04-29)"-header) ✓
- 4 aktive docs som beskriver retirement i pasattid ("retired in Sprint 2.6", "Railway-stien er fjernet", "tidligere lå i §15") ✓

Ingen fil sier "vi bruker Railway nå".

## Test-impact

| Suite | Før | Etter |
|-------|----:|------:|
| Server (`npm run test`) | 1309 pass | **1266 pass** (−43 fra to slettede static-analysis-filer) |
| Client (`npm run test:client`) | 257 pass | **257 pass** (uendret) |

De 43 fjernede tester var ikke behavioural-tester — kun assertions om shape på `railway.json` og `deploy.yml`-filene som nå er borte. Tap av disse senker ikke kode-dekningen for noen levende kodeflyt.

## Lokal CI

- [x] `npm run lint` — clean
- [x] `npm run typecheck` — clean
- [x] `npm run typecheck:client` — clean
- [x] `npm run test` (server) — **1266/1268** (−43 fra deleted phase18/19, 2 skipped uendret)
- [x] `npm run test:client` — **257/257**
- [x] `npm run audit:prod` — 0 vulnerabilities
- [x] `npm run build:client` — clean (uendret bundle-størrelse)

## Etter merge

Arkitektur-dokumentasjon konsistent med Docker/RPi5/Cloudflare-master-planen. Klar for **Prompt 5 (Fase 1e — Auth-flyt)**. Multi-tenant auth-koden (`server/auth/`) er fortsatt under DEL 6-frys med soft-thaw-flyt (DEL 5.3) — Prompt 5 kommer til å iterere på den koden under den eksisterende prosessen, ikke begynne fra blanke ark.
