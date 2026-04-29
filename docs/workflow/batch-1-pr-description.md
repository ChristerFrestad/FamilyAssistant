# Batch 1 — lokal-først arbeidsflyt + uke 2-arbeid (B1 + B5)

> **Note (2026-04-29):** This PR description references CLAUDE.md
> DEL 6.1 / 6.1b in their Railway-frozen form. The Railway deploy
> architecture was retired in Sprint 2.6 (2026-04-29); DEL 6 was
> reframed to cover only the multi-tenant auth + observability
> code that remains sensitive. The PR itself was merged at the
> time and shipped the work it describes — only the framing of
> DEL 6 in the wider repo has since changed. Document preserved
> as historical record.

**Status (før push):** 14 lokale commits, 0 pushet. Venter på Christers
push-klarsignal.

**Branch ved push:** `feat/gamification-chore-completions` (tuppen).

**Merge-strategi (besluttet av Christer 2026-04-20):** **én PR,
"Create a merge commit".** Alle 14 commits bevares i main-historikken.
Ikke squash, ikke rebase. Begrunnelse: både Gruppe A og Gruppe B
endrer CLAUDE.md (henholdsvis DEL 5.2 og DEL 6.1/6.1b) — split i tre
linjære PR-er ville krevd rebase-ing av B og C etter A er merget,
med høy sjanse for merge-konflikter og 10-20 min ekstra admin pr
runde. Første batch-push er ikke stedet å optimalisere audit-trail;
granularitet beholdes uansett i historikken.

---

## Hvorfor denne batchen eksisterer

Tre sammenhengende arbeidsstrømmer ble utviklet lokalt etter at GitHub
Actions-billing-grensen ble nådd 2026-04-20:

1. **Arbeidsflyt-overgang** (før vi kunne merge noe trygt):
   Volum-måling viste ~300 GH Actions-jobs/dag — ikke bærekraftig.
   Vi innførte lokal-først-arbeidsflyt før vi pushet mer kode, for
   å unngå å gjenta forbruket ved feilede CI-runs.

2. **Uke 2-arbeid B1 — multi-tenant aktivering** (Issue #62 beslutning):
   Eksisterende auth-kode er bygget men var fryst. Aktivering fjerner
   'dev-secret'-fallback, krever `SESSION_SECRET` i prod, tiner frysen
   kontrollert, og dokumenterer drift.

3. **Uke 2-arbeid B5 — gamification-fundament** (Issue #62 beslutning):
   Append-only `chore_completions`-tabell som fremtidige XP / streak /
   leaderboard / week-goal-features bygger på.

Alle tre er nok stabile individuelt at de kunne pushet separat — men
billing-pausen tvang opp-samling, og opp-samlingen viste seg nyttig
(hver del validerer de andre: B1 bruker den nye CI-strukturen;
B5 bruker soft-thawed auth-kontekst indirekte).

---

## Hva inngår — tematisk gruppering

### Gruppe A — Lokal-først arbeidsflyt (6 commits)

Branch: `chore/local-first-workflow-setup`. Rene infrastruktur-
endringer + tidligere PR #61/#63-innhold cherry-picked inn.

| Commit | Innhold |
|---|---|
| `d93555e` | **CLAUDE.md DEL 5.2** ny seksjon "Lokal-først arbeidsflyt". Eksisterende 5.2/5.3/5.4 renummert til 5.3/5.4/5.5. `.github/workflows/ci.yml` restrukturert: test-job splittet i PR-gate (Linux Node 20) og cross-platform (kun main+schedule). SBOM/OSV/perf nå på ukentlig cron søndag 02:00 UTC. `scripts/local-ci.sh` + `.ps1`. Ny `docs/workflow/local-first-adoption-2026-04.md`. `ops/logs/push-attempts/`-mappe for retry-logging. |
| `91c2172` | **Baseline uke 17** (cherry-picked fra PR #61). 288 linjer metrikker. |
| `22ec04b` | Flytter baseline til `docs/baselines/` (subfolder) så phase21-policy-testen ikke trigges (cherry-picked fra PR #61). |
| `febfc75` | **Uke 1-governance-logs** (cherry-picked fra PR #63). AGENT_LOG.md + CONTEXT.md oppdatering. |
| `73bb216` | `docs/workflow/pending-decisions.md` — in-repo-speiling av Issue #62 og PR #59-spørsmål. |
| `4ef3a39` | Oppdaterer pending-decisions.md med Christers Issue #62-svar (alle beslutninger mottatt). |

**Effekt:** CI-forbruk går fra ~8-10 jobs per PR-push til 4 jobs per
PR-push + 8 ved main-merge + 3 søndagskjøringer. Estimert ~75-80 %
reduksjon når normal rytme innfinner seg. Evalueringsdato: 1. juni 2026.

### Gruppe B — B1 Multi-tenant aktivering (5 commits)

Branch: `feat/multi-tenant-activation` (off Gruppe A). Issue #62 B1.

| Commit | Innhold |
|---|---|
| `6bda159` | **Analyse** (502 linjer i `docs/analyses/2026-04-20-multi-tenant-activation.md`). 3-nivå reisen, 3 hypoteser, 12 edge-cases, Portainer-risk-sjekk, 5 beslutnings-spørsmål som Christer svarte på i chat. |
| `aff7a83` | **C1 — SESSION_SECRET bootstrap.** `server/auth/bootstrap-session-secret.js` (ny). Self-heal for upgrade-installasjoner: hvis bootstrap.json eksisterer uten sessionSecret, genereres og merges inn atomisk. Wizard `handleComplete` genererer sessionSecret ved fresh install (schema `version: 2`). `.env.example` + `docker-compose.yml` oppdatert. 14 nye tester. |
| `508c204` | **C2 — Soft-thaw.** CLAUDE.md DEL 6.1 splittet i 6.1 (Railway fortsatt helt fryst) og 6.1b (`server/auth/` krever nå DEL 5.3-flyt: feat/fix + Christer-godkjenning, men kan endres). Reverserbar som én chore/-PR. |
| `586ddc9` | **C3 — Aktiver session-flyt.** `'dev-secret'` fallback i `server/auth/routes.js` fjernet, erstattet av `requireSessionSecret()` som kaster ved manglende verdi. `server/config.js` skjerpet produksjons-gate for HMAC-signerende features (Google OAuth, Resend, MAGIC_LINK_CONSOLE) — `PILOT_BYPASS` eksplisitt ekskludert siden cookie ikke HMAC-signeres. RUNBOOK.md §12 (127 linjer multi-tenant-drift). `scripts/e2e-tenant-isolation.js` for manuell empirisk verifikasjon. |
| `7d49080` | **Deploy-sjekkliste** (`docs/runbooks/b1-deploy-checklist.md`, 301 linjer). Pre-pull backup, forventede logg-linjer, feil-indikatorer, 4-trinns rollback-prosedyre. |

**Empirisk verifikasjon (lokal):** Server startet, 2 users via magic-link,
2 familier opprettet, pantry-items la til, bekreftet zero cross-tenant
lekkasje. Logg + script-output ligger som artefakt i commit-meldingen
for `586ddc9`.

### Gruppe C — B5 Gamification-fundament (1 commit)

Branch: `feat/gamification-chore-completions` (off Gruppe B). Issue #62 B5.

| Commit | Innhold |
|---|---|
| `896ebfb` | **Migration 019 + repo + atomic hook.** Ny tabell `chore_completions(id, family_id, week_year, chore_id, user_id, completed_at, xp_awarded)` med 2 indekser. Nytt repo `chore-completion.repo.js` med insert/removeLatest/count*/list-metoder. `chore.repo.js`-metoder `markDone`/`markUndone` utvidet til atomic tx (UPDATE schedule + INSERT/DELETE history). `routes.js:PUT /api/chores/complete` sender `ctx.user.id` til repo. 15 nye tester dekker schema, repo-nivå, tenant-isolation, og hook-integrasjon. Analyse i `docs/analyses/2026-04-20-gamification-chore-completions.md`. |

**Funksjonelt minimum for uke 2:** tabellen eksisterer og fylles hver
gang en chore markeres done. XP-beregning, streak, leaderboard, week-
goals kommer i senere iterasjoner som leser fra denne tabellen uten
ny migrasjon.

---

## Testing

```
Lokal CI full pyramide — grønn på alle tre nivåer.

Tier 1 (instant):   lint + format:check + typecheck      — 0 feil
Tier 2 (fast):      1158 tester, 1156 pass, 0 fail,       — 2 skipped
                    2 skipped (win32-plattform)
Tier 3 (full):      coverage 82.03 % lines / 72.96 %      — alle over gate
                    branches / 79.82 % functions
                    npm audit --omit=dev                 — 0 vulnerabilities
```

**Testvekst:** 1129 → 1143 (C1) → 1158 (B5). 29 nye tester totalt i batchen.

**Coverage:** 81.99/72.72/79.70 → 82.03/72.96/79.82. Marginal økning.

**Frosne kode-tester (DEL 6.1) kjører fortsatt grønt:** `tenant-isolation`,
`role-enforcement`, `auth-*`, `gdpr-endpoints`, `phase14/18/19/20`,
`phase21-repo-hygiene`. Ingen omskriving.

**Ikke-kjørt på GitHub CI enda:** alle tester over er lokale. Venter
å kjøre på GitHub CI ved push.

---

## Portainer-risiko: **HØY**

Primært B1-relatert. Følg **`docs/runbooks/b1-deploy-checklist.md`**
etter merge til main:

1. **Pre-pull:** backup `bootstrap.json` + noter schema-versjon.
2. **Under pull:** følg container-logg for forventede oppstartlinjer.
3. **Verifiser:** `cat bootstrap.json` skal vise ny `sessionSecret`-
   felt etter self-heal (versjon=1 beholdes for upgrade-sti;
   versjon=2 for fresh-install).
4. **Smoke-test:** `curl -H "Bearer $AUTH_TOKEN" /api/auth/me` + evt.
   empirisk tenant-isolation-test per RUNBOOK §12.6.
5. **Rollback:** checklist har 4-trinns prosedyre (env-override,
   image-tag-rollback, bootstrap.json-restore, full data-restore).

**Lav-risiko deler:** Gruppe A (ingen runtime-endring) og Gruppe C
(ren additiv migrasjon). **Høy-risiko del:** Gruppe B, spesielt
C1 (config.js + bootstrap-flyten — kan hindre oppstart hvis
self-heal feiler og en HMAC-feature er aktiv).

---

## Selektivt revert-strategi

Hvis én del feiler etter merge, revert i denne rekkefølgen
(invers-commit-order):

| Hvis problem i | Revert commit(s) | Effekt |
|---|---|---|
| B5 gamification (data-konsistens) | `git revert 896ebfb` | Fjerner chore_completions-hook. B1 intakt. Kjør `DROP TABLE chore_completions` manuelt på RPi hvis tabellen skal bort (migrasjon kjøres igjen ved neste deploy siden IF NOT EXISTS). |
| B1 C3 (session-flyt kaster) | `git revert 586ddc9` | Gjenåpner `'dev-secret'`-fallback + slapper config-validering. B5 intakt. |
| B1 C2 (frys-oppmyking var feil) | `git revert 508c204` | CLAUDE.md DEL 6 går tilbake til full frys. OBS: hvis C3 fortsatt er på plass kan det bli semantisk inkonsistent (koden endret men frys strammes). Anbefalt å revertere både C2 og C3 samtidig. |
| B1 C1 (SESSION_SECRET-bootstrap hindrer oppstart) | `git revert aff7a83` | Self-heal og wizard v2 fjernet. OBS: hvis C3 er på plass vil prod-gate feile i oppstart hvis en HMAC-feature er aktiv og SESSION_SECRET ikke er satt eksternt. Revert C1+C3 sammen for trygt rollback. |
| Arbeidsflyt-overgangen | `git revert d93555e..4ef3a39` (6 commits) | Tilbake til gammel CI-oppførsel. Docs bevares i git-historikk. |

**Mitigerings-prinsipp:** Commit-rekkefølgen er bevisst slik at hvert
senere steg forutsetter forrige. Dvs. for å trygt reverte C1 må
C3 og B5 (som bygger på tinet frys) også vurderes. Gruppe A kan
reverses isolert.

---

## Hva som IKKE er i denne batchen

| Arbeid | Status | Hvorfor ikke i batch 1 |
|---|---|---|
| **PR #59 — frontend empty-cart bug** | Draft på GitHub (`fix/empty-shopping-list-analysis`) | Venter på Christers 5 svar (branch-info, inkognito-test, DevTools-output, tidspunkt, siste dato). Fix-fase ikke startet. Kan slås sammen senere, eller stå som separat PR. |
| **B2 — LLM som felles Ollama (verifikasjon + docs)** | Ikke startet | Liten (~30 min), primært verifikasjon. Gir mest mening å gjøre ETTER B1 er merget og multi-tenant fungerer i prod — da kan vi faktisk teste cross-family LLM-bruk. |
| **B7 — per-medlem diett** | Ikke startet | Krever ny migrasjon (020) og ikke-trivielle endringer i allergi-filter-service. For stor å legge til i batch 1. Egen analyse trengs, samt vurdering av eksisterende `family_profile_members`-skjema. |
| **B3 — Resend e-post** | Utsatt til uke 3-4 | Per Issue #62 B3-beslutning: settes opp først etter multi-tenant er testet i prod. |
| **B4 — Cloudflare Tunnel** | Utsatt til uke 4-5 | Per Issue #62 B4. |
| **B6 — Google Calendar** | Utsatt til uke 4-6 | Avhenger av B4 (domene-aktivt). |

---

## Dependency-kjede og merge-strategi

**Besluttet:** én PR, "Create a merge commit". Alle 14 commits bevart
på main.

Intern commit-rekkefølge:

```
chore/local-first-workflow-setup         (6 commits, Gruppe A)
   → feat/multi-tenant-activation         (5 commits, Gruppe B)
      → feat/gamification-chore-completions (1 commit, Gruppe C)
         → PR-beskrivelse + denne oppdateringen (2 commits, docs)
            = 14 commits totalt ved tuppen av PR-en
```

Git-historikken på main etter merge vil vise alle 14 commits med
merge-commit på toppen. Granularitet bevart; revert per commit mulig
via `git revert <sha>` (se § selektivt revert-strategi).

### Fallback: splitt i tre PR-er

Forkastet av Christer i denne runden, men dokumentert for fremtidige
batcher hvis logisk skille er klarere:

```
1. Gruppe A:  chore/local-first-workflow-setup      → main
              (6 commits, infrastruktur-only)
              ↓
2. Gruppe B:  feat/multi-tenant-activation           → main
              (5 commits, avhenger av A-merge — CLAUDE.md DEL 5.2-
               referanse i C2 forutsetter at DEL 5.2 eksisterer)
              ↓
3. Gruppe C:  feat/gamification-chore-completions    → main
              (1 commit, funksjonelt uavhengig)
```

**Kostnad ved split:** ~10-20 min admin (tre rebase-runder + tre CI-
kjøringer + tre merge-godkjenninger). **Gevinst:** audit-trail per
gruppe. Vurder for batch 2+ hvis logisk skille er renere og CLAUDE.md
ikke røres av flere grupper samtidig.

---

## Filer endret (samlet)

```
  7  docs/*                                             +1 894 / -63
  3  docs/analyses/*                                    + 1203 /   0
  1  docs/baselines/*                                   +  288 /   0
  2  docs/runbooks/*                                    +  301 /   0
  3  docs/workflow/*                                    +  190 /   0
  1  CLAUDE.md                                          +  125 / -12
  2  AGENT_LOG.md + CONTEXT.md                          +  133 /  -6
  2  .env.example + docker-compose.yml                  +   25 /  -4
  2  .github/workflows/*                                +  111 / -44
  2  scripts/local-ci.sh + .ps1                         +  176 /   0
  1  scripts/e2e-tenant-isolation.js                    +  253 /   0
  1  ops/logs/push-attempts/.gitkeep                    +    0 /   0
  1  server/migrations/019_chore_completions.sql        +   40 /   0
  2  server/auth/bootstrap-session-secret.js + routes.js + 130 /  -4
  1  server/config.js                                   +   40 /  -5
  1  server/http/bootstrap.js                           +   10 /  -1
  3  server/repositories/* (chore + chore-completion + index) + 197 / -18
  1  server/routes.js                                   +    7 /  -1
  1  RUNBOOK.md                                         +  127 /   0
  2  tests/auth-bootstrap-session-secret.test.js
     + chore-completion.test.js                         +  682 /   0

  Total:  ca. 31 filer berørt, ~3 932 linjer lagt til, ~160 fjernet
```

---

## Anbefaling til Christer før push

1. **Les denne beskrivelsen grundig** — især Portainer-risiko-seksjonen
   og deploy-checklist.
2. **Si "nå pusher vi batch 1"** eller be om justeringer.
3. Etter push: Jeg åpner **én PR** fra `feat/gamification-chore-
   completions` → `main` med beskrivelsen fra denne filen limet inn
   som PR-body. Venter på CI (nå billing-fikset, skal kjøre fullt
   grønt). Ber om din merge-godkjenning. Du velger "Create a merge
   commit" i GitHub-UI.

Ved push-klarsignal — oppsummering av kjente remote-konsekvenser:

- **PR #61 (baseline) og PR #63 (uke 1-logs)** på GitHub kan lukkes
  som "superseded" av Gruppe A — deres innhold er cherry-picked hit.
  Jeg gjør det autonomt etter at batch 1 er merget.
- **PR #59 (draft) står urørt.** Batch 1 pushes uten frontend-bug-
  fixet. Christer svarer på de 5 spørsmålene etter batch 1 er merget;
  fix kommer i batch 2. Eksplisitt akseptert 2026-04-20.
- **Issue #62** allerede lukket (2026-04-20) med dine beslutninger.

**Ingen handling fra meg før du sier "nå pusher vi batch 1".**
