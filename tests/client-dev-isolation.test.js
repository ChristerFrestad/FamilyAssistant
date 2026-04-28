'use strict';

// Proof-of-isolation test for the enforce-dev-isolation Vite plugin.
//
// Two subtests invoke Vite's programmatic build() API against a probe
// file that lives under client/src/app/ and either does or does not
// reach into client/src/dev/:
//
//   1. VIOLATION — writes a probe under client/src/app/ that imports
//      from client/src/dev/. Expects build() to reject with an error
//      whose message contains the plugin's signature. Proves the
//      boundary is hard, not just a convention.
//
//   2. CONTROL — writes a probe under client/src/app/ that imports
//      nothing illegal. Expects build() to resolve cleanly. Proves
//      the test harness itself works and the failure in (1) is
//      specifically from the plugin, not from unrelated breakage.
//
// The test uses a lib-mode build targeted at the probe file, so the
// real client/vite.config.ts and src/main.tsx stay untouched. All
// probe files and the build output are cleaned up in try/finally.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const CLIENT_ROOT = path.join(REPO_ROOT, 'client');
const SRC_ROOT = path.join(CLIENT_ROOT, 'src');
const APP_DIR = path.join(SRC_ROOT, 'app');
const DEV_DIR = path.join(SRC_ROOT, 'dev');

// Probe files. Plain .ts (no JSX) so the test does not need the react
// plugin and the bundled output is as simple as possible.
const APP_PROBE = path.join(APP_DIR, '__isolation_probe.ts');
const DEV_PROBE = path.join(DEV_DIR, '__isolation_probe.ts');

// Throwaway config file. Written into client/ so its TS imports
// resolve the same way the real vite.config.ts does. Vite's config
// loader JIT-compiles it via esbuild, which also handles the plugin's
// TypeScript source. Gitignored; cleaned up by the test.
const TEST_CONFIG = path.join(CLIENT_ROOT, '__isolation_test.config.mts');
const TEST_OUTPUT = path.join(REPO_ROOT, '.isolation-test-output');

const DEV_PROBE_CODE = `export const DevOnlyProbe = (): string => 'dev';\n`;

const APP_PROBE_VIOLATING =
  "import { DevOnlyProbe } from '../dev/__isolation_probe';\n" +
  'export const AppProbe = (): string => DevOnlyProbe();\n';

const APP_PROBE_LEGAL = "export const AppProbe = (): string => 'app';\n";

const TEST_CONFIG_CONTENT = `import { defineConfig } from 'vite';
import path from 'node:path';
import enforceDevIsolation from './vite-plugins/enforce-isolation';

export default defineConfig({
  plugins: [enforceDevIsolation()],
  root: path.resolve(__dirname),
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src', 'app', '__isolation_probe.ts'),
      formats: ['es'],
      fileName: '__isolation_probe',
    },
    outDir: path.resolve(__dirname, '..', '.isolation-test-output'),
    emptyOutDir: true,
    sourcemap: false,
    write: false,
  },
  logLevel: 'silent',
});
`;

function writeProbes({ violating }) {
  fs.mkdirSync(APP_DIR, { recursive: true });
  fs.mkdirSync(DEV_DIR, { recursive: true });
  fs.writeFileSync(DEV_PROBE, DEV_PROBE_CODE);
  fs.writeFileSync(APP_PROBE, violating ? APP_PROBE_VIOLATING : APP_PROBE_LEGAL);
  fs.writeFileSync(TEST_CONFIG, TEST_CONFIG_CONTENT);
}

function cleanup() {
  for (const p of [APP_PROBE, DEV_PROBE, TEST_CONFIG]) {
    try {
      fs.rmSync(p);
    } catch {
      // file already removed or never written — ok
    }
  }
  try {
    fs.rmSync(TEST_OUTPUT, { recursive: true, force: true });
  } catch {
    // output dir may not exist — ok
  }
}

async function runBuild() {
  // Use Vite's programmatic build() with configFile pointing at the
  // throwaway TS config. Vite's loader JIT-compiles the config (and
  // its TS plugin import) via esbuild, then runs the build in-process.
  // No subprocess, no shell, no DEP0190 surface.
  const { build } = await import('vite');
  await build({ configFile: TEST_CONFIG });
}

test('enforce-dev-isolation: app -> dev import FAILS the build', async () => {
  try {
    writeProbes({ violating: true });
    let thrown;
    try {
      await runBuild();
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, 'expected Vite build to throw on a boundary violation; it resolved cleanly');
    const message = String(thrown && thrown.message ? thrown.message : thrown);
    assert.match(message, /enforce-dev-isolation/, 'expected the plugin name in the error message');
    assert.match(
      message,
      /Illegal import/i,
      'expected the plugin\'s "Illegal import" phrase in the error message'
    );
  } finally {
    cleanup();
  }
});

test('enforce-dev-isolation: legal app-only import SUCCEEDS the build', async () => {
  try {
    writeProbes({ violating: false });
    await runBuild();
  } finally {
    cleanup();
  }
});
