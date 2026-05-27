# Analyse: Per-medlem diett (uke 2, B7)

**Dato:** 2026-04-22
**Forfatter:** Claude Code
**Baseline:** `main` commit `d238bf2` (batch 1 merged)
**Beslutning (Issue #62, B7):** Start lokalt per uke 2-plan.
**Avhengigheter:** ingen — står på egne ben etter `family_profile_members`-skjemaet
fra migrasjon 014.
**Kompleksitet:** middels-stor (estimert 1-2 dager)
**Portainer-risiko:** **LAV** — kun ADD COLUMN + ny tabell (ikke rebuild), rene
additive endringer, fullt backward-compatible for eksisterende familier.

> **STOPP før kode.** Denne analysen svarer på Christers 5 spesifikke
> spørsmål og lister 6 beslutninger som krever input før kode-fasen
> starter. Ingenting endres i `server/` eller `public/` i denne commit.

---

## 1. Viktig oppdagelse før vi starter

**Halvparten av B7 er allerede bygget.** `family_profile_members`-tabellen
eksisterer (migrasjon 014:80-91) med `name`, `category` (adult/teen/child),
`portion_factor`, `sort_order`. `family.repo.js` har full CRUD-metoder
(`addMember`, `listMembers`, `updateMember`, `deleteMember`, `portionSum`)
som allerede brukes av `family-routes.js` (onboarding, invitations) og
`family.service.js` (porsjons-skalering).

**Det som mangler for B7:** Diett-kolonner på `family_profile_members` +
allergy-filter-service som tar medlems-nivå-input + fallback til familie-nivå
når medlems-data ikke finnes.

### 1.1 Eksisterende medlems-skjema (ingen endring hittil)

```sql
-- Fra migrasjon 014:80-91 (ferdig deployed)
CREATE TABLE family_profile_members (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id      INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'adult' CHECK (category IN ('adult','teen','child')),
  portion_factor REAL NOT NULL DEFAULT 1.0 CHECK (portion_factor BETWEEN 0.1 AND 3.0),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 1.2 Hva B7 må legge til

Per-medlem diett-data. Tre kandidat-strukturer (se § 4.1 for valg):

```sql
-- Option 1 (anbefalt): kolonner på eksisterende family_profile_members
ALTER TABLE family_profile_members ADD COLUMN allergies TEXT NOT NULL DEFAULT '[]';
ALTER TABLE family_profile_members ADD COLUMN dislikes  TEXT NOT NULL DEFAULT '[]';
ALTER TABLE family_profile_members ADD COLUMN diet_tags TEXT NOT NULL DEFAULT '[]';
```

Alle tre kolonner er JSON-arrayer lagret som TEXT (konvensjon fra
migrasjon 009 — sql.js-fallback uten JSON1-modul).

---

## 2. Dagens allergi-filter-arkitektur

### 2.1 Signatur

`server/services/allergy-filter.service.js`:
```js
function checkRecipe(recipe, profile) {
  // profile.allergies er string[] — familie-nivå
  const allergies = (profile?.allergies || []).filter(...);
  // ...substring-match mot ALLERGY_TRIGGERS
  return { safeForProfile: boolean, blockedIngredients: [...], checkedAgainst: string[] };
}
```

### 2.2 Fem call sites

| Lokasjon | Formål | Profile-kilde |
|---|---|---|
| `routes.js:540-542` | GET `/api/recipes` (liste) — annoterer alle | `repos.familyProfile.get()` |
| `routes.js:551-553` | GET `/api/recipes/:id` | `repos.familyProfile.get()` |
| `routes.js:573-574` | POST `/api/profile/check-recipe` (dev-endpoint) | klient eller `repos.familyProfile.get()` |
| `routes.js:613-618` | LLM recipe-suggest postfilter | `repos.familyProfile.get()` |
| `meal-planning.service.js:34-38` | `isRecipeSafe` (ukeplan-kandidat-filter) | caller passer inn |

Alle passerer hele profile-objektet, og sjekken er "er én eller flere
allergier overtrådt" — binær.

### 2.3 Hvorfor vi ikke kan bare bytte kilde

Naiv "bytt til per-medlem" bryter tre ting:
1. **UI-feedback** forsvinner: I dag viser vi "Inneholder gluten" i én
   samlet advarsel. Per-medlem må vise "Truer Marte (gluten), Sofie (laktose)"
   ellers mister brukeren kontekst om hvem som må få alternativ-middag.
2. **LLM-prompt** (i `recipe-suggest`) bruker `profile.allergies` for å
   prompte LLM'en om å unngå ingredienser. Må utvide til union-av-alle-medlemmer
   eller eksplisitt liste per-medlem-data.
3. **Eksisterende familie-nivå-data** i `family_profile.allergies` blir
   stående. Vi må bestemme om det er "arv til medlemmer uten egne data"
   eller "dør og bli borte".

---

## 3. Svar på Christers spesifikke spørsmål

### 3.1 Hvordan fungerer allergi-filter i dag (kort)?

Deterministisk substring-match. Brukerens allergi-strenger (f.eks. `"Nøtter"`,
`"Laktose"`) mappes til en utvidet trigger-liste i `ALLERGY_TRIGGERS` (f.eks.
`nøtter` → `nøtt`, `hasselnøtt`, `mandel`, ...). Hvert ingrediens-navn i
oppskriften sjekkes lowercase mot alle triggere. Første match = blokkert.
Returnerer `safeForProfile: false` + `blockedIngredients`. Bevisst strengt;
false positives akseptable (f.eks. "muskatnøtt" match-er "nøtt"-trigger).

**Ingen LLM involvert.** Rent deterministisk. Det betyr B7 kan utvide på
samme måte — legge til per-medlem-loop uten å introdusere probabilistikk.

### 3.2 Hva skjer med familier uten per-medlem-data?

**Fallback-strategi (anbefalt):**
```
For hvert medlem m i family_profile_members:
  effectiveAllergies(m) = m.allergies OR family_profile.allergies  // arv
  effectiveDislikes(m)  = m.dislikes  OR family_profile.dislikes
  effectiveDietTags(m)  = m.diet_tags || []                        // ingen arv
```

- Medlemmer uten egne `allergies` arver fra `family_profile.allergies`.
  Dette sikrer at eksisterende "én-families-profil" fortsetter å virke
  selv uten medlems-data.
- **Hvis medlem setter `allergies = []` eksplisitt** — det skal tolkes som
  "har ingen allergier", ikke "bruk familie-nivå". Dvs. tomt array ≠ null.
  Vi lagrer default `'[]'` så det skilles fra "aldri satt". En separat
  `allergies_override: BOOLEAN` hadde vært tydeligere, men øker kompleksiteten.
  Alternative: behold familie-nivå som "fallback" bare når tabellen er tom
  for den familien. Se beslutning D5.
- `diet_tags` har ingen arv — det er per-medlem-livsstil (én vegetarianer
  tvinger ikke hele familien).

### 3.3 Fritekst vs enum for diet_tags?

**Anbefaling: enum-liste + fritekst-annen.**

Enum-verdier som matcher eksisterende `filter_usage`-filter-IDer:
- `vegetarian`, `vegan`, `pescetarian`, `halal`, `kosher`
- `laktosefri`, `glutenfri`, `eggfri`, `nøttefri` (overlapper allergies-semantikk men er diett-bevisst valg)
- `lavkarbo`, `lchf`, `keto`

**Fritekst:** én valgfri `custom_diet_note` TEXT-kolonne (f.eks. "Unngår
råvarer fra Kina") som LLM kan lese men ikke filtrere på.

**Hvorfor:**
- Enum låser UI til ferdigdefinerte chips — bruker klikker, skriver ikke feil.
- Matcher `filter_usage` slik at "mest brukt" av familien kan bli default
  når nytt medlem legges til.
- Fritekst-fallback ivaretar edge cases uten å tvinge oss å forutse alt.

Detalj: ingen mapping fra `diet_tags` til `allergy-filter.service.js` i
første iterasjon — de er separate dimensjoner. `vegetarian` filtrerer
bort kjøtt-ingredienser via eget `diet-filter.service.js` (ny fil) eller
utvidelse av allergy-filter med diet-triggere (seed-tabell).

### 3.4 Portainer-risiko-vurdering

**Lav risiko.** Konkret:

| Endring | Type | Risiko |
|---|---|---|
| Migrasjon 020 | ADD COLUMN + CREATE INDEX | Lav — idempotent, rollbackbar ved `DROP COLUMN` |
| `family_profile_members.allergies` | TEXT DEFAULT `'[]'` | Lav — eksisterende rader får tomt array |
| Repo-utvidelse | Nye metoder i `family.repo.js` | Null — legger til, fjerner ikke |
| allergy-filter-signatur | Backward-compat — tar både `profile` og `{ profile, members }` | Lav — call sites oppdateres eller fallback |
| `migrations/index.js` | Uendret — kjører 020 i transaction | Null |
| Self-heal/bootstrap | Uendret — ingen SESSION_SECRET-kobling | Null |

**Rollback-strategi:** Hvis 020 feiler etter deploy, kan man rulle tilbake
ved å fjerne `schema_migrations`-raden og droppe de 3 kolonnene. Enklere:
hold kolonnene, deploy gammel kode som ignorerer dem.

**Interaksjon med Phase 22 bootstrap:** Ingen. B7 rører ikke auth/session/
bootstrap-flyten. Fresh-install-funksjonen (som i dag trenger
`SESSION_SECRET` manuell — separat issue) er uavhengig.

### 3.5 Hvilke eksisterende tester må oppdateres?

**Må oppdateres:**
- `tests/m-week9-safety.test.js` — tester `safeForProfile`/`blockedIngredients`-respons.
  Må utvide til å verifisere per-medlem-info i `blockedIngredients[].blockedFor: string[]`.

**Må utvides (nye asserts, ikke endring):**
- `tests/family-endpoints.test.js` — nye tester for `PUT /api/family/members/:id/diet`.
- `tests/m-week4-frontend-features.test.js` — allergi-UI endres; må validere ny render.

**Skal fortsatt passere uendret:**
- `tests/fase-f3-profile-filter.test.js` — familie-nivå `/api/profile`-API forblir bakover-kompatibel.
- `tests/portion-scaling.test.js` — rører ikke diett.
- `tests/tenant-isolation.test.js` — family_id-scoping er intakt.
- `tests/phase20-coverage-gaps.test.js` — bør ikke bli påvirket.

**Nye tester (i kode-fasen):**
- `tests/per-member-diet.repo.test.js` — CRUD mot `updateMemberDiet`.
- `tests/per-member-allergy-filter.test.js` — union-sjekk + per-medlem-rapport.
- `tests/per-member-fallback.test.js` — familier uten medlems-data → familie-nivå arver.

---

## 4. Designbeslutninger som trenger Christer-input

### D1. Struktur-valg: Full overstyring vs Additiv vs Hybrid

**A) Full overstyring** — medlem har egne allergies/dislikes/diet_tags.
Hvis medlem har `allergies = null` → arv familie-nivå. Hvis `[]` → tomt.

**B) Additiv** — familie-nivå er base. Medlems-data legges til på toppen.
"Familien tåler ikke laktose" + "barnet har egg-allergi" = barnet har både.

**C) Hybrid (anbefalt)** — allergies og dislikes følger (A) med fallback.
Diet_tags følger (A) uten fallback (livsstil er individuell).

**Min anbefaling: C**, fordi:
- Allergi er safety — union av alle medlemmer (hvis EN er allergisk, hele
  familien unngår ingrediensen). Men medlemmer uten egen data bør ikke
  "tape" det familien allerede har satt (fallback-arv).
- Dislikes er komfort — samme fallback-logikk som allergies.
- Diet_tags er livsstil — ingen default-fallback. Hvis ikke satt = ingen
  diet-filter for dette medlemmet.

### D2. Skjema-plassering: kolonne på members vs separat tabell

**A) Kolonner på `family_profile_members`** (anbefalt)
Pros: Enkel lesing (én query for hele member-rad). Matcher eksisterende
mønster. Billig ADD COLUMN.
Cons: JSON i TEXT; queries som "finn medlemmer med nøtteallergi" er
string-search (ikke skalerbart om familien blir >100 medlemmer — ikke
aktuelt).

**B) Separat `family_member_diets`-tabell** — rad per (member_id, dimension, value)
Pros: Relasjonell, query-bar, auditerbar.
Cons: Mer kompleks, trenger JOIN, overkill for 5-10 medlemmer/familie.

**Min anbefaling: A.** JSON-TEXT matcher `family_profile`-mønsteret
(migrasjon 009) og gir billig lesing. Kan refaktoreres til B senere
hvis behov oppstår.

### D3. Diet_tags: enum-verdier

Opprinnelig forslag (14 verdier) ble justert av Christer under gjennomgang:
- `fodmap` → `lav-fodmap` (tydeligere semantikk)
- `kostholdshensyn-annet` fjernet (dekkes av `custom_diet_note`-feltet)
- `diabetiker-vennlig` vurdert og avvist — én enum-tag gir ikke medisinsk
  nyttig dekning av diabetes-spekteret (krever næringsstoffinfo per oppskrift
  og per-bruker-grenseverdier). Utsatt til fase 2.

**Endelig D3-liste (13 enum-verdier):**
```
vegetarian, vegan, pescetarian, halal, kosher,
laktosefri, glutenfri, eggfri, nøttefri,
lavkarbo, lchf, keto, lav-fodmap
```

Alternative tilnærminger (vurdert, forkastet):
- Bare 6 grunnleggende tags (`vegetarian, vegan, halal, glutenfri,
  laktosefri, annet`) — lavere UI-kompleksitet, utvides ved behov.
- 14-verdi-liste med `diabetiker-vennlig` — forkastet pga. falsk trygghet
  uten næringsstoff-støtte.

### D4. UI-presentasjon (for kontekst — ikke i denne PR)

Per-medlem-diett-UI kan komme i flere iterasjoner. Denne PR leverer:
- Backend-skjema + repo + endpoints
- allergy-filter-oppgradering
- Ingen UI-endring i første commit (men må tilgjengeliggjøre data)

Uke 3 kan ta UI-arbeidet: members-liste med per-rad edit-form, chips
for diet_tags, tekstinput for allergies.

### D5. "Tomt array" vs "null" i medlems-allergies

- `NULL` → ikke satt → fall til familie-nivå.
- `'[]'` → eksplisitt tomt → "medlemmet har ingen allergier".

**Spørsmål:** skal default-verdien i kolonnen være NULL eller `'[]'`?

**Min anbefaling: NULL.** Gir tydeligere fallback-semantikk. Repo-laget
normaliserer til tom array i read-lag. Men krever `ALTER COLUMN` å
endre default — trygt i SQLite siden vi rebuilder ikke.

Alternativ: `'[]'` default + ekstra `allergies_override BOOLEAN` —
tydeligere men mer kode.

### D6. Backward-compat for eksisterende `family_profile.allergies`

Når familie har medlems-data *og* familie-nivå-data, hva vinner?

- **A)** Medlems-data overstyrer alltid (familie-nivå ignoreres så snart noen medlemmer har egen data).
- **B)** Union (medlems-data legges til familie-nivå).
- **C)** Fallback (kun familie-nivå hvis medlem er `NULL`). *[min anbefaling D1/D5]*

Hvis C: familie-nivå er effektivt "default for nye medlemmer" og skal
kunne overstyres per medlem. Klart UX.

---

## 5. Plan (etter beslutninger)

Følgende rekkefølge forventet for kode-fasen (3-4 commits):

### Commit 1: Migrasjon + repo
- `server/migrations/020_member_diets.sql`
- `server/repositories/family.repo.js` — `updateMemberDiet`, `getMemberDiet`
- `tests/per-member-diet.repo.test.js`

### Commit 2: allergy-filter oppgradering
- `server/services/allergy-filter.service.js` — ny `checkRecipeForFamily(recipe, familyContext)` signatur som returnerer per-medlem-rapport + union
- Gamle `checkRecipe/annotateRecipe` beholdes som shim (backward-compat)
- `tests/per-member-allergy-filter.test.js`
- `tests/per-member-fallback.test.js`

### Commit 3: endpoints + call-site-oppdatering
- `server/auth/family-routes.js` — `PUT /api/family/members/:id/diet`
- `server/routes.js` — 4 call sites byttes til `checkRecipeForFamily`
- `server/services/meal-planning.service.js` — `isRecipeSafe` oppgraderes
- `tests/family-endpoints.test.js` — nye asserts

### Commit 4 (valgfri for denne PR): UI
- Kan utsettes til uke 3 hvis behov for å holde PR-scope kontrollert

---

## 6. Sammendrag for beslutnings-møte

| Spørsmål | Min anbefaling | Trenger Christer-svar |
|---|---|---|
| D1 Struktur-valg | Hybrid (C) | Ja |
| D2 Skjema-plassering | Kolonner på members (A) | Ja (bekrefte) |
| D3 Diet_tags enum | 13-verdi-liste (endelig — `diabetiker-vennlig` utelatt) | Ja |
| D4 UI-scope | Ikke i denne PR | Ja (bekrefte) |
| D5 Default-verdi | NULL | Ja |
| D6 Backward-compat | Fallback (C) — medlem NULL → arv familie-nivå | Ja |

**Jeg stopper her og venter på svar før kode-fasen starter.** Alle
beslutninger kan modifiseres; jeg har dokumentert min anbefaling men
er klar til å bytte retning hvis din dømmekraft peker annerledes.
