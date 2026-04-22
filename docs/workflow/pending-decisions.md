# Pending decisions — venter på Christer

**Sist oppdatert:** 2026-04-22 (batch-2 konsolidert lokalt — 4 enheter på `batch-2`-branchen, venter push-klarsignal "nå pusher vi batch 2")

Dette dokumentet er en lokal huskelapp for beslutninger Christer må
ta. Primær-lokasjon er **GitHub Issue #62** (uke 2-beslutninger —
lukket 2026-04-20) og **PR #59** (frontend-bug analyse — åpen, fix
inkludert i batch-2).

---

## Batch 2 — venter push-klarsignal

**Branch:** `batch-2` (lokal). **Status:** 13 commits + 4 merge-commits,
tier 1+2+3 grønn, PR-beskrivelse i `docs/workflow/batch-2-pr-description.md`.

**Fire enheter:**
- Gruppe A: Portainer SESSION_SECRET deploy-gate (docs)
- Gruppe B: B2 LLM felles Ollama (RUNBOOK §13)
- Gruppe C: PR #59 frontend empty-cart fix (3-lags defensiv)
- Gruppe D: B7 per-medlem diett backend (migrasjon 020 + tre-lags filter + endpoints)

Push utløses kun av eksakt frase "nå pusher vi batch 2" fra Christer.
Ikke "ok", "push", "gå videre" eller lignende.

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

---

## B7 — Per-medlem diett UI (MÅ gjøres før eksterne familier inviteres)

**Status (2026-04-22):** Backend-arbeidet er landet lokalt på
`feat/per-member-diet`-branchen i 3 commits:

- Migrasjon 020 + `updateMemberDiet`/`getMemberDiet` i `family.repo.js`
- Tre-lags filter-arkitektur (`allergy-filter` utvidet, nye
  `dislike-filter.service.js` og `diet-filter.service.js`, fasaden
  `recipe-filter.service.js`)
- `PUT`/`GET /api/family/members/:id/diet` + 5 oppgraderte call sites,
  inkludert `?ignoreDietTags=true`-query-param for D7-override

**Ikke gjort (pending UI-arbeid — må leveres i uke 3 eller ved ny
frontend-leveranse, FØR flere familier inviteres):**

- [ ] **UI for PUT /api/family/members/:id/diet** — per-medlem-form
      med allergi-liste, dislike-liste, diet_tag-chip-velger (14 enum-
      verdier fra D3) og custom_diet_note-fritekst. Uten denne kan
      operatører sette data kun via `curl`/dev-tools.
- [ ] **Override-toggle for diet_tags (D7)** — UI-komponent øverst i
      oppskrifts-visning: "Vis alle oppskrifter uansett diett". Må
      huske tilstand lokalt (localStorage eller URL-param). Setter
      `?ignoreDietTags=true` på `GET /api/recipes`-kall. Server
      persisterer ikke denne — se D7-avklaring.
- [ ] **Per-medlem-visualisering** — "Truer Lise (gluten), Kari
      (laktose)" via `perMember.allergy.blockedIngredients[].blockedFor`.
      Matrise eller chip-liste. Må også vise `perMember.dislike.warnings`
      som svakere hint (ikke rødt varsel).
- [ ] **Meal-planning per-medlem-integrering** — nåværende
      `isRecipeSafe` i meal-planning bruker KUN familie-nivå-allergier
      (intensjonalt minimum-endring i kode-fasen). Når UI er klar,
      oppgrader callers til å passere `members` → dermed respekteres
      også diet_tags i ukeplan-kandidater.

**Referanser:**
- D7-beslutning (tre-lags filter): Christers uke 2-melding 2026-04-22
- Analyse: `docs/analyses/2026-04-22-per-member-diet.md`
- Tre commits: se `git log feat/per-member-diet`

**Blokkering for ekstern invitasjon:** Inviteres en ny familie *uten*
UI landet, kan operatør-adult sette data via API, men det finnes ingen
måte for vanlig bruker å administrere sin egen diett. Det bryter
selvbetjeningsløftet fra B1-svaret.

---

## Diabetes-støtte — design pending

Diabetes-støtte krever mer enn én enum-tag. For meningsfull verdi trengs:
(1) næringsstoffinfo per oppskrift (carbs, sugars, fiber per porsjon),
(2) per-medlem karbo/sukker-grenseverdier, (3) warning-basert filter-lag
som viser avvik uten å blokkere. Utsatt til fase 2 (tidligst uke 6-10).
Ikke implementert som halv-løsning i B7.

**Status i B7 (batch-2):** `diabetiker-vennlig` ble bevisst fjernet fra
D3-enum-listen (nå 13 verdier, ikke 14). Regression-test
`updateMemberDiet rejects diabetiker-vennlig (deferred to phase 2)`
i `tests/per-member-diet.repo.test.js` sikrer at verdien ikke
stille re-introduseres uten design-prosess.

**Hva som trengs for fase 2:**
- Datamodell: `recipes.nutrition_per_serving` (carbs_g, sugars_g, fiber_g,
  protein_g, fat_g) eller referanse til ekstern næringsstoff-DB.
- Seed-data eller LLM-assistert parsing av eksisterende oppskrifter.
- `family_profile_members.carb_limit_per_meal_g`,
  `sugar_limit_per_day_g` eller lignende grenseverdi-felter.
- Nytt filter-lag (eller utvidelse av lag 2 SOFT/warning) som rapporterer
  "Høy karbo for Kari (54g vs. hennes 40g-grense)" uten å blokkere.
- UI for å sette grenseverdier + vise warnings i oppskrifts-visning.

**Hvorfor ikke som enum i B7:** En `diabetiker-vennlig` enum-tag som
trigger "sukker/honning/ris/pasta"-ingredienser gir *falsk trygghet* —
en diabetiker som stoler på at tagen filtrerer vekk problematiske måltider
vil fortsatt kunne få risottoer med 80g karbo merket som "OK". Den
medisinske verdien krever faktiske tall, ikke en ingrediens-heuristikk.
