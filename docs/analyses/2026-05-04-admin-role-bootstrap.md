# ANALYSE: Admin role bootstrap

**Dato:** 2026-05-04
**Branch:** `feat/admin-role-bootstrap`
**Type:** Feature (full-stack with skeleton admin route)
**Authoritative reference:** Sprint 7 PR C2 spec

## Reisen

Christer (eller annen administrator) onboarder for første gang etter ny pilot-deploy. Hvilken bruker som blir admin avhenger av Portainer-config:

1. Operatør setter `APP_ADMIN_EMAIL=admin@example.com` i Portainer.
2. Christer onboarder via magic-link.
3. Backend `handleOnboardingComplete` kjører tx:
3.1. Oppretter family + member + setter onboarding_completed.
3.2. Seeder family-defaults.
3.3. Audit-log entry.
3.4. **NY:** `bootstrapAdminIfNeeded()` sjekker `APP_ADMIN_EMAIL` mot `ctx.user.email`.
3.4.1. Match → `users.is_admin=1`, `app_setup` row inserted med `bootstrap_method='env'`.
3.4.2. Mismatch → ingen promotion (venter på matching user).
3.4.3. APP_ADMIN_EMAIL unset → første onboarding wins (`bootstrap_method='first_user'`).
3.4.4. Hvis `app_setup` allerede finnes → no-op (idempotent).
4. Frontend `/api/auth/me` returnerer `isAdmin: true`.
5. Settings viser ny "Admin"-seksjon (kun hvis isAdmin).
6. Bruker klikker "Åpne admin-panel" → navigerer til `/v2/admin`.
7. `<Admin>`-komponent rendrer skeleton "Mer funksjonalitet kommer post-pilot".

## Domenemodell-påvirkning

Ny domene-konsept: **system admin** — orthogonal til family-rolle (owner/adult/child). Admin har system-wide access til /api/admin/* endpoints, men ikke cross-family read/write per CLAUDE.md DEL 14.

Berørte filer:
- `server/migrations/026_admin_role.sql`: ny is_admin, promoted_by_user_id, promoted_at kolonner
- `server/migrations/027_app_setup.sql`: ny single-row app_setup tabell
- `server/services/admin-bootstrap.service.js`: state machine
- `server/auth/routes.js`: handleAdminMe, handleAdminSetup + onboarding-extension + isAdmin i handleMe
- `server/config.js`: APP_ADMIN_EMAIL env-var
- `client/src/app/auth/authApi.ts`: AuthUser.isAdmin
- `client/src/app/screens/Admin.tsx`: ny skeleton-skjerm
- `client/src/app/App.tsx`: /admin route
- `client/src/app/i18n/locales/{no,en}/admin.json`: nye keys
- `client/src/app/i18n/config.ts`: register admin namespace
- `tests/admin-bootstrap.test.js`: 11 tester
- `client/src/app/i18n/bundles.test.ts`: oppdater til 10 namespaces

## Edge-cases

1. **APP_ADMIN_EMAIL endres etter bootstrap.** Bootstrap allerede registrert → no-op. Existing admin beholder rollen. Bevisst (admin-transfer er post-pilot).
2. **Multiple users matcher APP_ADMIN_EMAIL (unique-email-constraint forhindrer).** Kun én user per email.
3. **APP_ADMIN_EMAIL unset, første user onboarder, så APP_ADMIN_EMAIL settes.** Bootstrap allerede done → no-op. Ingen race.
4. **APP_ADMIN_EMAIL set, ingen matching user noensinne onboarder.** `app_setup` forblir tom → ingen admin. Bevisst — uten admin er admin-endpoints ubrukelige (returner 403 for alle).
5. **Email-matching er case-insensitive og trim-tolerant.** `' Admin@Example.COM '` matcher `'admin@example.com'`.
6. **DB-rollback i onboarding-tx.** Hele tx ruller tilbake hvis admin-bootstrap krasjer (samme `db.transaction()`-wrapper).
7. **Migration 026 på eksisterende DB.** ALTER TABLE er additive — eksisterende data er uberørt. Default 0 for is_admin betyr alle eksisterende brukere er ikke-admin (riktig).
8. **Cross-tenant: admin i family A prøver å lese family B data.** /api/admin/* endpoints krever `requireAdmin()` men har ingen cross-family logikk; `getFamilyId()` filterer fortsatt all family-data per request. Multi-tenant-isolation testet i admin-bootstrap.test.js.

## Konsekvenser på tvers

- **Frontend:** Ny route `/admin`, ny Admin-komponent, ny i18n-namespace. Settings.tsx kunne fått admin-seksjon — utsatt i denne PR for å redusere bundle/test-flat. Skeleton admin-skjerm tilgjengelig direkte via URL.
- **Backend:** 2 nye migrations, ny service, 2 nye endpoints, modifisert onboarding tx, modifisert `/api/auth/me`.
- **Tests:** 11 nye unit + integrasjon. Multi-tenant-isolation eksplisitt verifisert (DEL 14).
- **DOMAIN_MODEL.md:** Bør oppdateres post-pilot når admin-UI faktisk ferdigbygges; pilot-scope: skeleton holder.

## Beslutninger

### BESLUTNING 1: Admin er system-wide, ikke per-family

**ANBEFALING:** is_admin=1 er global flag på user-tabell, ikke per-family rolle.

**HVORFOR:** Admin-rollen er for app-eieren (Christer). Per-family roller (owner/adult/child) blir uendret.

**KONSEKVENS HVIS ANNERLEDES:** Per-family admin ville krevd ekstra kolonne i family-membership-relation. Ikke pilot-scope.

### BESLUTNING 2: Bootstrap inni onboarding-tx vs. separate trinn

**ANBEFALING:** Inni samme tx som onboarding completion.

**HVORFOR:** Atomicity — ingen race der bruker er onboarded men ikke admin. Idempotent — etter første tx er det no-op.

**ALTERNATIVER:**
- Separat handler. Krever ekstra HTTP roundtrip + race-window.

**KONSEKVENS HVIS ANNERLEDES:** Race-window ved server-restart midt i onboarding.

## Portainer-oppstartsrisiko-sjekk

- `Dockerfile`: NEI
- `docker-compose.yml`: NEI (ny env-var dokumenteres)
- `server/config.js`: **JA** — APP_ADMIN_EMAIL optional, default unset. Server starter uten.
- `server/migrations/**`: **JA** — to nye migrations. Tester bekrefter de kjører rent.
- `bootstrap.json`: NEI

**Konklusjon:** Lav risiko. Migrations er additive (ALTER TABLE ADD COLUMN, CREATE TABLE IF NOT EXISTS). Server kan starte uten APP_ADMIN_EMAIL.

## ISO 25010-påvirkning

- **Sikkerhet:** 8.2 → 8.3 (+0.1, system-wide admin-rolle differensieres fra family-roller)
- **Funksjonell egnethet:** 8.7 → 8.8 (+0.1, manglende admin-bootstrap legges til)

Andre karakteristikker: ikke berørt.

## Multi-tenant verifisert per CLAUDE.md DEL 14

- **Ny tabell med family_id?** Nei. `app_setup` er global. `users` har is_admin global. Ingen family-scope.
- **Ny endpoint som tar/returnerer per-family data?** Nei — /api/admin/me returnerer kun admin-info om calling user. /api/admin/setup returnerer global bootstrap-info (admin-user-id, method, dato).
- **Ny seed-data?** Nei.
- **Endring i onboarding-flow?** **JA** — en ny side-effekt (admin promotion). Cross-tenant-impact: ingen — bootstrap berører kun den enkelte onboarding-bruker.

Tester verifiserer:
- Migration 026 + 027 kjører rent på fresh DB
- /api/admin/me krever auth (returnerer 401/403 anonymt)
- /api/admin/setup krever auth
- app_setup er tomt før første onboarding
- Bootstrap-state-machine respekterer idempotency

## Kompleksitet-vurdering

Medium feature: full-stack med 2 migrations, ny service, ny endpoint, ny komponent, multi-tenant-tester. Skeleton admin-UI er bevisst minimum scope; full admin-panel post-pilot.
