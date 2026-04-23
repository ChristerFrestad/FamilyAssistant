import type { Plugin } from 'vite';

// Vite plugin that forbids code in client/src/ (excluding client/src/dev/)
// from importing modules under client/src/dev/. The plugin runs in both
// dev and prod builds, so violations fail fast with a clear error message
// during npm run dev:client and npm run build:client alike.
//
// Why: client/src/dev/ holds development-only tooling — component-preview
// galleries for designer review, debug panels, one-off probes. These must
// never ship in the production bundle. A soft convention would drift over
// time; a build-time hard failure keeps the boundary honest.
//
// Allowed direction:
//   app -> app      ok
//   dev -> app      ok  (a preview page MAY import the real Button)
//   dev -> dev      ok
// Forbidden:
//   app -> dev      fails the build
//
// The test harness at tests/client-dev-isolation.test.js proves this
// plugin actually fails a real Vite build on violation. See also
// CLAUDE.md section 7.7 and docs/workflow/pre-deploy-cleanup-plan.md.

// Rollup and Vite normalize every importer/resolved path to forward
// slashes even on Windows, so the substring markers use "/". Do NOT
// switch to path.sep — on Windows that is "\" and the include() check
// would always return false for paths Vite produces.
const CLIENT_SRC_MARKER = '/client/src/';
const DEV_DIR_MARKER = '/client/src/dev/';

export default function enforceDevIsolation(): Plugin {
  return {
    name: 'familieassistenten:enforce-dev-isolation',
    enforce: 'pre',

    async resolveId(source, importer, options) {
      if (!importer) return null;

      // Normalize Windows-style backslashes just in case. Rollup/Vite
      // should already give us forward slashes, but this is cheap
      // insurance against an upstream change.
      const normalizedImporter = importer.replace(/\\/g, '/');
      const importerInClientSrc = normalizedImporter.includes(CLIENT_SRC_MARKER);
      const importerInDev = normalizedImporter.includes(DEV_DIR_MARKER);
      const importerIsAppCode = importerInClientSrc && !importerInDev;
      if (!importerIsAppCode) return null;

      // Ask the pipeline to resolve the target the normal way. If the
      // result is a file under client/src/dev/, the boundary is violated.
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved || resolved.external) return null;

      const normalizedResolved = resolved.id.replace(/\\/g, '/');
      if (normalizedResolved.includes(DEV_DIR_MARKER)) {
        this.error({
          message:
            `[enforce-dev-isolation] Illegal import: app code cannot import from client/src/dev/\n` +
            `  importer: ${importer}\n` +
            `  target:   ${resolved.id}\n` +
            `\n` +
            `  client/src/dev/ is development-only and excluded from production\n` +
            `  builds. Move shared code to client/src/app/lib/ (or a similar\n` +
            `  location that is part of the production app) and import it from\n` +
            `  both places.\n` +
            `\n` +
            `  See CLAUDE.md section 7.7 and\n` +
            `  docs/workflow/pre-deploy-cleanup-plan.md.`,
        });
      }
      return null;
    },
  };
}
