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

### Oppgave: Rot­årsaksanalyse — shopping-bought-state etter PR #46

**Beskrivelse (Christer skriver fritt):**

PR #46 hevdet å fikse at handleliste-rader feilaktig viste "kjøpt"-
tilstand ved oppstart, via migrasjon 018 som skulle nullstille
`bought_at`/`bought_qty`. Etter Portainer pull-and-redeploy ser
Christer fortsatt rader som er merket "kjøpt" og grået ut, inkludert
varer som er i pantry. Minst én av fire alvorlige feil gjelder:
(a) migrasjonen kjørte ikke, (b) migrasjonen virket ikke,
(c) rotårsaken er en annen enn PR #46 diagnostiserte, (d) noe skriver
tilstanden tilbake etter migrasjonen. CI var "10/10 grønn" ved merge,
som betyr testene ikke fanger reell oppstartstilstand på migrert DB.

**Akseptansekriterier (hva "ferdig" betyr for denne analyse-PR-en):**

- [ ] `docs/analyses/2026-04-20-shopping-bought-state.md` dekker reisen
      ende-til-ende, datamodell, alle skrive-punkter for `bought_at`,
      full sitat av hva migrasjon 018 gjør, Portainer-oppstartssekvens,
      rangerte hypoteser med disproof-metode, CI-reliability-gap, og
      eksplisitt ANBEFALING.
- [ ] Draft PR åpnet med analyse-dokumentet som eneste commit.
- [ ] CONTEXT.md AKTIV OPPGAVE oppdatert (denne seksjonen).
- [ ] AGENT_LOG.md har første innlegg.
- [ ] Christer har fått nok grunnlag til å velge hvilken hypotese
      som skal diagnostiseres først.

**Utenfor scope (denne analyse-PR-en):**

- Ikke skriv ny kode.
- Ikke forsøk å "fikse" ved å lage migrasjon 019 eller
  admin-reset-endpoint. Begge deler løser kun symptomet.
- Ikke spekuler utover hva som er observerbart i kode og migrasjons­
  historikk.

**Prioritet:** må-ha (blokkerer videre PR B / PR C)

**Kompleksitet (Christers magefølelse):** middels (analyse), stor
(hvis rotårsaken krever endring i oppstarts-stien)

**Portainer-risiko (Christers magefølelse):** høy — migrasjon er en
oppstartshendelse. Fix kan kreve ny oppstarts-sti-test (Steg 3b
PORTAINER-RISIKO utløses i fix-PR-en).

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

## FERDIG (siste 10)

> Claude flytter hit etter merge

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