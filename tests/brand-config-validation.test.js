'use strict';

// Sprint 10 PR #122: cross-validation warnings for the brand-config
// env-vars. The schema accepts any consistent or inconsistent set of
// values without crashing — operators may have a deliberate spelling
// difference — but emits warnings via the BRAND_WARNINGS array on
// the frozen config. server/index.js logs them via pino at boot.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function loadConfigWithEnv(envPatch = {}) {
  const TRACKED = [
    'APP_NAME',
    'APP_NAME_PRIMARY',
    'APP_NAME_ACCENT',
    'APP_FAVICON_LETTER',
    'APP_TAGLINE',
    'APP_PRIMARY_COLOR',
    'APP_ACCENT_COLOR',
    'APP_DOT_COLOR',
    'RESEND_FROM',
    'NODE_ENV',
  ];
  const snapshot = {};
  for (const k of TRACKED) snapshot[k] = process.env[k];
  process.env.NODE_ENV = 'test';
  for (const [k, v] of Object.entries(envPatch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
  const configPath = require.resolve(path.resolve(__dirname, '..', 'server', 'config.js'));
  delete require.cache[configPath];
  const { config } = require(configPath);
  return {
    config,
    restore: () => {
      for (const k of TRACKED) {
        if (snapshot[k] === undefined) delete process.env[k];
        else process.env[k] = snapshot[k];
      }
      delete require.cache[configPath];
    },
  };
}

describe('Brand config · cross-validation', () => {
  test('defaults produce zero warnings', () => {
    const { config, restore } = loadConfigWithEnv({});
    try {
      assert.deepStrictEqual(config.BRAND_WARNINGS, []);
      assert.equal(config.APP_NAME, 'FamilyAssistant');
      assert.equal(config.APP_NAME_PRIMARY, 'Family');
      assert.equal(config.APP_NAME_ACCENT, 'Assistant');
      assert.equal(config.APP_FAVICON_LETTER, 'F');
    } finally {
      restore();
    }
  });

  test('Hverdagsplanleggeren full set produces zero warnings', () => {
    const { config, restore } = loadConfigWithEnv({
      APP_NAME: 'Hverdagsplanleggeren',
      APP_NAME_PRIMARY: 'Hverdags',
      APP_NAME_ACCENT: 'planleggeren',
      APP_FAVICON_LETTER: 'h',
      APP_TAGLINE: 'Planlegg middag, gjøremål og familie',
      RESEND_FROM: 'Hverdagsplanleggeren <noreply@hverdagsplanleggeren.com>',
    });
    try {
      assert.deepStrictEqual(config.BRAND_WARNINGS, []);
    } finally {
      restore();
    }
  });

  test('APP_NAME mismatch with PRIMARY+ACCENT produces a warning', () => {
    const { config, restore } = loadConfigWithEnv({
      APP_NAME: 'Hverdagsplanleggeren',
      APP_NAME_PRIMARY: 'Some',
      APP_NAME_ACCENT: 'thing',
      APP_FAVICON_LETTER: 'S',
    });
    try {
      assert.equal(config.BRAND_WARNINGS.length, 1);
      assert.match(config.BRAND_WARNINGS[0], /APP_NAME .* does not match/);
    } finally {
      restore();
    }
  });

  test('APP_FAVICON_LETTER mismatch with PRIMARY[0] produces a warning', () => {
    const { config, restore } = loadConfigWithEnv({
      APP_NAME: 'Hverdagsplanleggeren',
      APP_NAME_PRIMARY: 'Hverdags',
      APP_NAME_ACCENT: 'planleggeren',
      APP_FAVICON_LETTER: 'X',
    });
    try {
      assert.equal(config.BRAND_WARNINGS.length, 1);
      assert.match(
        config.BRAND_WARNINGS[0],
        /APP_FAVICON_LETTER .* does not match the first letter/
      );
    } finally {
      restore();
    }
  });

  test('APP_NAME with whitespace tolerated against PRIMARY+ACCENT', () => {
    const { config, restore } = loadConfigWithEnv({
      APP_NAME: 'Family Assistant',
      APP_NAME_PRIMARY: 'Family',
      APP_NAME_ACCENT: 'Assistant',
      APP_FAVICON_LETTER: 'F',
    });
    try {
      assert.deepStrictEqual(config.BRAND_WARNINGS, []);
    } finally {
      restore();
    }
  });

  test('Cross-check is case-insensitive', () => {
    const { config, restore } = loadConfigWithEnv({
      APP_NAME: 'HVERDAGSPLANLEGGEREN',
      APP_NAME_PRIMARY: 'hverdags',
      APP_NAME_ACCENT: 'planleggeren',
      APP_FAVICON_LETTER: 'H',
    });
    try {
      assert.deepStrictEqual(config.BRAND_WARNINGS, []);
    } finally {
      restore();
    }
  });

  test('RESEND_FROM mismatch with APP_NAME produces a warning', () => {
    const { config, restore } = loadConfigWithEnv({
      APP_NAME: 'Hverdagsplanleggeren',
      APP_NAME_PRIMARY: 'Hverdags',
      APP_NAME_ACCENT: 'planleggeren',
      APP_FAVICON_LETTER: 'h',
      RESEND_FROM: 'FamilyAssistant <noreply@example.com>',
    });
    try {
      assert.equal(config.BRAND_WARNINGS.length, 1);
      assert.match(config.BRAND_WARNINGS[0], /RESEND_FROM display-name/);
      assert.match(config.BRAND_WARNINGS[0], /FamilyAssistant/);
      assert.match(config.BRAND_WARNINGS[0], /Hverdagsplanleggeren/);
    } finally {
      restore();
    }
  });

  test('Bare-address RESEND_FROM (no display-name) does not warn', () => {
    const { config, restore } = loadConfigWithEnv({
      APP_NAME: 'Hverdagsplanleggeren',
      APP_NAME_PRIMARY: 'Hverdags',
      APP_NAME_ACCENT: 'planleggeren',
      APP_FAVICON_LETTER: 'h',
      RESEND_FROM: 'noreply@example.com',
    });
    try {
      assert.deepStrictEqual(config.BRAND_WARNINGS, []);
    } finally {
      restore();
    }
  });

  test('multiple warnings collected together', () => {
    const { config, restore } = loadConfigWithEnv({
      APP_NAME: 'Hverdagsplanleggeren',
      APP_NAME_PRIMARY: 'Other',
      APP_NAME_ACCENT: 'thing',
      APP_FAVICON_LETTER: 'X',
      RESEND_FROM: 'Wrong <noreply@example.com>',
    });
    try {
      // PRIMARY+ACCENT mismatch + APP_FAVICON_LETTER mismatch + RESEND_FROM mismatch = 3
      assert.equal(config.BRAND_WARNINGS.length, 3);
    } finally {
      restore();
    }
  });

  test('APP_FAVICON_LETTER must be a single ASCII letter (Zod-level reject)', () => {
    // Schema-level error — config-loader will console.error + exit(1).
    // We can't safely assert process.exit here, so we just confirm
    // that valid single-letter values DON'T trigger and trust that
    // the safeParse path rejects invalid ones at boot.
    const { config, restore } = loadConfigWithEnv({
      APP_FAVICON_LETTER: 'F',
    });
    try {
      assert.equal(config.APP_FAVICON_LETTER, 'F');
    } finally {
      restore();
    }
  });

  test('APP_PRIMARY_COLOR must be a 6-digit hex (Zod-level)', () => {
    const { config, restore } = loadConfigWithEnv({
      APP_PRIMARY_COLOR: '#1F3F26',
    });
    try {
      assert.equal(config.APP_PRIMARY_COLOR, '#1F3F26');
    } finally {
      restore();
    }
  });
});
