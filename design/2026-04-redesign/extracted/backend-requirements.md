# Backend-krav — Familieassistenten redesign (april 2026)

Denne analysen kobler hver mockup-komponent til API-endepunkter og
data-struktur som trengs, og vurderer om det eksisterer i nåværende
backend (`server/routes.js`, `server/auth/*`, `server/repositories/*`).

**Referanse-dato:** 2026-04-23. Gjeldende main er `41d2bda` (etter
batch-2). Migrasjoner 001-020 applied. Nåværende roadmap B1-B7 per
Issue #62.

---

## 🔒 Låste beslutninger relevant for backend

Fra Christers gjennomgang 2026-04-23:

- **Kcal-felter fjernes fra v1.** Ikke i datamodell, ikke i UI.
  Diabetes-støtte er pushed til fase 2 per B7 locked-decisions.
  → Migrasjon 022 IKKE inkluderer `kcal_per_serving`.
- **Tags på oppskrifter:** inkluderes i migrasjon 022.
- **Achievements:** nivå 1 family-toggle via
  `families.gamification_enabled`-kolonne. Nivå 2 (per-medlem) kommer
  senere.
  → Migrasjon 022 (eller egen 023) inkluderer `families.gamification_enabled BOOLEAN NOT NULL DEFAULT 0`.
- **Kassal per-familie** (D4): hver familie registrerer egen nøkkel i
  Settings. Link til `https://kassal.app/api` i oppsettet. Ingen
  global fallback, ingen hybrid.
- **Kalender ↔ chore-kobling:** utsatt til v1.1. Notert, ikke bygget.
- **Apple CalDAV:** arkitektonisk forberedelse (D2). `calendar_integrations.provider`-felt
  designet med enum som støtter `google`, `apple`, `future-*`. UI viser
  "Koble til Apple Calendar" som disabled/"kommer senere". Ingen
  CalDAV-kode.

---

## 1. Sammendrag

| Kategori | Status | Arbeid |
|---|---|---|
| Dashboard grunndata | ✅ Finnes | UI-tilpasning |
| Ukesmeny | ✅ Finnes | UI-tilpasning + ingredient-customization (PR C i plan) |
| Handleliste (list-modus) | ✅ Finnes | UI-tilpasning |
| Pantry (med location) | ⚠️ **Delvis** | Krever migrasjon `inventory.location` |
| Gjøremål + gamification | ✅ Finnes (batch 1 B5) | UI-arbeid for leaderboard/badges/streaks |
| Per-medlem diett | ✅ Finnes (batch 2 B7) | UI-arbeid |
| Kalender (Google) | ❌ **Ikke implementert** | B6 roadmap (uke 4-6) |
| Kalender (Apple CalDAV) | ❌ **Avvist i Issue #62 B6** | Ikke planlagt |
| Auth-skjerm | ⚠️ Basic login.html finnes | Redesign + provider-dynamikk |
| Voice/mic-input | ✅ Finnes (`public/js/voice.js`) | Integrasjons-arbeid |
| Kassal.app-settings | ✅ Finnes (`llm_configs`/settings) | UI-tilpasning |
| Shopping "Har denne" | ✅ Finnes | UI-tilpasning |
| Shopping "Vil ikke ha" | ❌ **Ikke implementert** | Ny endpoint + tabell |
| Achievement-system | ❌ **Ikke implementert** | Ny tabell + regel-motor |

**Konklusjon:** ~60% av designet kan bygges mot eksisterende backend.
40% krever nye endepunkter eller nye tabeller. Full implementering er
ikke "drop-in"; kalender-integrasjonen alene (B6) er estimert 3-6 uker.

---

## 2. Skjerm 01 — Dashboard

### Hero meal card (dagens middag)
**Mockup-data:** `{title, subtitle, time, servings, tags[], ingredientsHave, ingredientsTotal}`

**Eksisterende backend:**
- `GET /api/today` — ✅ returnerer dagens meal fra `meal_plans` join `recipes`
- Ingredient-coverage: ✅ `pantry-coverage.service.js` beregner "have" vs "total"
- Tags: ⚠️ `recipes`-tabellen har ikke et `tags[]`-felt. Designet viser "Familiens favoritt", "Omega-3", "Glutenfri". **Løst via migrasjon 022 — se §8.**
- `servings` og `time`: ✅ `recipes.servings` + `recipes.prep_time` finnes
- **kcal:** 🔒 **LÅST: Fjernet fra v1.** Mockup-implementeringen skal IKKE
  vise kcal-felt. Diabetes-støtte er pushed til fase 2 (se
  `docs/workflow/pending-decisions.md` Diabetes-støtte).

### Agenda-strip (dagens kalender)
**Mockup:** viser neste 4 events i dag (`calendarEvents.filter(e => e.dayIndex === TODAY_IDX)`).

**Backend:** ❌ **IKKE implementert.** Kalender-integrasjon = B6, utsatt
til uke 4-6. Krever:
- `GET /api/calendar/events?from=<date>&to=<date>&member=<id>`
- Google Calendar OAuth-flyt
- Sync-worker som trekker events + mapper til intern datamodell
- Ny tabell `calendar_events`

**Midlertidig fallback:** kan vise kun interne events (måltider + chores)
fra eksisterende data. Gir 50% av verdien uten B6. Matcher `agendaEvents`
fra designet der `source="internal"`.

### Pantry lavt-kort
**Mockup-data:** `pantryLow[] = [{name, level}]`

**Backend:**
- `GET /api/pantry` — ✅ returnerer inventory-items
- Level er hardkodet i mockup. I backend har vi `inventory.qty_remaining`
  og `products.pack_size`. Må beregne `level = qty_remaining / pack_size *
  100` og sortere asc + limit N.
- **Lite arbeid.** Kan implementeres som utvidelse av `/api/pantry` med
  `?low=true`-query eller klient-side-filter.

### AI-forslag
**Mockup:** "Lørdag er åpen. Vil du at jeg planlegger noe raskt?"

**Backend:** ✅ Eksisterende `llm.js` + `/api/meals/suggest` (sunday-draft
generator) kan brukes. UI-visning av forslag er nytt.

---

## 3. Skjerm 02 — Kalender

### Full kalender-skjerm
**Mockup:** 24 seed-events på tvers av uka. Dag-/uke-visning. Filter per
medlem. Google/Apple-ikoner per rad. "Synket 2 min siden"-indikator.

**Backend:** ❌ **IKKE implementert.** Full B6 kreves:

#### Endepunkter som må legges til
```
GET  /api/calendar/events?from=&to=&member=
POST /api/calendar/events                    (intern event)
PUT  /api/calendar/events/:id
DELETE /api/calendar/events/:id
POST /api/calendar/google/connect            (OAuth start)
GET  /api/calendar/google/callback           (OAuth callback)
POST /api/calendar/google/sync               (trigger sync now)
GET  /api/calendar/status                    (sync-tidspunkt, provider-liste)
DELETE /api/calendar/google/disconnect
```

#### Datamodell-krav
- Ny tabell `calendar_events` (id, family_id, source, external_id, title,
  kind, day, start_time, end_time, location, member_id, external_link, etc.)
- Ny tabell `calendar_integrations` (id, family_id, provider, access_token_encrypted, refresh_token, last_sync_at)
- Ny tabell `event_chore_links` (event_id, chore_id) — se "kalender ↔ gjøremål"-beslutning fra chat-transcript

#### Avvist i Issue #62
Apple CalDAV ble avvist i B6-beslutningen ("Apple CalDAV er 3-4 uker
ekstra arbeid"). Men designet viser Apple-integrasjon gjennomgående.
**Beslutningspunkt for Christer:** Gjeninnføre Apple-støtte i design, eller
fjern Apple-UI fra mockup?

### Kalender ↔ gjøremål-logikk
Fra chat-transcript: "noen kalenderoppføringer trenger ikke gjøremål,
noen trenger — og en ansvarsoppgave."

Eksempel: "Henter Mats kl 15:30" fra Pers kalender → blir en gjøremål-
ansvarsoppgave for Per. Hvis ikke fullført innen dagen, forsvinner det
uten å purre.

**Backend-krav:**
- Link-tabell `event_chore_links`
- Batch-job som konverterer kvalifiserte kalender-events til chore-instanser
- Auto-cleanup av utgåtte ikke-fullførte event-chores

Stor kompleksitet. Ikke i nåværende roadmap.

---

## 4. Skjerm 03 — Ukesmeny

### Week meal list
**Mockup-data:** `weekMeals[] = [{day, date, name, tag, time, planned, kcal, external}]`

**Backend:**
- `GET /api/meals/:weekYear` — ✅ returnerer uka
- `PUT /api/meals/:weekYear/:dayOfWeek` — ✅ bytte recipe
- `POST /api/meals/swap` — ✅ swap-suggestions
- Tags: ❌ ikke i datamodell (se Dashboard-seksjon)
- `kcal`: ❌ ikke i datamodell
- `external` (hos mormor): ⚠️ meal_plans har `status='away'`. Rendering må mappe.

### "Generer manglende" (AI)
**Backend:** ✅ Eksisterende `meal-planning.service.js → generateSundayDraft`
kan brukes. UI-knapp er ny men endpoint finnes.

### "Lagre mønster som favoritt"
**Backend:** ❌ **IKKE implementert.** Ny:
- `POST /api/meals/:weekYear/save-as-favorite`
- Tabell `meal_pattern_favorites` (id, family_id, name, pattern_json)

Lav prioritet. Kan droppes fra MVP-redesign.

---

## 5. Skjerm 04 — Handle

### Shopping list (list-modus)
**Mockup:** kategori-grupper, check-toggle, kontekst-meny.

**Eksisterende backend:**
- `GET /api/shopping/current` — ✅ returnerer aktiv shopping-list
- `PUT /api/shopping/items/:id/bought` — ✅ toggle bought
- `PUT /api/shopping/items/:id/unbought` — ✅ (batch 2 PR A)
- `DELETE /api/shopping/items/:id` — ✅ (batch 2 PR A)
- `POST /api/shopping/items/:id/has-home` — ✅ "har denne varen" finnes
- Kategorier: ⚠️ `products.category` finnes. Klient må gruppere.

### "Vil ikke ha i {recipe}" (unpreferred)
**Backend:** ❌ **IKKE implementert.** Ny:
- Ny tabell `ingredient_preferences` (id, family_id, ingredient_key, recipe_id, type='unpreferred')
- `POST /api/preferences/unpreferred {ingredient, recipe_id}`
- LLM-prompt-injection: inkluder unpreferred i recipe-suggest
- `meal-planning.service.js` må filtrere foreslåtte recipes

**Estimat:** ~4-8 timer backend + LLM-prompt-tuning.

### Pantry-view (sub-tab)
**Mockup:** Gruppert på lokasjon (Køleskap / Kjøkkenskap / Fryser).

**Eksisterende backend:**
- `GET /api/pantry` — ✅ returnerer inventory-rader
- **Lokasjon:** ❌ `inventory`-tabellen har IKKE `location`-felt

**Migrasjon påkrevd (021):**
```sql
ALTER TABLE inventory ADD COLUMN location TEXT
  CHECK (location IN ('kjøleskap','kjøkkenskap','fryser','annet'))
  DEFAULT 'annet';
```

**UX-flow:** bruker må velge lokasjon når varen legges til pantry via UI.
Eksisterende `/api/pantry/add` og `POST /pantry` (has-home) må utvides
med `location`-felt.

**Estimat:** 2-4 timer backend + migrasjon, 4-8 timer UI.

### Level/progress-bar per pantry-item
**Mockup:** Prosent-level vises som farget bar.

**Backend:**
- `qty_remaining` og `total_size` / `last_pack_size` finnes i inventory.
- Klient kan beregne `level = qty_remaining / total_size * 100`.
- **Alternativ:** eksponere `level`-felt fra backend i repsons. Marginalt
  arbeid.

### Oda / Rema-levering
**Mockup:** Viser "Onsdager 17:30" og "Tilbud torsdag 06:00".

**Backend:** ❌ **IKKE implementert.** Oda-integrasjon er ute av scope.
Kan vises som statisk tekst i settings uten faktisk kobling.

---

## 6. Skjerm 05 — Gjøremål + gamification

### Gjøremål-datamodell
**Mockup:** `chores[] = [{id, task, assignee, avatar, xp, recur, days, dayIndex, done, color}]`

**Eksisterende backend:**
- `chores`-tabellen: ✅ basic fields
- `chore_schedules`: ✅ per uke status
- `chore_completions`: ✅ append-only history (batch 1 B5)
- `xp_awarded` kolonne: ✅ **men ingen XP-regel-motor**
- Recurrence-logikk: ⚠️ `chores.frequency='weekly'/'daily'/etc` finnes, men `custom days`-array ikke direkte i schema

### XP + leaderboard + streak
**Mockup:** viser XP per person, ukens mester, streak i dager.

**Backend:**
- `chore_completions.xp_awarded` finnes men settes til 0 default.
- Aggregering (sum per uke per user) — kan beregnes on-demand
- **IKKE implementert:**
  - XP-regler (hva gir hva mange poeng?)
  - Streak-beregning (må lese historikk, beregne kontinuerlig dager)
  - Leaderboard-endpoint

**Nye endepunkter:**
```
GET /api/gamification/leaderboard?week=YYYY-WNN
GET /api/gamification/user/:id/stats
GET /api/gamification/achievements/:user_id    (se neste)
```

### Achievement-system
**Mockup:** 5 hardkodede merker: "Frokostkongen", "Ryddemester", "7-dagers streak", "Pantry-helt", "Tidlig morgen".

**Backend:** ❌ **IKKE implementert.** Krever:
- Tabell `achievement_definitions` (id, code, name, emoji, criteria_json)
- Tabell `user_achievements` (user_id, achievement_id, earned_at)
- Regel-motor som evaluerer criteria ved completion-events
- Endpoint `GET /api/achievements/user/:id`

**Estimat:** 2-4 dager arbeid avhengig av hvor fleksible criteria skal være.

### Ukesmål + belønning
**Mockup:** Redigerbar XP-mål (200-2500) + belønning (emoji + tekst).

**Backend:** ❌ **IKKE implementert.** Krever:
- Tabell `week_goals` (id, family_id, week_year, xp_goal, reward_icon, reward_text)
- `GET/PUT /api/week-goals/:weekYear`

**Estimat:** 1 dag arbeid.

### Postpone / override
**Mockup:** "Utsett til i morgen"-knapp, "Opphev"-knapp (foreldre).

**Backend:** ✅ `PUT /api/chores/undone` + `markUndone` (batch 1 B5) finnes.
Postpone (flytt til neste dag) krever ny endpoint:
```
PUT /api/chores/:id/postpone    (body: {toDay: 'YYYY-MM-DD'})
```

---

## 7. Skjerm 00 — Settings

### Familiemedlemmer CRUD
**Backend:**
- `POST/PUT/DELETE /api/family/members/:id` — ✅ (batch 1 B1)
- `PUT /api/family/members/:id/diet` — ✅ (batch 2 B7)

### Kalender-tilkobling
Se §3.

### Kassal.app-nøkkel (🔒 **LÅST: per-familie** per D4)
**Mockup:** Maskert `kslp_●●●●●●●●●●●●●a9f2`, "Endre"-knapp.

**Beslutning (D4, 2026-04-23):** Per-familie-nøkkel. Hver familie
registrerer egen Kassal-nøkkel i Settings. Ingen global fallback,
ingen hybrid. UI viser link til `https://kassal.app/api` slik at
familier enkelt finner der de får nøkkel.

**Eksisterende backend:**
- `env-store.service.js` håndterer global API-key — **skal byttes til
  per-familie-lagring** for Kassal.
- Ny tabell eller gjenbruk av generisk `integration_configs`-mønster
  (se `docs/vision/integration-platform-future.md` §3):

```sql
-- Generisk tabell for per-familie-integration-konfig
-- (matcher Christers "kjør overalt"-visjon for flere integrasjoner)
CREATE TABLE integration_configs (
  family_id       INTEGER NOT NULL,
  integration_id  TEXT    NOT NULL,   -- 'kassal', 'oda', etc.
  config_json     TEXT    NOT NULL,   -- encrypted API-key + andre felt
  enabled         INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (family_id, integration_id),
  FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
);
```

**API-endepunkter:**
- `GET /api/integrations/installed` → liste
- `PUT /api/integrations/installed/kassal/config` body `{apiKey: '...'}`
- `DELETE /api/integrations/installed/kassal` → deaktiver
- `GET /api/integrations/installed/kassal/status` → test-ping

**UI-flyt (Settings → Kassal-seksjon):**
```
[Kassal.app ikke satt opp]
| Hent din egen nøkkel på [kassal.app/api ↗]
| [API-nøkkel: _________________]  [Lagre]
```

Etter save:
```
[Kassal.app ✓ konfigurert]
| kslp_●●●●●●●●●●●●●a9f2             [Endre] [Test] [Fjern]
```

**Estimat:** 1-2 dager (migrasjon + service + 3 endepunkter + UI).

### Foretrukne butikker
**Mockup:** 6 butikk-valg (Kiwi, Rema, Meny, Coop, Spar, Bunnpris).

**Backend:**
- `chain_preferences`-tabellen: ✅ eksisterer (migrasjon 013)
- `/api/family/chain-preferences` — ⚠️ må verifiseres at det finnes

### AI-assistent: "Lær assistenten"
**Mockup:** "14 tilbakemeldinger · 3 uforetrukne"

**Backend:**
- Feedback-tabellen: ✅ (migrasjon 015)
- Nytt: aggregering som returnerer tall. Liten endepunkt-utvidelse.

### Personvern: "Last ned · slett data"
**Backend:** ✅ `gdpr-routes.js` finnes (export + delete endpoints).

---

## 8. Nye migrasjoner oppsummert (oppdatert 2026-04-23)

For full mockup-implementering kreves følgende migrasjoner. Rekkefølgen
matcher implementerings-fasene i §10.

| # | Migrasjon | Formål | Status |
|---|---|---|---|
| 021 | `inventory.location` | Kjøleskap/kjøkkenskap/fryser for pantry-view | Fase 3 |
| 022 | `recipes.tags` (JSON array) + `families.gamification_enabled BOOLEAN` + `integration_configs` tabell | **Kcal IKKE med (låst).** Tags-støtte for dashboard/week-menu. Gamification family-toggle (nivå 1). Generisk integrasjon-konfig (Kassal først). | Fase 2-3 |
| 023 | `ingredient_preferences` | "Vil ikke ha i X"-funksjonalitet | Fase 3 |
| 024 | `achievement_definitions` + `user_achievements` | Achievement-system (nivå 1 family-toggle styrer visning) | Fase 4 |
| 025 | `week_goals` | Ukesmål + belønning | Fase 4 |
| 026 | `calendar_events` + `calendar_integrations` | B6 kalender. **`calendar_integrations.provider`** må ha enum med `google`, `apple`, `caldav` (for framtidig utvidelse) selv om kun `google` implementeres i v1. | Fase 4 (avhengig av B6) |
| 027 | `event_chore_links` | 🔒 **UTSATT til v1.1.** Notert, ikke bygget nå. | v1.1 |
| 028 | `meal_pattern_favorites` | Lagre ukeplan som favoritt (valgfri) | Fase 4 eller droppes |
| 029 | `user_preferences` | Per-bruker theme + language preference (v1-nivå basic, fungerer uten API ved å bruke localStorage først) | Fase 1d / 2 |

**Endringer fra forrige versjon:**
- 022 fikk nye ansvar: tags, `families.gamification_enabled`, `integration_configs` generisk tabell
- kcal fjernet fra 022
- 027 merket som v1.1-arbeid (utsatt)
- 026 fikk krav om provider-enum som inkluderer `apple` for framtidig
- 029 lagt til for user preferences

---

## 9. Scope-estimat per modul

| Modul | Ny backend | Ny UI | Tilpasning eksisterende |
|---|---|---|---|
| Dashboard | 1-2 dager (tags) | 2-3 dager | 1 dag |
| Kalender | **3-6 uker (B6)** | 5-7 dager | — |
| Ukesmeny | 0.5-1 dag | 2-3 dager | 1 dag |
| Handle — list | 0.5 dag | 2 dager | 1 dag |
| Handle — pantry | 1-2 dager (location) | 2-3 dager | 1 dag |
| Handle — unpreferred | 1 dag | 1 dag | — |
| Gjøremål — grunn | 1 dag (postpone) | 2 dager | 1 dag |
| Gjøremål — XP | 2-3 dager | 2 dager | — |
| Gjøremål — achievements | 2-4 dager | 2 dager | — |
| Gjøremål — week-goal | 1 dag | 1 dag | — |
| Settings | 1-2 dager | 3-5 dager | — |
| Member Detail | 0.5 dag | 2 dager | — |
| Auth-skjerm (se architecture-fit.md) | 2-3 dager | 3-5 dager | — |
| Design-system (tailwind build + tokens) | — | 3-5 dager | — |

**Totalt estimat:** ~12-16 uker full-tids hvis alt skal leveres.

**Pilot-scoped MVP (ekskluder kalender-B6, achievements, week-goal):**
~6-8 uker.

---

## 10. Anbefaling for implementerings-faser

### Fase 1 (uke 3-4): Design-system + shell
- Tailwind-build-oppsett (erstatt CDN)
- Token-CSS (OKLCH-farger)
- Fonts (Instrument Serif + Geist)
- App-shell: Bottom nav, TopBar, routing
- Auth-skjerm (se architecture-fit.md)

### Fase 2 (uke 5-6): Skjermer med eksisterende backend
- Dashboard (uten kalender-strip)
- Ukesmeny (uten tags)
- Handle — list-modus
- Gjøremål — grunn + postpone (uten XP/achievements)

### Fase 3 (uke 6-7): Utvidelser
- Pantry med location (migr. 021)
- "Vil ikke ha" (migr. 023)
- Settings-skjerm
- Member Detail

### Fase 4 (uke 7+): Nye features
- Kalender (hvis B6 landes) — stort arbeid
- Gamification: XP, achievements, week-goal
- Tags + kalori (valgfritt)

**Kritisk:** Fase 4 avhenger av at B6-beslutning (kalender) er avklart
først. Uten B6 blir dashboard-agenda-strip begrenset til interne events.
