# Pending decisions — venter på Christer

**Sist oppdatert:** 2026-04-20 (uke 2-beslutninger mottatt + billing løst)

Dette dokumentet er en lokal huskelapp for beslutninger Christer må
ta. Primær-lokasjon er **GitHub Issue #62** (uke 2-beslutninger —
lukket 2026-04-20) og **PR #59** (frontend-bug analyse — åpen).

---

## ✅ Uke 2-beslutninger (Issue #62 — LUKKET 2026-04-20)

Christers svar, sitert for rask referanse:

- [x] **B1** — Multi-tenant aktivering → **(a)** uke 2.
      *"Testes tidlig i prod-lignende kontekst før 5 familier inviteres."*
- [x] **B2** — LLM-strategi → **(a)** min Ollama som felles ressurs.
      *"5 familier, moderat bruk, ingen support-byrde. Kan byttes senere."*
- [x] **B3** — Resend e-post → **(b)** uke 3-4.
      *"Først etter multi-tenant er testet."*
- [x] **B4** — Cloudflare Tunnel → **(b)** uke 4-5.
      *"Ikke offentlig tilgjengelighet før appen er klar."*
- [x] **B5** — Første gamification-feature → **(a)** `chore_completions`-tabell først.
      *"Datamodell-avhengighet. Alt annet bygger på denne."*
- [x] **B6** — Kalender → **(a)** bare Google.
      *"Apple CalDAV er 3-4 uker ekstra arbeid."*
- [x] **B7** — Per-medlem diett → **(a)** implementer i uke 1-7.
      *"Bygge per-medlem nå er enklere enn refaktorere senere."*
- [x] **Billing** — Løst 2026-04-20 (separat handling). Full CI
      fungerer normalt fra og med neste push.

Full issue-historikk: https://github.com/ChristerFrestad/FamilyAssistant/issues/62

---

## Blokker frontend-bug-fix: 5 spørsmål i PR #59

PR #59 (draft `[ANALYSE] empty shopping list UI bug`) venter på
svar før fix-fase kan velge hypotese.

- [ ] **Q1** — Branch/commit-SHA for parallelt `public/index.html`-arbeid
- [ ] **Q2** — Nettleser + inkognito-test (skiller H3 SW-cache)
- [ ] **Q3** — DevTools → Network-response for `GET /api/shopping/list/current`
- [ ] **Q4** — Tidspunkt for første observasjon + evt. "Ferdig handlet"-klikk (H2)
- [ ] **Q5** — Siste dato varer var synlige (skiller H1 uke-mismatch)

Full kontekst: https://github.com/ChristerFrestad/FamilyAssistant/pull/59

---

## Uke 2-sekvens (etter B1–B7-svarene)

Basert på svarene over er rekkefølgen:

1. **B1 multi-tenant aktivering** — starter nå (uke 2). Tiner frysen
   i CLAUDE.md DEL 6.1. Analyse først, så kode. Blokkerer B3, B4, B7.
2. **B5 `chore_completions`-tabell** — kan startes parallelt (rent
   datamodell-arbeid, uavhengig av multi-tenant). Gamification-fundament.
3. **B7 per-medlem diett-datamodell** — etter B1 (krever multi-tenant-
   skjema aktivt for å utvide med `user_members`-koblinger).
4. **B3 Resend e-post** — uke 3-4, etter multi-tenant er testet.
5. **B4 Cloudflare Tunnel** — uke 4-5.
6. **B6 Google Calendar** — uke 4-6 (OAuth + sync-logikk).
7. **B2 Ollama som felles LLM** — krever ingen kode-endring (eksisterende
   konfig). Kan verifiseres/dokumenteres når multi-tenant er aktiv.

PR #59-fix håndteres parallelt når Christer svarer på de 5 spørsmålene.

Claude oppdaterer denne filen når uke 2-leveransene fullføres.
