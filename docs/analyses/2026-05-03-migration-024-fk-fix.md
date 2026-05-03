# Hotfix: migration 024 fails with FOREIGN KEY constraint failed on Christer's DB

**Dato:** 2026-05-03
**Branch:** `hotfix/migration-024-fk-aware-runner`
**Symptom:** Backend startup blocker — migration 024 ruller tilbake.

```
[MIGRATE] ✗ FEIL i 024_family_id_strict_constraints.sql:
FOREIGN KEY constraint failed
[DB] sql.js heller ikke tilgjengelig: FOREIGN KEY constraint failed
```

## Reisen

1. Christer pull-er main etter PR #90 merge.
2. Backend-oppstart kalles med `data/familieassistenten.db` på disk.
   2.1. `server/db.js:initDB()` åpner DB og setter `foreign_keys = ON`.
   2.2. `runMigrations()` itererer migration-filer 001..024 sortert.
   2.3. 001..023 er allerede registrert i `schema_migrations`. Hoppes over.
   2.4. 024 er IKKE registrert. Kjøres i en transaksjon via `db.transaction(...)`.
3. Migration 024 utfører rebuild-dansen for hver av 17 tabeller:
   3.1. `CREATE TABLE recipes__new (...)` med ny FK til `families`.
   3.2. `INSERT INTO recipes__new SELECT ... FROM recipes` (alle 36 rader kopieres).
   3.3. `DROP TABLE recipes` — **feiler her med FK constraint**.
4. Transaksjonen rulles tilbake. DB er uendret. Backend krasjer videre i oppstart.
5. Christer kan ikke kjøre `scripts/repair-orphan-family-seed.js` fordi det
   krever en initialisert DB.
   5.1. Catch-22: repair-script trenger backend, backend trenger migration 024,
        migration 024 feiler fordi data ikke er repaired.

## Diagnose

`scripts/diagnose-orphans.js` ble skrevet og kjørt mot Christer's DB. Funn:

- **0 orphan family_id-rader.** Alle rader peker på eksisterende families (id 1, 3).
- **0 orphan FK-rader på de 17 tabellene migration 024 rebuild-er.**
- **PRAGMA foreign_key_check returnerer 0 violations.**

Det betyr brukerens hypotese ("orphan meal_plans for family_id=3 forårsaker FK-feil")
er teknisk feil. Det er ingen brutte FK-er i utgangspunktet.

`scripts/test-migration-024-stepwise.js` kjører migrationen statement for statement
og avslører den faktiske feilende setningen:

```
[3/123] FAIL: DROP TABLE recipes
  Error: FOREIGN KEY constraint failed
```

### Faktisk rotårsak

`meal_plans.recipe_id` har FK til `recipes(id)` (migrasjon 014, linje 207):

```sql
recipe_id INTEGER REFERENCES recipes(id),
```

Med `PRAGMA foreign_keys = ON` blokkerer SQLite `DROP TABLE recipes` så lenge
en annen tabell har rader som refererer til den. Christer har 14 meal_plans-rader
(7 for family_id=1, 7 for family_id=3) som alle peker på recipes(1..7). Selv om
recipes-tabellen blir gjenopprettet umiddelbart etterpå med `RENAME recipes__new
TO recipes` og samme IDs bevart, fyrer FK-checken ved DROP-statementet — før
RENAME-en får en sjanse til å gjenopprette referansene.

`PRAGMA defer_foreign_keys = 1` (transaksjons-scoped utsettelse) testet i
`scripts/test-defer-fk-fix.js` — fikser det IKKE for DROP TABLE. SQLite
deferer ikke DROP TABLE-FK-checks selv med dette flagget.

## Løsning: FK-aware migration runner

SQLite's offisielle anbefaling for table-rebuilds som har innkommende FK-er
(https://sqlite.org/lang_altertable.html#otheralter):

```
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;
-- ... do whatever schema modifications ...
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;
```

Endringene:

1. **`server/migrations/index.js`:** wrap migration-kjøringen i et FK-OFF/ON-skjelett.
   Inni transaksjonen, etter migration-statementene men før schema_migrations
   INSERT, kjør `PRAGMA foreign_key_check`. Hvis det returnerer rader, throw med
   detaljert feilmelding så transaksjonen rulles tilbake.

2. **Per-migration sikkerhetsnett:** `foreign_key_check` etter hver migration
   sikrer at vi ikke skjuler data-konsistens-bugs. Hvis en bug i fremtidig
   migration etterlater orphans, fanger denne sjekken det FØR commit.

3. **`PRAGMA foreign_keys` settes utenfor transaksjon** fordi SQLite ignorerer
   endringer i denne pragma-en inne i en aktiv transaksjon.

## Domenemodell-påvirkning

Ingen domenemodell-endring. Dette er ren infrastruktur — migration runner
oppfører seg mer robust.

- `server/migrations/index.js`: ny FK-håndtering rundt hver migration
- `tests/phase22-bootstrap.test.js` eller ny test: verifiser at runner
  klarer rebuild med innkommende FK-er

## Edge-cases

1. **Migration har INGEN table rebuilds.** Ingen endring — FK off/on har null-effekt.
2. **Migration har orphans i data (legitim bug).** `foreign_key_check` etter
   migration fanger det og ruller tilbake transaksjonen.
3. **Migration runner kjøres med FK allerede ON.** Den slår av, kjører, slår på igjen — idempotent.
4. **Migration runner kjøres med FK allerede OFF (test-context).** Den slår av (no-op), kjører, slår på.
   - **Risiko:** test som forventet FK=OFF etter migrations vil bli forstyrret.
     Sjekkes i test-suite.
5. **Crash mid-migration.** Transaksjonen rulles tilbake. FK settes til ON i
   `finally`-block, så DB ender i konsistent FK=ON-tilstand selv ved feil.
6. **sql.js fallback-driver.** Bruker samme `db.pragma()`-API som
   better-sqlite3 via adapter. Verifiser at adapter støtter pragma.
7. **Migration som selv kjører `PRAGMA foreign_keys`-statements.** Ingen finnes
   i dagens migrations.
8. **Fremtidig migration som forventer FK=ON inne i seg.** Inne i transaksjonen
   er FK fortsatt OFF. Hvis en migration faktisk trenger FK-enforcement under
   sin egen kjøring, må den eksplisitt skrue det på. Ingen dagens migrations
   trenger det.

## Konsekvenser på tvers

- **Frontend:** ingen
- **API:** ingen
- **Database-migrasjoner:** ny "FK off-around-migration"-pattern; eksisterende
  applikerte migrations påvirkes ikke (de er allerede merket applied).
- **Tester:** verifisere at runner-endring ikke regresserer eksisterende
  bootstrap-tester.
- **DOMAIN_MODEL.md:** ingen endring.
- **CHANGELOG.md:** legg til hotfix-entry.

## Beslutninger

### BESLUTNING 1: FK-runner-endring vs self-healing migration

**ANBEFALING:** FK-aware runner (Approach B).

**HVORFOR:**
- Brukerens foreslåtte Approach A baserer seg på diagnose som ikke holder.
  Diagnostikk viser at det er ingen orphans å slette — alle FK-referanser er
  intakte mot dagens schema. Approach A som beskrevet (slett orphans der
  recipe_id ikke matcher samme family_id) ville etterlatt 7 meal_plans for
  family_id=1 — som fortsatt blokkerer DROP TABLE recipes.
- For at Approach A skal fungere måtte ALLE 14 meal_plans-rader slettes,
  som er destruktivt og unødvendig.
- FK-aware runner er SQLite's offisielle anbefaling for table-rebuilds.
- Bevarer all data 100%. Christer's 7 family_id=3 meal_plans bevares for
  repair-script-en å reparere etterpå.

**ALTERNATIVER:**
- **Approach A (DELETE meal_plans i migration 024):** sletter Christer's
  data unødvendig; fungerer ikke som beskrevet (måtte slette alle 14 rader,
  ikke bare orphans).
- **Approach C (pre-migration repair-script):** krever at Christer kjører
  noe manuelt før restart; ikke idempotent for fremtidige brukere; løser
  ikke fremtidige migration-rebuilds som har samme problem.

**KONSEKVENS HVIS ANNERLEDES:** Hvis Approach A velges må vi slette ALLE
meal_plans-rader (dokumentert som "akseptabelt" i user's prompt, men jeg
mener det er unødvendig dataforringelse).

### BESLUTNING 2: foreign_key_check inne i transaksjonen

**ANBEFALING:** ja, kjør `PRAGMA foreign_key_check` etter migration-statementene
men før schema_migrations-INSERT, inne i transaksjonen.

**HVORFOR:** SQLite's anbefaling. Fanger data-konsistens-bugs i migrations
før commit. Ruller tilbake automatisk hvis violations finnes.

**ALTERNATIVER:**
- Ingen sjekk: skjuler bugs.
- Sjekk etter commit: kan ikke rulle tilbake.

**KONSEKVENS HVIS ANNERLEDES:** Vi tar på oss risiko for å silently committe
inkonsistent data.

## Portainer-oppstartsrisiko-sjekk

| Område | Berørt? | Detaljer |
|---|---|---|
| `Dockerfile` / `.dockerignore` | Nei | |
| `docker-compose.yml` | Nei | |
| `server/http/bootstrap.js` | Nei | |
| `server/config.js` startup-validering | Nei | |
| `server/index.js` startup-sekvens | Nei | |
| `server/db.js` | **Nei direkte**, men `runMigrations()` kalles herfra | |
| `server/migrations/**` | **JA** | `index.js` endres |
| `install.sh` | Nei | |
| `bootstrap.json`-håndtering | Nei | |
| Miljøvariabel-krav | Nei | |

**JA — Portainer-oppstartsrisiko utløst.** PORTAINER-RISIKO-prosedyre per DEL 3 Steg 3b:

### Hele oppstartstien

```
Portainer pull → container create → bootstrap.json load
  → server/config.js validate
  → server/index.js startup
    → server/db.js initDB()
      → better-sqlite3 open
      → pragma foreign_keys = ON
      → runMigrations(db)         ← endres
        → for each unapplied migration:
          → pragma foreign_keys = OFF (ny)
          → BEGIN TRANSACTION (eksisterende)
            → exec migration SQL
            → PRAGMA foreign_key_check (ny)
            → INSERT schema_migrations
          → COMMIT (eksisterende)
          → pragma foreign_keys = ON (ny)
    → server.listen()
  → healthcheck OK
```

### Hva som kan gå galt på hvert berørt punkt

1. **`pragma foreign_keys = OFF` feiler:** kan ikke skje under normal drift;
   pragma er core SQLite. Hvis det skjedde ville migrationen aldri startet.
2. **Migration-statement feiler (eksisterende oppførsel):** transaksjonen
   rulles tilbake, FK settes ON i finally-block, runMigrations throw-er.
   Backend krasjer som før — samme oppførsel som dagens kode.
3. **`PRAGMA foreign_key_check` returnerer rader:** ny logikk throw-er med
   detaljert feilmelding listet violations. Transaksjonen rulles tilbake.
4. **`pragma foreign_keys = ON` etter commit feiler:** logges som warning
   men crash-er ikke; FK kommer automatisk på ved neste DB-handle-åpning
   siden `tryBetterSqlite3()` setter den i `db.js:71`.

### Rollback-strategi i produksjon

1. Hvis Christer pull-er denne hotfix-en og noe går galt: Portainer pull
   den forrige `:main` image (selv om Portainer pull-er auto, kan han manuelt
   sette en eldre tag).
2. Backup-DB-en `data/familieassistenten-backup.db` lages før migration.
3. Restore: stopp container, kopier backup over hovedfil, start container.

### Eksplisitt test for oppstartsflyt

`tests/migration-runner-fk-aware.test.js` (ny):
- Bygger en in-memory DB med meal_plans → recipes-FK og 14 rader
- Kjører migration 024 via runMigrations
- Verifiserer suksess + 0 FK violations etter migration

## ISO 25010-påvirkning

- **Pålitelighet 8.7 → 8.8 (+0.1):** migration runner blir mer robust mot
  table-rebuild-feil; eksplisitt FK-check etter hver migration fanger
  data-bugs tidlig.
- **Vedlikeholdbarhet 8.4 → 8.4 (uendret):** noe mer kode i runner, men
  det reflekterer SQLite's offisielle anbefaling.
- **Sikkerhet 8.2 → 8.2 (uendret):** FK-OFF-vinduet er bare under migrations,
  som uansett kjøres som privileged operation ved oppstart.
- **Funksjonell egnethet 8.5 → 8.5 (uendret):** ingen feature-endring.

## Plan

1. `feat`: oppdater `server/migrations/index.js` med FK-aware runner.
2. `test`: ny `tests/migration-runner-fk-aware.test.js`.
3. `chore`: kjør hele test-suiten lokalt for å verifisere ingen regresjon.
4. `docs`: CHANGELOG-entry.

Ingen endring i migration 024 SQL-filen. Ingen sletting av Christer's data.

## Kompleksitets-vurdering

Christer flagget dette som "KRITISK BUG i migration 024 deployment" med
catch-22-flow. Min analyse bekrefter kompleksitet — det er en blocker, og
fix-en treffer migration runner som er Portainer-kritisk. Full analyse
nødvendig (denne fila).
