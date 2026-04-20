# Analyse: `chore_completions`-tabell (uke 2 B5, gamification-fundament)

**Dato:** 2026-04-20
**Forfatter:** Claude Code
**Baseline:** `feat/multi-tenant-activation` (lokal, inkl. B1 C1–C3)
**Beslutning (Issue #62, B5):** (a) `chore_completions`-tabell først, før
XP-beregning og resten av gamification.
**Portainer-risiko:** **LAV** (ren datamodell-tillegg + idempotent hook).
**Kompleksitet:** liten.

---

## 1. Hva B5 konkret betyr (uke 2-scope)

Per Christers B5-svar: "datamodell-fundament. Deretter XP-beregning,
streak, leaderboard, week goals." → **uke 2 leverer KUN tabellen +
insert-hooken**, ikke XP eller UI.

Gamification-features som avhenger av denne tabellen (i senere iterasjoner):

| Feature | Avhengighet | Leveres |
|---|---|---|
| Week XP-tall per bruker | `chore_completions.user_id` + `week_year` | Senere |
| Streak (antall sammenhengende uker med ≥1 completion) | `chore_completions.user_id` aggregert over week_year | Senere |
| Leaderboard (total per bruker) | `chore_completions.user_id` aggregert all-time | Senere |
| Week goals ("5 oppgaver denne uka") | `chore_completions` count vs mål | Senere |

**Uke 2 mål:** tabellen eksisterer og fylles hver gang en chore markeres
done. Fremtidige iterasjoner kan lese fra den uten ny migrasjon.

---

## 2. Dagens tilstand — hva finnes allerede

| Komponent | Hva | Hvor | Mangler |
|---|---|---|---|
| `chore_schedules` | Per (family, week, chore) status: pending/done/postponed + completed_at | `migrations/001_initial_schema.sql` (antas) | Ingen `user_id` — vet ikke hvem som gjorde det |
| `markDone(weekYear, choreId)` | Setter status='done' | [server/repositories/chore.repo.js:84](../../server/repositories/chore.repo.js#L84) | Skriver ikke history |
| `markUndone(weekYear, choreId)` | Reverserer til pending | [chore.repo.js:98](../../server/repositories/chore.repo.js#L98) | Trenger å vite hvilken history-rad å fjerne |
| `PUT /api/chores/complete` | Rute-handler | [routes.js:1211](../../server/routes.js#L1211) | Har tilgang til `ctx.user`, men sender ikke user til repo |
| `PUT /api/chores/undone` | Rute-handler | [routes.js:1222](../../server/routes.js#L1222) | Samme |

**Gap:** Ingen history-tabell eksisterer. Hvis du sjekker av en chore i uke
17 og så uke 18, kan vi ikke vite at BEGGE skjedde — bare at den for øyeblikket
er done i uke 17 og uke 18.

---

## 3. Foreslått skjema

```sql
CREATE TABLE chore_completions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id    INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  week_year    TEXT    NOT NULL,
  chore_id     INTEGER NOT NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  xp_awarded   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_chore_completions_family_week
  ON chore_completions(family_id, week_year);
CREATE INDEX idx_chore_completions_user_week
  ON chore_completions(user_id, week_year);
```

**Design-valg:**

- **`family_id` NOT NULL + CASCADE:** tenant-isolation; sletting av familie
  rydder historikken.
- **`user_id` NULL + SET NULL:** pilot-familien bruker LOCAL_USER med
  `id=0` (syntetisk) — ingen matching i `users`. NULL er riktig. Når
  multi-tenant er aktiv får vi ekte user-id-er. Sletting av user bevarer
  historikk for aggregering (med anonym "deleted" label senere).
- **`chore_id` uten FK:** chores kan settes inaktive (`active=0`) eller
  soft-deleted. Historikken skal ikke brytes. FK til chores kunne
  vurderes med `ON DELETE SET NULL` — men siden chores ikke har
  soft-delete-semantikk ennå, er feltet minst fortsatt lesbart.
- **`week_year` TEXT:** format `YYYY-WNN` matcher `chore_schedules.week_year`
  og `seed.js:getWeekYear()`. Gjør streak-queries enkle (`ORDER BY week_year`).
- **`xp_awarded` INTEGER DEFAULT 0:** reservert for XP-beregning i senere
  iterasjon. Settes til 0 i uke 2; ingen XP-regler definert ennå.
- **Ingen `profile_member_id`:** reservert for B7 (per-medlem diett/profiler)
  som introduserer `family_profile_members`-koblinger mer eksplisitt. Legges
  til i separat migrasjon når B7 starter.

---

## 4. Hook-strategi

### 4.1 Insert ved `markDone`

Endre signatur:

```js
markDone(weekYear, choreId, { userId = null } = {})
```

Eksisterende kallere (`routes.js:1214`) må pakke ctx.user.id:

```js
const userId = ctx.user?._synthetic ? null : ctx.user?.id || null;
repos.choreSchedules.markDone(wk, choreId, { userId });
```

Implementasjon (enkeltransaksjon):

```js
const tx = db.transaction(() => {
  db.prepare(UPDATE_SCHEDULE_DONE).run(familyId, weekYear, choreId);
  db.prepare(INSERT_COMPLETION).run(familyId, weekYear, choreId, userId);
});
tx();
```

### 4.2 Delete ved `markUndone`

Samme mønster — fjern den NYESTE completion-raden for (family, week, chore).
"Nyeste" fordi man kan teoretisk ha flere completions i samme uke (sjelden,
men mulig hvis fremtidig logikk tillater "chore X to ganger per uke").

```js
const INSERT = db.prepare(`
  DELETE FROM chore_completions
  WHERE id = (
    SELECT id FROM chore_completions
     WHERE family_id = ? AND week_year = ? AND chore_id = ?
     ORDER BY completed_at DESC, id DESC
     LIMIT 1
  )
`);
```

### 4.3 Alternativet vi IKKE velger

Å la `markDone` være uendret og kjøre historikk-insert fra rute-handler
direkte. Nei: da mister vi transaksjons-atomicitet (schedule-update og
completion-insert må enten begge lykkes eller begge rulles tilbake,
ellers kan en krasj etterlate inkonsistent state).

---

## 5. Edge-cases

1. **Synthetic pilot-user (LOCAL_USER, id=0):** user_id = NULL. Completion
   logges likevel; XP kan beregnes per familie selv uten user-tilordning.
2. **Double-complete samme uke:** hvis UI av feil sender `complete` to ganger
   på rad, får vi 2 completion-rader. OK for historikk; idempotency er ikke
   krav. Men `chore_schedules.status` endres ikke (allerede 'done').
3. **Undo etter double-complete:** `markUndone` fjerner kun NYESTE completion-
   rad. Deretter `chore_schedules.status='pending'`. Inkonsistent hvis bruker
   forventer "alle completions tilbake" — men semantisk riktig (undo én
   action av gangen).
4. **Complete fra cron/background:** cron setter aldri `markDone` direkte
   (scheduler oppretter, bruker fullfører). Men hvis det skulle skje: `userId`
   blir NULL automatisk (ingen ctx.user). OK.
5. **Komplett på fremtidig uke:** `weekYear` kunne være fremtidig (brukeren
   forhåndsjekker neste uke). Vi tillater det — ingen INSERT-constraint mot
   fremtidig dato. Streak-queries må håndtere det naturlig.
6. **Chore soft-deleted etter completion:** history-raden peker til
   `chore_id` som ikke lenger er aktiv. OK — chore_id uten FK; aggregering
   kan LEFT JOIN og vise "Slettet gjøremål" hvis ønskelig.
7. **Family slettet:** CASCADE rydder opp history-rader. Leaderboard-
   aggregering må håndtere "total on-record decrease" ved familie-sletting
   — men det er et policy-valg i senere iterasjon.
8. **Migrering på eksisterende install:** tabellen er tom etter første boot
   på B5-image. Historiske done-events er FRA FØR OG IKKE BAKFØRT. Dokumenter
   i migration-kommentar at "history starter fra deploy-tidspunktet".

---

## 6. PORTAINER-OPPSTARTSRISIKO

- **Dockerfile/docker-compose:** Nei.
- **Migrasjoner:** Ja — 019, ren CREATE TABLE + INDEX. Idempotent via
  `CREATE TABLE IF NOT EXISTS`. Ingen data-endring på eksisterende rader.
- **server/config.js:** Nei.
- **server/http/bootstrap.js:** Nei.

**Konklusjon:** Risiko LAV. `CREATE TABLE IF NOT EXISTS`-mønsteret gjør
migrasjonen trygg ved re-play. Eksisterende data urørt.

---

## 7. ISO 25010-påvirkning

| Karakteristikk | Før | Etter | Kommentar |
|---|---|---|---|
| Funksjonell egnethet | 8.8 | 8.8 | Ingen brukervendt endring — bare historikk bak |
| Maintainability | 8.9 | 8.9 | Ny tabell + repo; kode-kompleksitet minimal |
| Reliability | 8.5 | 8.5 | Transaksjonell insert; ingen ny failure-modus |
| Alle øvrige | uendret | uendret | |

**Forventet løft når XP/streak/leaderboard bygges:** usability og funksjonell
egnethet.

---

## 8. Plan — commits

Per Christers "hver commit selektivt reverserbar" + "B5 som én enhet":

**C1_B5 (eneste commit):** `feat(gamification): add chore_completions table + insert hook`
- Migration `019_chore_completions.sql`
- `server/repositories/chore-completion.repo.js` (ny)
- `server/repositories/chore.repo.js` — `markDone/markUndone` utvidet med
  history-hook (samme transaksjon)
- `server/routes.js` — rute-handler sender `userId` til repo
- `tests/chore-completion.test.js` — repo-nivå tester
- `tests/chore-complete-hook.test.js` — integrasjons-test (route →
  schedule + history)

Estimert diff: ~6 filer, ~250 linjer (migration + repo + hook + 2 test-
filer + små rute-endringer).

Reverserbar: `DROP TABLE chore_completions`. Kode-revert er en git
revert av commit. B1-commits forblir intakte.

---

## 9. Spørsmål til Christer — **ingen åpne**

B5 er liten og datamodell-fokusert. Ingen strategiske valg som krever
Christer-input. Alle design-valg er dokumentert i § 3 og § 4; revurdering
kan gjøres i senere iterasjon uten å endre migration (bare legge til
senere).

---

## Status

- **Fase:** Analyse-ferdig. Starter kode umiddelbart.
- **Branch:** `feat/gamification-chore-completions` (off `feat/multi-tenant-activation`).
- **Frys-berøring:** Nei. `chore_schedules` og `chores` er ikke i DEL 6-frys.
- **Lokal CI:** full pyramide på hver commit.
- **Push:** ikke før Christer sier "nå pusher vi batch 1".
