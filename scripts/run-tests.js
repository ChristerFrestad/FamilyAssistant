#!/usr/bin/env node
/*
 * scripts/run-tests.js — cross-platform test runner wrapper
 *
 * Node 20 støtter ikke `node --test tests/` (directory-argument, kom i
 * Node 22.3). npm scripts med `tests/*.test.js` ekspanderes ikke i
 * Windows PowerShell, så vi trenger en portable måte å liste alle
 * test-filer.
 *
 * Denne scripten leser tests/-katalogen, filtrerer .test.js-filer, og
 * spawner `node --test <filer>` med eventuelle ekstra flagg som ble
 * gitt på kommandolinjen.
 *
 * Usage:
 *   node scripts/run-tests.js
 *   node scripts/run-tests.js --experimental-test-coverage --test-reporter=spec
 *   node scripts/run-tests.js --watch
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const TEST_DIR = path.join(__dirname, '..', 'tests');

const testFiles = fs
  .readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join('tests', f));

if (testFiles.length === 0) {
  console.error('No .test.js files found in tests/');
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const nodeArgs = ['--test', ...extraArgs, ...testFiles];

const child = spawn(process.execPath, nodeArgs, { stdio: 'inherit' });

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Test runner killed with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('Failed to spawn test runner:', err);
  process.exit(1);
});
