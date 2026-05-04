# ANALYSE: Kassal ENV activation

**Dato:** 2026-05-04
**Branch:** `feat/kassal-env-activation`
**Type:** Trivial chore (env-var documentation + admin status endpoint)

## Bakgrunn

Pre-pilot audit § C3 / Sprint 7. Kassal price-comparison-infrastruktur er bygget (kassal-client.service, product-resolver, shopping-list-enricher) men aktiveres post-pilot. Pilot-deploy må ha en måte å sjekke status på + dokumentere env-var.

Eksisterende kode i `server/services/kassal-client.service.js` leser `process.env.KASSAL_API_KEY` direkte — ingen kode-endring nødvendig for runtime-gating.

## Endringer

- `server/config.js`: Lagt til `KASSAL_API_KEY: z.string().optional()` for dokumentasjon + Zod-validering.
- `server/routes.js`: Ny admin-only endpoint `GET /api/admin/kassal/status` som returnerer:
  - `enabled` (boolean): KASSAL_API_KEY satt
  - `apiKeyConfigured` (boolean): kassal-client confirms key
  - `productCount`, `resolutionCount`: antall rader i kassal_products / product_resolutions
  - `tokensAvailable`, `bucketCapacity`, `circuitOpen`, `circuitOpenUntil`: rate-limit + circuit-breaker state
- `tests/kassal-env-activation.test.js`: 3 tester (admin-gating + env-var read).

## Multi-tenant verifisert per CLAUDE.md DEL 14

- **Ny tabell?** Nei — bruker eksisterende kassal_products (global) og product_resolutions (per-family, allerede dekket av eksisterende multi-tenant-tester).
- **Ny endpoint?** /api/admin/kassal/status — admin-only, returnerer kun globale counts (ingen family-data).
- **Ny seed-data?** Nei.
- **Onboarding-endring?** Nei.

CLAUDE.md DEL 14 utløses ikke direkte. Cross-tenant-test for product_resolutions er allerede dekket i `tests/iteration3a.test.js` og `tests/iteration3b-enricher.test.js`.

## Portainer-oppstartsrisiko

Ingen. KASSAL_API_KEY er optional. Kassal-client returnerer null/no-op når key er unset (eksisterende oppførsel).

## ISO 25010

- Pålitelighet: 8.4 → 8.4 (uendret — eksisterende infrastruktur)
- Funksjonell egnethet: 8.7 → 8.7 (uendret — admin status er observasjon, ikke ny funksjonalitet)

## Kompleksitet

Liten. Konfig-dokumentasjon + ett admin-endpoint + 3 tester.
