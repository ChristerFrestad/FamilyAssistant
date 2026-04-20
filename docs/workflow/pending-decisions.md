# Pending decisions — venter på Christer

**Sist oppdatert:** 2026-04-20

Dette dokumentet er en lokal huskelapp for beslutninger Christer må
ta før uke 2 kan starte. Primær-lokasjon for diskusjonen er
**GitHub Issue #62** — denne filen er bare en in-repo-speiling slik
at Claude husker på blokkeringen selv om issue-listen ikke er
tilgjengelig.

Oppdateres når Christer svarer.

---

## Blokker uke 2: beslutningsliste (Issue #62)

Syv beslutninger + én infra-sak. Alle har ANBEFALING med hvorfor
og konsekvens i selve issuen.

- [ ] **B1** — Multi-tenant aktivering (a/b/c). Anbefaling: **a**.
- [ ] **B2** — LLM-strategi (a/b/c). Anbefaling: **a**, vurder c senere.
- [ ] **B3** — E-post-leverandør for magic-link (a/b/c). Anbefaling: **b**.
- [ ] **B4** — Cloudflare Tunnel (a/b/c). Anbefaling: **b**.
- [ ] **B5** — Første gamification-feature (a/b/c). Anbefaling: **a**.
- [ ] **B6** — Kalender: Google + Apple? (a/b/c). Anbefaling: **a**.
- [ ] **B7** — Per-medlem diett (a/b/c). Anbefaling: **a**.
- [ ] **Billing** — GitHub Actions billing-feil blokkerer PR #61 og
      #63 merge. Ikke del av uke-2-plan per se, men blokkerer merge-
      flyt til den er løst.

Full kontekst: https://github.com/ChristerFrestad/FamilyAssistant/issues/62

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

## Når beslutningene er tatt

Claude oppdaterer denne filen (marker `[x]` per besluttet punkt),
skriver uke-2-plan basert på svarene, og starter fix-fase for
PR #59 basert på hvilken hypotese som er bekreftet.
