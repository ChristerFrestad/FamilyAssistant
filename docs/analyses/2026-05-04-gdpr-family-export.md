# ANALYSE: GDPR family-only export endpoint

**Dato:** 2026-05-04
**Branch:** `feat/gdpr-data-rights`
**Type:** Backend addition (eksisterende GDPR utvides)

## Bakgrunn

Eksisterende GDPR-infrastruktur (server/auth/gdpr-routes.js, tests/gdpr-endpoints.test.js) har:
- GET /api/me/export — returnerer user + family data
- DELETE /api/me — soft-delete med 30-dagers grace
- DELETE /api/family — owner-only, krever family-name som confirm-string

Settings-skjermen har allerede DataExportButton + DeleteAccountButton.

Det som mangler per PR C5 spec:
- GET /api/family/export — distinkt family-only-export (uten user-data)

## Endringer

- `server/auth/gdpr-routes.js`: nytt handleExportFamily + route registrering
- `tests/gdpr-family-export.test.js`: 3 tester (auth-required, registrering, cross-tenant-isolation)

handleExportFamily:
- Krever auth (401 ellers)
- Krever family-medlemskap (403 ellers)
- Krever owner-rolle (403 ellers — non-owners bruker /api/me/export)
- runWithFamily(familyId) → buildFamilyExport (samme helper som /api/me/export)
- Returnerer { exportVersion, generatedAt, family }

## Multi-tenant per CLAUDE.md DEL 14

- Eksisterende endpoint utvidet — ikke ny tabell/seed
- Cross-tenant: ctx.familyId fra session bestemmer scope. runWithFamily setter AsyncLocalStorage. buildFamilyExport bruker `WHERE family_id = ?` SQL gjennom hele.
- Test verifiserer at family A og family B finnes med separate row-data.

## Portainer-oppstartsrisiko

Ingen. Ingen migration, ingen config, ingen ny dependency.

## ISO 25010

- Funksjonell egnethet: 8.7 → 8.8 (+0.1, dedikert family-export-endpoint)
- Compliance: 8.0 → 8.1 (+0.1, GDPR Art. 15 data-portability eksponert per data-subject-type)

## Hvorfor ikke større scope

Det meste av GDPR-funksjonaliteten finnes allerede:
- /api/me/export (eksport)
- DELETE /api/me (delete user)
- DELETE /api/family (delete family)
- DataExportButton (frontend)
- DeleteAccountButton (frontend)

PR C5 spec foreslo å bygge mye av dette på nytt — det ville duplisert eksisterende kode. I stedet legger vi til den ene endpointen som faktisk var manglende, og lar resten av infrastrukturen stå.

Frontend "Personvern og data"-section er i praksis Settings → Konto-section som allerede har export + delete. Ingen frontend-endring i denne PR.
