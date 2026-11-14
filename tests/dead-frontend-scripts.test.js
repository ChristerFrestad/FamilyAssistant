'use strict';

// The week-3 HTML extractor read public/index.html, which Sprint 8 removed.
// These files must stay gone so nobody runs a script that throws on startup.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('one-shot frontend extract scripts are not in the tree', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/extract-frontend.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/rewrite-index-html.js')), false);
  const tsconfig = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8');
  assert.equal(tsconfig.includes('extract-frontend'), false);
  assert.equal(tsconfig.includes('rewrite-index-html'), false);
});

test('meals locale no longer ships the phase-2C placeholder', () => {
  for (const locale of ['no', 'en']) {
    const file = path.join(ROOT, 'client/src/app/i18n/locales', locale, 'meals.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(Object.prototype.hasOwnProperty.call(json, 'placeholder'), false);
  }
});
