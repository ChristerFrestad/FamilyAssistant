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

- **Aktiv:** Portainer på RPi5, + andre familier via HAOS/egen Portainer
- **Frosset:** Railway/multi-tenant (se CLAUDE.md DEL 6)
- **Fremtidig:** Eget domene, internett-produksjon (ikke klar ennå)

### Produksjon

- Container registry: `ghcr.io/christerfrestad/familyassistant:main`
- Portainer pull-er automatisk (`pull_policy: always`)
- Bootstrap-wizard: `http://<host>:7777/setup.html` ved første boot

---

## AKTIV OPPGAVE

> Christer oppdaterer denne seksjonen. Når flere oppgaver står her:
> øverste har prioritet. Claude flytter ned til "Ferdig" etter merge.

### Oppgave: <tittel>

**Beskrivelse (Christer skriver fritt):**

<Idé, krav, kontekst. Claude utleder detaljer i ANALYSE-dokumentet.>

**Akseptansekriterier (hva "ferdig" betyr):**

- [ ] <konkret observerbar oppførsel>
- [ ] <konkret observerbar oppførsel>
- [ ] <konkret observerbar oppførsel>

**Utenfor scope:**

- <ting Claude IKKE skal gjøre selv om det føles relatert>

**Prioritet:** <må-ha | bør-ha | nice-to-have>

**Kompleksitet (Christers magefølelse):** <liten | middels | stor>

**Portainer-risiko (Christers magefølelse):** <lav | middels | høy>

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

- Ingen

---

## VENTER PÅ CHRISTER

> Handlinger Claude ikke kan utføre selv. Fjernes når Christer har gjort det.

- **Hente diagnostikk fra produksjons-DB (blokkerer PR #53 Beslutning 3):**
  1. Pull ny image i Portainer (`ghcr.io/christerfrestad/familyassistant:main`
     — inkluderer merge av #54, commit `31739fe`).
  2. Restart containeren slik at ny route er aktiv.
  3. Kjør fra en maskin som når RPi5:
     ```
     curl -H "Authorization: Bearer $AUTH_TOKEN" \
       http://<rpi-host>:7777/api/debug/shopping-state
     ```
  4. Lim output inn i PR #53 eller send til Claude for analyse.
  5. Når analysen er ferdig og fiks er merget: slett `/api/debug/*`
     (endepunktet skal leve ≤ 7 dager — se CHANGELOG `[Unreleased]`).

---

## FERDIG (siste 10)

> Claude flytter hit etter merge

- 2026-04-20: Midlertidig diagnostikk-endepunkt
  `GET /api/debug/shopping-state` – PR #54 – ISO-effekt: observability
  (midlertidig; rydd etter PR #53-fiks). Phase21-frysen fikk samtidig
  kodifisert unntak i CLAUDE.md DEL 6.5 (policy-tester vs kode-tester).
- <dato>: <oppgave> – PR #<nr> – ISO-effekt: <beskrivelse>

---

## ÅPNE BESLUTNINGER

> Ting Christer ikke har bestemt ennå. Blokkerer visse oppgaver.

- Når skal internett-deploy-prosjektet starte? (krever nytt
  CONTEXT.md-prosjekt)
- <andre åpne spørsmål>

---

## IKKE-GJØR-LISTE (for denne fasen)

Ting som er utenfor scope for nåværende fase (Portainer-fokus):

- Aktivering av Railway-deploy (frosset, se CLAUDE.md DEL 6)
- Nye features i multi-tenant-auth
- Custom domene-oppsett
- Betalte SaaS-integrasjoner
- Mobile app (PWA er nok)