# Integration platform — future vision (post-pilot)

**Status:** VISION DOCUMENT. Not v1 work. No implementation activity
right now. This is a strategic map for where the product potentially
moves *after* the pilot phase (week 11+), once real usage patterns are
known.

**Purpose:** Ensure that every integration we build in v1 (Kassal.app
first; Oda, Meny, etc. later) is built with the awareness that it may
become part of a larger catalog system later. That means reusable
abstractions, clear separation between "what the integration does" and
"how it is wired in", and documented metadata per integration.

---

## 1. Core vision

FamilyAssistant starts as a Norwegian family app with a handful of
ready-made integrations (Kassal.app, later Oda). But the data model,
frontend gating, and backend routing layer should from day one be
built so that, without major rewrites, we can become:

- **A Nordic platform:** more countries, more languages (see the i18n
  strategy in `docs/vision/` — to be created if relevant), more grocery
  integrations (ICA Sweden, Dansk Supermarked, etc.)
- **A centrally maintained integration catalog:** Christer (as
  operator) upgrades "official" integrations and they are
  automatically distributed to prod users.
- **Self-service extension for self-host:** a family running the app
  on their own Pi can manually add integrations that are not in the
  official catalog — via either a git-clone flow or an
  "Install integration" UI.
- **Open community contributions:** eventually we accept integration
  contributions from other developers in a curated process (PR-based,
  with review).

**Clear scope boundary against v1:** none of this is to be built now.
But v1 code must not make technical choices that would later block
this. That is the whole point of the document.

---

## 2. Use cases we are pointing at

### 2.1 "Official" integrations (prod, Christer's deploy)

Scenario:
- Christer-prod supports 5 integrations in pilot: Kassal, Oda, meal
  kits (e.g. Godt Levert), Google Calendar, Apple Calendar.
- Prod users don't need to do anything to enable them — they pick from
  a list in Settings, and Christer-prod has running API keys /
  OAuth apps for all of them at the server level.
- When an integration is updated (e.g. the Kassal API goes from v1 to
  v2), Christer rolls out a new image and all prod users get the
  update at the same time.

### 2.2 Self-host — official integrations
Scenario:
- The pilot family runs on their own RPi.
- They want to connect to Kassal — they register their own Kassal key
  in Settings (no Christer infrastructure involved — per D4).
- Google Calendar requires them to register their own OAuth app in
  the Google Cloud Console and enter the client_id + client_secret.
  The UI walks them through the setup via a wizard.
- Oda / meal kits: if these integrations require Christer-driven
  infrastructure (e.g. a proxy server that makes calls to Oda),
  self-host users must have access to that proxy or accept that some
  integrations are only available in prod.

### 2.3 Self-host — own integration
Scenario:
- A Swedish pilot family wants to connect the app to ICA (not in the
  catalog). They write their own integration in TypeScript, follow
  the integration template in `docs/development/integration-template.md`,
  install via `npm install ./local-integration-ica` or via git
  subtree. The integration registers itself at startup and becomes
  visible in Settings.

### 2.4 Community contributions (post-pilot)
Scenario:
- A Swedish family has run its ICA integration for 6 months and it
  works well. They open a PR against the main repo.
- Christer reviews the code, tests against pilot data, and merges.
- The next prod release includes ICA as an official integration.

---

## 3. Architecture principles for v1 integrations

Every integration we build (in v1: Kassal) should follow these
principles, so that they can later be part of a catalog system:

### 3.1 Metadata-first
Each integration describes itself:

```ts
// Example for Kassal
export const integrationMetadata = {
  id: 'kassal',
  version: '1.0.0',
  displayName: 'Kassal.app',
  description: 'Price comparison and offers for Norwegian grocery stores',
  countries: ['NO'],
  category: 'grocery-pricing',
  authType: 'api-key',
  requiresConfig: ['KASSAL_API_KEY'],
  provides: ['pricing', 'offers', 'store-discovery'],
  setupInstructions: {
    no: 'Registrer en nøkkel på https://kassal.app/api og lim inn i Settings',
    en: 'Register a key at https://kassal.app/api and paste it in Settings',
  },
  officialSupport: true, // vs community-maintained
};
```

This metadata object is what the catalog system (once we have it)
uses to list, filter, and present integrations.

### 3.2 Separation: core vs integration
- `server/integrations/<id>/service.js` — the integration's own code,
  API calls, error handling.
- `server/integrations/<id>/metadata.js` — the object above.
- `server/integrations/<id>/routes.js` — the integration's HTTP routes
  (optional — some integrations expose their own endpoints).
- `server/integrations/index.js` — registry that auto-discovers all
  `server/integrations/*/metadata.js` at startup and builds an
  "available integrations" list used by `/api/config/features`
  and `/api/integrations/available`.

### 3.3 Config via environment variables, not hardcoding
Each integration reads its config from env:
```
KASSAL_API_KEY=...
ODA_API_KEY=...
GOOGLE_CALENDAR_CLIENT_ID=...
```

And per-family keys (like Kassal in D4) are stored in a
`family_llm_config`-style table (per-integration config per family).

### 3.4 Do not assume "internet is available"
Each integration must gracefully handle the external service being
down, having changed its API, or requiring a new OAuth refresh.
Error messages must be operator-friendly (the RPi owner should
understand "Kassal is down, prices are from yesterday").

### 3.5 Do not hardcode country strings in the UI
Kassal is Norwegian; Oda is Norwegian; ICA is Swedish. But the UI
that presents the integration should read the country from metadata,
not from hardcoded Norwegian text in the component. This is the
prerequisite for the app to later be used by Swedish families
without a full rewrite.

### 3.6 Version-aware
Integrations are separate components developed in parallel. Each
integration has a semver version. The catalog system later can
offer "update ICA from 1.2 to 1.3" without upgrading the rest of
the app.

---

## 4. Catalog structure (post-pilot, sketch)

```
/api/integrations/catalog           → GET list of available
/api/integrations/catalog/:id       → GET details
/api/integrations/installed         → GET what the family has enabled
/api/integrations/installed/:id     → POST/DELETE enable/disable
/api/integrations/installed/:id/config  → GET/PUT per-family config
```

Integrations can be:
- **Built-in:** lives in the codebase, updated with the app
- **Remote:** downloaded from a catalog repo on first activation
- **Local:** installed manually by the operator (self-host only)

---

## 5. What is NOT done now (v1)

- **No** catalog backend
- **No** integration upload/download UI
- **No** community-submission flow
- **No** remote loading of integrations
- **No** per-integration versioning UI

V1 has only: Kassal built-in, enabled via Settings, with a per-family
key.

---

## 6. What is done NOW to preserve the future vision

V1 work (week 3-11) must follow these guidelines so that the
post-pilot vision is possible without a major rewrite:

1. **The Kassal integration** is built as `server/integrations/kassal/`
   with metadata.js, service.js, routes.js (if needed) — not
   spread across other files.
2. **`/api/config/features` and `/api/integrations/available`** answer
   dynamically based on the `server/integrations/index.js` registry,
   not a hardcoded list.
3. **Frontend uses metadata** to render integration cards in
   Settings. No component per integration — one generic
   `<IntegrationCard metadata={...} />` component that reads labels
   from metadata.
4. **Database schema for integration config** is planned as
   generic: `integration_configs(family_id, integration_id,
   config_json)` rather than one specific table per integration.
5. **Setup instructions** are delivered as i18n keys from metadata, so
   that Norwegian/English/etc. can be supported without changing the
   integration code itself.

---

## 7. Decision triggers (post-pilot)

When we reconsider this vision (earliest week 11), we look at:

- **Number of pilot families actually using self-host:** if only
  Christer-prod is used, the catalog system can be simplified to
  built-in-only.
- **How many integrations we have built by then:** if ≥ 5,
  a catalog is meaningful. If ≤ 2, wait.
- **Usage patterns in pilot:** are there integrations we did not
  anticipate (e.g. smartwatch health, Spotify playlists, home
  automation)?
- **Which integrations are "sticky" enough** that community
  contribution is realistic.

---

## 8. References

- `docs/analyses/2026-04-22-multi-tenant-activation.md` — how
  multi-tenant was enabled in week 2, providing the basis for
  per-family integration config.
- `docs/vision/` — other vision documents in the same series (to be
  created as needed: internationalization-strategy.md,
  pilot-to-prod-migration.md, etc.)
- RUNBOOK.md §13 — B2 LLM as a shared resource; similar pattern to
  integration config (global default + per-family override).

---

**Closing note:** this is a *compass*, not a *map*. The direction is
clear; the specific steps are decided during v1 development and the
pilot phase. When conditions change, this document should be updated.
