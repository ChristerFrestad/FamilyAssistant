// Tests the white-label APP_NAME wiring on the magic-link email
// (Sprint 2.5). We swap in a capturing sender via the
// __setSenderForTests escape hatch, set RESEND_* so isEmailConfigured()
// returns true, and assert that the subject and body interpolate
// the configured APP_NAME instead of a hardcoded brand name.
//
// Reload-pattern: each test sets process.env.APP_NAME and clears
// require.cache for config.js + email.service.js so the next call
// to require() re-parses the env. Without the cache reset the first
// test's APP_NAME would leak into every subsequent test because
// config.js freezes its config at module load.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function loadEmailServiceWithEnv(envPatch) {
  const TRACKED = ['APP_NAME', 'RESEND_API_KEY', 'RESEND_FROM', 'NODE_ENV'];
  const snapshot = {};
  for (const k of TRACKED) snapshot[k] = process.env[k];

  // Apply patch (test/dev defaults already present in process.env are
  // overridden so each test gets a clean slate).
  //
  // Note: assigning `process.env.APP_NAME = undefined` would store
  // the literal string "undefined" — env values are coerced to
  // strings by Node. We `delete` instead so Zod's default kicks in.
  process.env.NODE_ENV = 'test';
  if (envPatch.APP_NAME === undefined) {
    delete process.env.APP_NAME;
  } else {
    process.env.APP_NAME = envPatch.APP_NAME;
  }
  process.env.RESEND_API_KEY = 'test_resend_key';
  process.env.RESEND_FROM = 'noreply@example.com';

  // Wipe modules so config.js + email.service.js re-parse env.
  const configPath = require.resolve(path.resolve(__dirname, '..', 'server', 'config.js'));
  const emailPath = require.resolve(
    path.resolve(__dirname, '..', 'server', 'services', 'email.service.js')
  );
  delete require.cache[configPath];
  delete require.cache[emailPath];

  const emailService = require(emailPath);

  return {
    emailService,
    restore: () => {
      for (const k of TRACKED) {
        if (snapshot[k] === undefined) delete process.env[k];
        else process.env[k] = snapshot[k];
      }
      delete require.cache[configPath];
      delete require.cache[emailPath];
    },
  };
}

test('sendMagicLinkEmail subject defaults to "Logg inn på FamilyAssistant" when APP_NAME is unset', async () => {
  const { emailService, restore } = loadEmailServiceWithEnv({ APP_NAME: undefined });
  try {
    let captured = null;
    emailService.__setSenderForTests((args) => {
      captured = args;
      return Promise.resolve({ ok: true, messageId: 'test' });
    });
    await emailService.sendMagicLinkEmail({
      to: 'user@example.com',
      url: 'https://example.com/auth/magic?token=abc',
    });
    assert.equal(captured.subject, 'Logg inn på FamilyAssistant');
    assert.match(captured.text, /Klikk lenken under for å logge inn på FamilyAssistant\./);
    assert.match(captured.html, /<h2>Logg inn på FamilyAssistant<\/h2>/);
  } finally {
    restore();
  }
});

test('sendMagicLinkEmail uses APP_NAME override when set (white-label deploy)', async () => {
  const { emailService, restore } = loadEmailServiceWithEnv({ APP_NAME: 'Hverdagsplanleggeren' });
  try {
    let captured = null;
    emailService.__setSenderForTests((args) => {
      captured = args;
      return Promise.resolve({ ok: true, messageId: 'test' });
    });
    await emailService.sendMagicLinkEmail({
      to: 'user@example.com',
      url: 'https://example.com/auth/magic?token=abc',
    });
    assert.equal(captured.subject, 'Logg inn på Hverdagsplanleggeren');
    assert.match(captured.text, /Klikk lenken under for å logge inn på Hverdagsplanleggeren\./);
    assert.match(captured.html, /<h2>Logg inn på Hverdagsplanleggeren<\/h2>/);
  } finally {
    restore();
  }
});

test('sendMagicLinkEmail HTML-escapes APP_NAME override (defense in depth)', async () => {
  // White-label values should never contain markup, but we
  // defensively escape anyway so a misconfigured operator who
  // sets APP_NAME='Brand<script>alert(1)</script>' does not turn
  // the email into an XSS vector for any downstream client that
  // might re-render it without sanitisation.
  const { emailService, restore } = loadEmailServiceWithEnv({
    APP_NAME: 'Brand<script>',
  });
  try {
    let captured = null;
    emailService.__setSenderForTests((args) => {
      captured = args;
      return Promise.resolve({ ok: true, messageId: 'test' });
    });
    await emailService.sendMagicLinkEmail({
      to: 'user@example.com',
      url: 'https://example.com/auth/magic?token=abc',
    });
    // The HTML body uses escapeHtml on the APP_NAME interpolation
    // inside the <h2>. So `<` becomes `&lt;` and the script tag is
    // neutralised. Plain-text subject + body do NOT escape because
    // they are not markup contexts.
    assert.match(captured.html, /<h2>Logg inn på Brand&lt;script&gt;<\/h2>/);
    assert.equal(captured.subject, 'Logg inn på Brand<script>');
  } finally {
    restore();
  }
});
