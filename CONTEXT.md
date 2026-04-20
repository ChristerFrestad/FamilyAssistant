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

### Oppgave: Undersøke "tom handlekurv"-bug i frontend (DEL B)

**Beskrivelse:** `GET /api/debug/shopping-state` (kjørt 2026-04-20,
før endepunktet ble fjernet i PR #57) bekreftet at DB-en har 70
`shopping_list_items`-rader med `bought_rows=0`, men UI viser ingen
varer i handlekurv-fanen. Dette er en SEPARAT bug fra test-0.2
"defaults to bought"-saken som allerede er fikset av PR #44 + #46.

Christer har flagget at det henger sammen med parallelt arbeid i
`public/index.html`. Før analysen starter trenger Claude å vite
hvilken branch/commit det parallelle arbeidet ligger på — så
baseline for analysen blir riktig. Se `## VENTER PÅ CHRISTER` over.

**Akseptansekriterier (hva "ferdig" betyr):**

- [ ] Root-årsak identifisert (frontend-rendering, family-scope,
      uke-mismatch, service-worker-cache, eller annet)
- [ ] Draft analyse-PR opprettet i `docs/analyses/<dato>-<slug>.md`
      med reisen, minst 8 edge-cases, Portainer-oppstartsrisiko-sjekk,
      ISO 25010-påvirkning, beslutninger med anbefaling
- [ ] Christer godkjenner analysen før fix-koding starter
- [ ] Fix-PR merget og verifisert mot UI + `GET /api/shopping/*`

**Utenfor scope:**

- Ikke rør PR #53 (lukket) eller PR #54/#57 (merget)
- Ikke start multi-tenant-deploy (venter på Christers eksplisitte
  aktivering i DEL C)

**Prioritet:** må-ha (blokkerer pilot-bruk av appen)

**Kompleksitet (Christers magefølelse):** middels

**Portainer-risiko (Christers magefølelse):** lav (frontend-bug,
ingen DB-migrasjon forventet)

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

- **PR #59** — `[ANALYSE] empty shopping list UI bug` (draft).
  Venter på Christers 5 svar (branch for index.html-arbeid,
  inkognito-test, DevTools Network-output, tidspunkt, siste
  dato varer var synlige).
- **PR #61** — `docs: add baseline status for week 17`.
  Tester grønne, blokkert av GitHub Actions billing-feil
  (Coverage/OSV/SBOM). Se Issue #62 eller VENTER PÅ CHRISTER.

---

## VENTER PÅ CHRISTER

> Handlinger Claude ikke kan utføre selv. Fjernes når Christer har gjort det.

- **Svar på de 5 spørsmålene i PR #59** (branch-SHA for index.html,
  inkognito, DevTools-output, tidspunkt, siste dato). Velger H1/H2/H3
  basert på svar.
- **GitHub Actions billing-fiks.** Tre jobs (Coverage/OSV/SBOM)
  blokkerer alle framtidige PR-er med CI-gate. Gå til GitHub →
  Settings → Billing & plans, sjekk mislykket betaling / spending
  limit. Detaljer i PR #61-kommentar og Issue #62.
- **Svar på 7 beslutninger i Issue #62** (uke 2-beslutningsliste).
  Kort format: `B1: a, B2: a, ...`. ANBEFALING + hvorfor står i
  issuen. Nødvendig for å kunne skrive uke-2-planen.

---

## FERDIG (siste 10)

> Claude flytter hit etter merge

- 2026-04-20: Parker redesign-mockup fra claude.ai/design i
  `design/redesign-exploration-2026-04/` – **PR #60** – ISO-effekt:
  ingen (docs-only). Mockup er eksplisitt merket PARKERT; plan for
  implementering i uke 8+.
- 2026-04-20: Fjernet midlertidig diagnostikk-endepunkt
  `GET /api/debug/shopping-state` – PR #57 – ISO-effekt: ingen
  (rent oppryddings-PR; koden ble aldri taggt i en release).
  Analyse-PR #53 lukket samme dag med H1/H2/H3 falsifisert av
  produksjonsdata (70 rader, 0 bought_rows, alle migrasjoner
  kjørt inkl. 018). Originalbug fikset av PR #44 + #46.
- 2026-04-20: Midlertidig diagnostikk-endepunkt
  `GET /api/debug/shopping-state` – PR #54 – ISO-effekt: observability
  (midlertidig). Phase21-frysen fikk samtidig kodifisert unntak i
  CLAUDE.md DEL 6.5 (policy-tester vs kode-tester).
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