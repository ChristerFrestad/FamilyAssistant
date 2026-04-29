# CONTEXT.md – Gjeldende oppgave og prosjektstatus

> Én aktiv oppgave. Les hele filen før du starter.
> Oppdateres av Christer (aktiv oppgave) og av Claude (status, ferdig).

---

## PROSJEKT

**Navn:** FamilyAssistant
**Repo:** https://github.com/ChristerFrestad/FamilyAssistant
**Eier:** Christer Frestad
**Versjon:** 1.3.0 (ISO-score ~8.55)

### Deployment-modus

- **Aktiv:** Docker → Portainer → RPi5, + andre familier via HAOS/egen Portainer
- **Følsom kode under utvikling:** multi-tenant auth (`server/auth/`)
  + observability (`sentry.js`) — se CLAUDE.md DEL 6
- **Fremtidig:** Cloudflare Tunnel + eget domene
  (`hverdagsplanleggeren.com`), internett-produksjon mot pilot

### Produksjon

- Container registry: `ghcr.io/christerfrestad/familyassistant:main`
- Portainer pull-er automatisk (`pull_policy: always`)
- Bootstrap-wizard: `http://<host>:7777/setup.html` ved første boot

---

## AKTIV OPPGAVE

> Christer oppdaterer denne seksjonen. Når flere oppgaver står her:
> øverste har prioritet. Claude flytter ned til "Ferdig" etter merge.

### Master-plan til pilot — Sprint 1 (Prompt 1: Quick wins)

**Sprint:** 1 av 8 (uke 1 av 8 mot pilot 24. juni 2026).

**Aktiv prompt:** Prompt 1 — Quick wins (ESLint-warnings, status-
docs, patch-oppdateringer). Direkte på `main`, ingen feature-branch.

**Kontekst:** Master-plan til pilot startet 2026-04-29 etter Fase 1b
ble merget (PR #68). Hele 18-prompt-planen ligger som referanse i
Christer's Del A/B-dokumenter. Pilot-mål: Christer's familie får
appen til daglig bruk på `app.hverdagsplanleggeren.com`.

**Etter Prompt 1:** Prompt 2 (backend-sikkerhet-fundament) som er
den største og viktigste sprint-1-fasen — auth/google.js coverage
til 80 %+, negative multi-tenant-tester, server-side validering,
rate limiting, audit-trail. Egen feature-branch + PR.

**Pågående features (ingen):** Ingen Christer-eide feature-branches
er aktive akkurat nå. Alle sletteoperasjoner i Runde C er fullført,
Fase 1b er merget. Repo er i hvile før Sprint 1 utføres.

---

## TECH STACK (sammendrag, full liste i REFERENCES.md)

- Node.js 20–22, `node:http` uten rammeverk
- SQLite via better-sqlite3 (sql.js fallback)
- Zod for validering, pino for logging
- Plain HTML/CSS/JS + service worker, ingen build-step
- LLM: Ollama (default), llama.cpp, Anthropic, OpenAI, xAI
- Test: `node:test`, coverage-gate 80/68/72

Endringer i stack krever STOPP.

---

## ARKITEKTUR (kort)

Tre-lags backend: `routes.js` → `services/*.service.js` → `repositories.js`.
HTTP-infra isolert i `server/http/`. Auth i egen mappe (frosset).
Frontend serveres statisk fra `public/` via service worker.
Database-migrasjoner nummererte i `server/migrations/`.
Destruktive operasjoner logges via `withAudit()` (SBOM-6).

Full beskrivelse: `README.md` + `REFERENCES.md`.

---

## PÅGÅR (åpne PR-er)

> Claude oppdaterer

Ingen Christer-eide PR-er er åpne. Tre Dependabot-PR-er er åpne
(`#67` Sentry/node major-bump, `#69` dev-minor-group, og en
GitHub Actions OSV-scanner-bump) — disse håndteres av Dependabot
og påvirker ikke Sprint 1-arbeidet.

---

## VENTER PÅ CHRISTER

> Handlinger Claude ikke kan utføre selv. Fjernes når Christer har gjort det.

Ingen blokkerende handlinger akkurat nå. Beslutningspunkter for
fremtidige sprint-faser er sporet i `docs/workflow/pending-
decisions.md`:

- **Kalender-arkitektur** (Sprint 5 / Prompt 10) — hybrid pass-
  through bekreftes når kalender bygges; for pilot foretrekkes
  bare familie-events.
- **User-scoping innenfor Family** (Sprint 3 / Prompt 5) — for
  pilot anbefales kun voksne logger inn, barn er "members".
- **Settings-arkitektur** (Sprint 5 / Prompt 11) — bare family-
  nivå for pilot.
- **WCAG mint-kontrast-fix-strategi** (Sprint 6 / Prompt 12) —
  velges under selve revisjonen.
- **Personvernerklæring jurist-godkjenning** (Sprint 7 /
  Prompt 18) — Christer sender utkast og videresender feedback.

Alle øvrige beslutninger fra ukene før Master-planen
(Issue #62 uke-2-beslutninger, batch-2 push-klarsignal, PR #59
5 spørsmål) er enten besluttet eller løst i merget arbeid.

---

## FERDIG (siste 10)

> Claude flytter hit etter merge

- 2026-04-28: Fase 1b — Frontend foundation (design-system,
  16 base-komponenter, 180 tester, theme-system, i18n-klar
  preview-side) – **PR #68** – ISO-effekt: usability +
  maintainability (etablerer designsystemet). Sluttrapport i
  `docs/workflow/fase-1b-summary.md`.
- 2026-04-28: Repo-cleanup runde A+B+C (24 remote-branches og 3
  lokale-branches slettet, 2 stashes droppet, PR #56 lukket
  som hul placeholder). Status-rapport i `docs/workflow/repo-
  cleanup-2026-04-runde-c.md`.
- 2026-04-29: Repo-tilstand-revisjon (foreldreløse filer,
  dependency-status, RLS-kartlegging, norsk-tekst-omfang).
  Rapport i `docs/workflow/repo-cleanup-2026-04-oppgave-2.md`.
- 2026-04-22: Batch 2 — B7 per-medlem-diett + PR #59-fix +
  B2/Portainer-docs – **PR #65** – ISO-effekt: functional
  suitability (per-medlem-diett-arkitektur).
- 2026-04-22: Batch 1 — lokal-først arbeidsflyt + uke-2 (B1
  multi-tenant + B5 gamification) – **PR #64** – ISO-effekt:
  flere subkarakteristikker.
- 2026-04-20: PR #59 (`[ANALYSE] empty shopping list UI bug`)
  lukket etter at fix landet i Batch 2 (PR #65). PR #61
  (week-17 baseline) lukket etter at billing-issue ble løst og
  CI ble grønn på senere PR-er.
- 2026-04-20: Issue #62 (uke-2-beslutninger) LUKKET med 7
  Christer-svar (B1-B7) som danner grunnlag for batch-1/-2.
- 2026-04-20: Parker redesign-mockup fra claude.ai/design i
  `design/redesign-exploration-2026-04/` – **PR #60** – ISO-effekt:
  ingen (docs-only).
- 2026-04-20: Fjernet midlertidig diagnostikk-endepunkt
  `GET /api/debug/shopping-state` – PR #57 – ISO-effekt: ingen
  (rent oppryddings-PR).
- 2026-04-20: Midlertidig diagnostikk-endepunkt
  `GET /api/debug/shopping-state` – PR #54 – ISO-effekt:
  observability (midlertidig).

---

## ÅPNE BESLUTNINGER

> Ting Christer ikke har bestemt ennå. Blokkerer visse oppgaver.

Sentral plass for åpne beslutninger er nå
`docs/workflow/pending-decisions.md`. Master-plan-spesifikke
beslutninger som kommer inn i fremtidige sprint-er er listet i
`VENTER PÅ CHRISTER` ovenfor.

---

## IKKE-GJØR-LISTE (for denne fasen)

Ting som er utenfor scope for nåværende fase (Portainer-fokus):

- Sky-/multi-tenant-deploy (Railway-stien er retired i Sprint 2.6;
  fremtidig sky-løp er på roadmap, men ikke i pilot-scope)
- Nye features i multi-tenant-auth uten DEL 5.3-flyt
- Custom domene-oppsett (kommer i Sprint 7 / Cloudflare Tunnel)
- Betalte SaaS-integrasjoner
- Mobile app (PWA er nok)