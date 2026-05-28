'use strict';

// Sprint 9 (PR #119) introduced the four invitation template files;
// Sprint 10 (PR #122) re-skinned them with brand-tokens and removed
// the appName parameter from __renderInvitationTemplate (now pulled
// from config so brand-overrides flow through every email).
//
// Tests load the email-service module with a per-test env patch so
// each scenario gets the brand-config it needs without polluting
// other tests' global state. See loadEmailServiceWithEnv() helper.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function loadEmailServiceWithEnv(envPatch = {}) {
  const TRACKED = [
    'APP_NAME',
    'APP_NAME_PRIMARY',
    'APP_NAME_ACCENT',
    'APP_FAVICON_LETTER',
    'APP_TAGLINE',
    'APP_PRIMARY_COLOR',
    'APP_ACCENT_COLOR',
    'APP_DOT_COLOR',
    'RESEND_API_KEY',
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

describe('Email invitation · template rendering', () => {
  test('NO template substitutes recipient + brand variables', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({
      APP_NAME: 'Husby',
      APP_NAME_PRIMARY: 'Hus',
      APP_NAME_ACCENT: 'by',
      APP_FAVICON_LETTER: 'h',
      APP_TAGLINE: 'Planlegg middag, gjøremål og familie',
    });
    try {
      const r = emailService.__renderInvitationTemplate({
        locale: 'no',
        inviterName: 'Christer',
        familyName: 'Frestad',
        url: 'https://example.com/v2/invite/abc',
        invitationMessage: null,
        expiresInDays: 7,
      });
      assert.match(r.subject, /Christer inviterer deg til Frestad/);
      assert.match(r.subject, /Husby/);
      assert.match(r.html, /Bli med i Frestad/);
      // Wordmark header in HTML carries the configured split
      assert.match(r.html, /<span style="color:#1F3F26;">Hus<\/span>/);
      assert.match(r.html, /<span style="color:#5F8B5C;">by<\/span>/);
      assert.match(r.text, /Christer inviterer deg til Frestad/);
      assert.match(r.text, /Lenken er gyldig i 7 dager/);
      // Footer line in plain-text shows brand + tagline
      assert.match(r.text, /Husby · Planlegg middag/);
    } finally {
      restore();
    }
  });

  test('EN template uses English copy', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({});
    try {
      const r = emailService.__renderInvitationTemplate({
        locale: 'en',
        inviterName: 'Christer',
        familyName: 'Frestad',
        url: 'https://example.com/v2/invite/abc',
        invitationMessage: null,
        expiresInDays: 7,
      });
      assert.match(r.subject, /invites you to/);
      assert.match(r.html, /Join Frestad/);
      assert.match(r.text, /valid for 7 days/);
    } finally {
      restore();
    }
  });

  test('invitationMessage is wrapped in a blockquote in HTML', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({});
    try {
      const r = emailService.__renderInvitationTemplate({
        locale: 'no',
        inviterName: 'Christer',
        familyName: 'Frestad',
        url: 'https://example.com/v2/invite/abc',
        invitationMessage: 'Velkommen kjære!',
        expiresInDays: 7,
      });
      assert.match(r.html, /<blockquote/);
      assert.match(r.html, /Velkommen kjære!/);
      assert.match(r.text, /^> Velkommen kjære!/m);
    } finally {
      restore();
    }
  });

  test('invitationMessage HTML-escapes attacker-controlled input', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({});
    try {
      const r = emailService.__renderInvitationTemplate({
        locale: 'no',
        inviterName: '<script>evil()</script>',
        familyName: 'Frestad & Co',
        url: 'https://example.com/v2/invite/abc',
        invitationMessage: '<img src=x onerror=alert(1)>',
        expiresInDays: 7,
      });
      assert.doesNotMatch(r.html, /<script>evil/);
      assert.match(r.html, /&lt;script&gt;evil/);
      assert.match(r.html, /Frestad &amp; Co/);
      assert.doesNotMatch(r.html, /<img src=x onerror/);
      assert.match(r.html, /&lt;img src=x onerror/);
    } finally {
      restore();
    }
  });

  test('plain-text body keeps inviter and family names raw (no escaping)', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({});
    try {
      const r = emailService.__renderInvitationTemplate({
        locale: 'no',
        inviterName: 'Frestad & Søn',
        familyName: 'Frestad & Co',
        url: 'https://example.com/v2/invite/abc',
        invitationMessage: null,
        expiresInDays: 7,
      });
      assert.match(r.text, /Frestad & Søn/);
      assert.match(r.text, /Frestad & Co/);
    } finally {
      restore();
    }
  });

  test('empty invitationMessage produces no blockquote', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({});
    try {
      const r = emailService.__renderInvitationTemplate({
        locale: 'no',
        inviterName: 'Christer',
        familyName: 'Frestad',
        url: 'https://example.com/v2/invite/abc',
        invitationMessage: '   ',
        expiresInDays: 7,
      });
      assert.doesNotMatch(r.html, /<blockquote/);
      assert.doesNotMatch(r.text, /^> /m);
    } finally {
      restore();
    }
  });

  test('unsupported locale falls back to NO', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({});
    try {
      const r = emailService.__renderInvitationTemplate({
        locale: 'fr',
        inviterName: 'X',
        familyName: 'Y',
        url: 'https://example.com',
        invitationMessage: null,
        expiresInDays: 7,
      });
      assert.match(r.subject, /inviterer/);
    } finally {
      restore();
    }
  });

  test('SUPPORTED_INVITATION_LOCALES exposes the two pilot locales', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({});
    try {
      assert.deepStrictEqual([...emailService.SUPPORTED_INVITATION_LOCALES], ['no', 'en']);
    } finally {
      restore();
    }
  });

  test('newlines in invitationMessage are converted to <br /> in HTML', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({});
    try {
      const r = emailService.__renderInvitationTemplate({
        locale: 'no',
        inviterName: 'Christer',
        familyName: 'Frestad',
        url: 'https://example.com',
        invitationMessage: 'Line 1\nLine 2',
        expiresInDays: 7,
      });
      assert.match(r.html, /Line 1<br \/>Line 2/);
      assert.match(r.text, /^> Line 1\n> Line 2/m);
    } finally {
      restore();
    }
  });

  test('CTA button uses configured primary color, not hardcoded blue', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({
      APP_PRIMARY_COLOR: '#1F3F26',
    });
    try {
      const r = emailService.__renderInvitationTemplate({
        locale: 'no',
        inviterName: 'Christer',
        familyName: 'Frestad',
        url: 'https://example.com',
        invitationMessage: null,
        expiresInDays: 7,
      });
      assert.match(r.html, /background:#1F3F26/);
      assert.doesNotMatch(r.html, /background:\s*#2563eb/);
    } finally {
      restore();
    }
  });

  test('magic-link template renders subject + body with brand', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({
      APP_NAME: 'Husby',
      APP_NAME_PRIMARY: 'Hus',
      APP_NAME_ACCENT: 'by',
      APP_FAVICON_LETTER: 'h',
      APP_TAGLINE: 'Planlegg middag, gjøremål og familie',
    });
    try {
      const r = emailService.__renderMagicLinkTemplate({
        locale: 'no',
        url: 'https://example.com/auth/cb?token=t',
      });
      assert.equal(r.subject, 'Logg inn på Husby');
      assert.match(r.text, /Klikk lenken under for å logge inn på Husby\./);
      assert.match(r.html, /<span style="color:#1F3F26;">Hus<\/span>/);
      assert.match(r.html, /<span style="color:#5F8B5C;">by<\/span>/);
    } finally {
      restore();
    }
  });

  test('magic-link EN template renders English copy', () => {
    const { emailService, restore } = loadEmailServiceWithEnv({});
    try {
      const r = emailService.__renderMagicLinkTemplate({
        locale: 'en',
        url: 'https://example.com',
      });
      assert.equal(r.subject, 'Sign in to FamilyAssistant');
      assert.match(r.text, /Click the link below to sign in to FamilyAssistant\./);
    } finally {
      restore();
    }
  });
});
