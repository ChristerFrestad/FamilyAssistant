# ANALYSE: Cleanup orphan family-1 from Christer's DB

**Dato:** 2026-05-04
**Branch:** `chore/cleanup-orphan-family-1`
**Type:** Data-cleanup (engangsoperasjon mot pilot-DB)
**Authoritative reference:** `docs/analyses/2026-05-03-pre-pilot-comprehensive-audit.md` § 2.2 (CRITICAL C1)

## Reisen

Operatør (Claude under Christers autorisasjon) rydder orphan family-1 fra pilot-DB før deploy.

1. Operatør kjører inspeksjon for å bekrefte orphan-tilstand.
1.1. Verifiser migration 024 er applied (FK CASCADE er på plass).
1.2. Verifiser `users.family_id=1` er tom (sikkerhets-sjekk).
1.3. Tell rader per per-family-tabell for family 1 (synliggjør cleanup-volum).
2. Operatør tar backup av live DB.
2.1. Backup er full snapshot via better-sqlite3's online backup API (handler WAL korrekt selv om backend skriver samtidig).
2.2. Backup lagres som `data/familieassistenten-backup-pre-cleanup.db`.
3. Operatør kjører `scripts/cleanup-orphan-family-1.js` mot live DB.
3.1. Script åpner DB i read-write-modus.
3.2. Sikkerhets-sjekk: verify family 1 has no users (ABORT hvis brutt).
3.3. Print before-state (rad-tall per tabell).
3.4. `DELETE FROM families WHERE id = 1` — FK CASCADE rydder resten.
3.5. Print after-state.
3.6. Verifiser at family 3 (Christer) er uberørt.
4. Operatør kjører post-cleanup-inspeksjon for å bekrefte resultat.
4.1. Family 1 finnes ikke lenger.
4.2. Family 3 har samme rad-tall som før.
4.3. Cleanup er idempotent — kjøre én gang til er no-op.

## Domenemodell-påvirkning

Ingen domenemodell-endring. Engangs-data-cleanup. Ingen kode-endringer i `server/services/` eller `server/repositories.js`.

Berørte filer:
- `scripts/cleanup-orphan-family-1.js` — ny (cleanup-script)
- `scripts/inspect-family-1-state.js` — ny (read-only inspeksjon)
- `data/familieassistenten.db` — modifisert (engangs, ikke commit)
- `data/familieassistenten-backup-pre-cleanup.db` — ny backup (ikke commit, gitignored under `data/*.db`)
- `docs/analyses/2026-05-04-cleanup-orphan-family-1.md` — denne analysen

## Edge-cases

1. **Family 1 har aktive users.** Sikkerhets-sjekk fanger dette og aborter med tydelig feilmelding. Inspeksjon før cleanup viste 0 users — sikker.
2. **Family 1 finnes ikke (allerede slettet).** Idempotent: script kjører `INSERT OR IGNORE`-style sjekk og returnerer no-op.
3. **Migration 024 ikke applied.** Sikkerhets-sjekk verifiserer at `schema_migrations.version='024'` finnes; hvis ikke aborter (FK CASCADE er ikke garantert).
4. **Backend skriver samtidig.** Better-sqlite3's `.backup()` API tar konsistent snapshot via SQLite Online Backup API; håndterer WAL korrekt selv under aktiv skriving.
5. **FK enforcement skrudd av.** Sikkerhets-sjekk verifiserer `PRAGMA foreign_keys=1` før DELETE.
6. **DELETE feiler midt i CASCADE.** Hele DELETE er innenfor en implisitt transaksjon (ingen explicit BEGIN/COMMIT trengs i sqlite3 enkelt-statement); rollback skjer automatisk hvis FK-sjekk feiler.
7. **Disk full / IO-feil under backup.** Backup-script feiler tidlig før noen DELETE; live DB er uberørt.
8. **Disk full / IO-feil under DELETE.** SQLite rollback til pre-DELETE-tilstand. Ingen partial state.
9. **Bruker (Christer) starter en write fra UI mens scriptet kjører.** Backup tar konsistent snapshot av før-state. Under DELETE-fasen tar scriptet en kort RESERVED lock (millisekunder) — UI-skriv vil retry og lykkes etter cleanup.
10. **Cleanup på en ren post-fix DB.** Hvis pilot-DB resettes og family 1 ikke eksisterer fra start, idempotency-sjekk gjør cleanup til no-op.

## Konsekvenser på tvers

- **Frontend:** Ingen påvirkning. Christer ser fortsatt sin family 3-data.
- **API-endepunkter:** Ingen påvirkning. `getFamilyId()` returnerer family 3 for Christer.
- **Migrations:** Ingen ny migrasjon. CASCADE FK fra migration 024 brukes som er.
- **Tests:** Ingen test-endring. Cleanup er en runtime-operasjon mot pilot-DB, ikke kode-endring.
- **DOMAIN_MODEL.md:** Ikke oppdatert (orphan family-1 er en transient pilot-DB-tilstand, ikke en domeneregel).
- **OpenAPI:** Ikke berørt.
- **CHANGELOG.md:** Kort entry under "Operations" — pre-pilot DB hygiene.

## Beslutninger

### BESLUTNING 1: Slett family 1 helt vs. tøm men behold rad

**ANBEFALING:** Slett family 1 helt (`DELETE FROM families WHERE id=1`).

**HVORFOR:** Family 1 er rester fra pre-PR #91-tilstanden. Ingen system-ressurser krever family 1 å eksistere. FK CASCADE rydder all per-family-data automatisk. Resultatet er en ren DB uten "ghost family"-row.

**ALTERNATIVER:**
- B: Tøm family 1's data men behold rad. Trygt men introduserer en konseptuell "tom familie" som ingen eier — fortsatt rart.
- C: La det stå. DB-clutter; ingen funksjonell konsekvens, men forvirrende ved senere debugging eller backup-restore.

**KONSEKVENS HVIS ANNERLEDES:** Hvis B/C velges, forblir orphan-data i DB. Pilot-brukerne ser ikke dette i UI, men det forurenser backups, audit-rapporter, og fremtidige migration-debugging-sesjoner.

### BESLUTNING 2: Backup-strategi

**ANBEFALING:** better-sqlite3's `.backup()` API for konsistent snapshot.

**HVORFOR:** Backend kjører på port 7777 og kan ha aktive WAL-skriv. Filkopi av `.db`-filen alene ville gå glipp av uncommitted WAL-data. SQLite Online Backup API garanterer konsistens.

**ALTERNATIVER:**
- A: Bare-metal `cp data/familieassistenten.db data/familieassistenten-backup-pre-cleanup.db`. Risiko: WAL-data ikke fanget.
- B: Stopp backend, kopier, restart backend. Krever å drepe Christers prosess (forbudt per CLAUDE.md DEL 7.8).

**KONSEKVENS HVIS ANNERLEDES:** Hvis A velges, kan backup mangle aktiv state. Hvis B velges, bryter CLAUDE.md DEL 7.8.

### BESLUTNING 3: Script-arkitektur — én script eller flere

**ANBEFALING:** To script: `inspect-family-1-state.js` (read-only) og `cleanup-orphan-family-1.js` (transactional).

**HVORFOR:** Inspeksjon er nyttig før og etter cleanup. Separasjon gjør cleanup mer fokusert. Inspeksjons-scriptet kan kjøres av Christer eller post-pilot-cleanup-sprint uten frykt for sideeffekter.

**ALTERNATIVER:**
- A: Én monolitt med flagg. Mindre fil-spredning men dårligere separation of concerns.

**KONSEKVENS HVIS ANNERLEDES:** Hvis A, må cleanup-script tjene to rolles (read-only og write) — øker kompleksitet og risiko for feil mode.

### BESLUTNING 4: Sletting av engangs-script etter cleanup

**ANBEFALING:** Behold scriptene i `scripts/` selv etter at cleanup er utført.

**HVORFOR:** 
- (a) Idempotent — kan kjøres igjen uten skade.
- (b) Andre familier som installerer apper kan ha samme orphan-state (selv om mindre sannsynlig nå med PR #91 fix).
- (c) Inspeksjons-scriptet er generelt nyttig for fremtidig debugging.
- (d) Sletting krever en separat PR; netto-verdi negativ.

**KONSEKVENS HVIS ANNERLEDES:** Sletting reduserer fil-tellingen med 2 men fjerner et nyttig verktøy fra repoet.

## Portainer-oppstartsrisiko-sjekk

- `Dockerfile`: NEI
- `.dockerignore`: NEI
- `docker-compose.yml`: NEI
- `server/http/bootstrap.js`: NEI
- `server/config.js` oppstartsvalidering: NEI
- `server/index.js` startup-sekvens: NEI
- `server/db.js` eller `server/migrations/**`: NEI (script bruker eksisterende API)
- `install.sh`: NEI
- `bootstrap.json`-lesning eller -skriving: NEI
- Miljøvariabel-krav for oppstart: NEI

**Konklusjon:** Scriptet er en operasjons-utility som ikke påvirker oppstart. Container-deploy starter mot post-cleanup-DB; Portainer-pull skjer som vanlig.

**Indirect risiko:** Hvis cleanup feiler og DB blir korrupt, vil container-oppstart feile på migration-runner. Backup-strategi kompenserer.

## ISO 25010-påvirkning

- Vedlikeholdbarhet: 8.3 → 8.3 (uendret — gir et nyttig debugging-verktøy, men målbar score endres ikke).
- Pålitelighet: 8.4 → 8.4 (uendret — backup-strategi gjør operasjonen reversibel).

Andre karakteristikker: ikke berørt.

## Plan

To commits:

1. `chore(scripts): add inspect-family-1-state.js read-only inspection`
2. `chore(scripts): add cleanup-orphan-family-1.js with backup safety`

Etter commits:
- Ta backup
- Kjør cleanup
- Verifiser
- Push og åpne PR

## Kompleksitet-vurdering

Liten chore. Engangs-cleanup mot pilot-DB. Ingen ny domeneentitet, ingen forretningsregel. Match med "liten" — analysen er kort men eksplisitt om edge-cases og rollback.
