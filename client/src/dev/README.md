# Dev-only code boundary

This folder is the home for development tooling that must never ship
to production:

- Component-preview galleries for designer and reviewer handoffs
- Debug panels, devtool sketches, and test harnesses
- One-off probes and experimental spikes

## The rules

- Code under `client/src/` outside this folder (the production app)
  **cannot import from `client/src/dev/`.** The boundary is enforced
  at build time by the `enforce-dev-isolation` Vite plugin in
  `client/vite-plugins/enforce-isolation.ts`. Violations fail the
  build with a clear error pointing at the offending importer.
- Code under `client/src/dev/` **can import from `client/src/app/`**
  freely — a preview page for `Button` should obviously import
  `Button`. There is no restriction in that direction.
- The test at `tests/client-dev-isolation.test.js` proves both the
  violation case and the control case every time the test suite runs.
- If an ESLint `no-restricted-imports` rule is configured for the
  client folder, it is a secondary defense that surfaces the same
  violations earlier, in the editor.

## If you need to share code

If something you wrote in `dev/` turns out to be useful to the
production app, move it into `client/src/app/lib/` (or wherever it
fits) first, then import it from both places. Do not reach through
the boundary.

See CLAUDE.md section 7.7 and `docs/workflow/pre-deploy-cleanup-plan.md`
for the broader technical-debt context this boundary supports.
