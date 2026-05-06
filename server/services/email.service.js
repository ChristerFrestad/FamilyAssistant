// Transactional email sender for magic-link auth + family invitations.
//
// Uses the Resend HTTP API directly (fetch, no SDK dependency). Resend
// supports custom domains — the RESEND_FROM env must be a verified
// sender for the configured RESEND_API_KEY.
//
// For local development and integration tests there are two escape
// hatches:
//   - isEmailConfigured() returns false → callers should return 503
//     instead of trying to send.
//   - __setSenderForTests(fn) swaps out the network call; helpers.js
//     uses it to capture the outgoing payload without hitting the
//     network.
//
// Sprint 10 — every template (invitation + magic-link) lives as a
// pair of files (.html + .txt) under server/email/templates/. Each
// template carries the same brand placeholders ({{APP_NAME}},
// {{NAME_PRIMARY}}, {{NAME_ACCENT}}, {{TAGLINE}}, {{PRIMARY_COLOR}},
// {{ACCENT_COLOR}}) so any deploy that overrides the brand-config
// env-vars gets correctly-coloured emails without touching code. See
// docs/BRAND_SYSTEM.md.

const fs = require('fs');
const path = require('path');
const { config } = require('../config');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const TEMPLATES_DIR = path.join(__dirname, '..', 'email', 'templates');

// Cache of {locale: { html, text }} for each template-family. Loaded
// once at module-init — a missing file at boot is a packaging bug, not
// a per-request failure, so we let fs.readFileSync throw.
const INVITATION_TEMPLATES = {
  no: {
    html: fs.readFileSync(path.join(TEMPLATES_DIR, 'invitation-no.html'), 'utf8'),
    text: fs.readFileSync(path.join(TEMPLATES_DIR, 'invitation-no.txt'), 'utf8'),
  },
  en: {
    html: fs.readFileSync(path.join(TEMPLATES_DIR, 'invitation-en.html'), 'utf8'),
    text: fs.readFileSync(path.join(TEMPLATES_DIR, 'invitation-en.txt'), 'utf8'),
  },
};

const MAGIC_LINK_TEMPLATES = {
  no: {
    html: fs.readFileSync(path.join(TEMPLATES_DIR, 'magic-link-no.html'), 'utf8'),
    text: fs.readFileSync(path.join(TEMPLATES_DIR, 'magic-link-no.txt'), 'utf8'),
  },
  en: {
    html: fs.readFileSync(path.join(TEMPLATES_DIR, 'magic-link-en.html'), 'utf8'),
    text: fs.readFileSync(path.join(TEMPLATES_DIR, 'magic-link-en.txt'), 'utf8'),
  },
};

const INVITATION_SUBJECTS = {
  no: '{{INVITER_NAME}} inviterer deg til {{FAMILY_NAME}} på {{APP_NAME}}',
  en: '{{INVITER_NAME}} invites you to {{FAMILY_NAME}} on {{APP_NAME}}',
};

const MAGIC_LINK_SUBJECTS = {
  no: 'Logg inn på {{APP_NAME}}',
  en: 'Sign in to {{APP_NAME}}',
};

const SUPPORTED_INVITATION_LOCALES = Object.freeze(['no', 'en']);

let _sendImpl = defaultSend;

function isEmailConfigured() {
  return !!(config.RESEND_API_KEY && config.RESEND_FROM);
}

async function defaultSend({ to, subject, html, text }) {
  if (!isEmailConfigured()) {
    throw new Error('Email sending is not configured (missing RESEND_API_KEY or RESEND_FROM).');
  }
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: config.RESEND_FROM, to, subject, html, text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend API failed (${res.status}): ${detail}`);
  }
  const json = await res.json().catch(() => ({}));
  return { ok: true, messageId: json.id || null };
}

async function sendEmail(args) {
  return _sendImpl(args);
}

function __setSenderForTests(fn) {
  _sendImpl = fn || defaultSend;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Brand-token replacements common to every template. Sourced from
// config so a runtime APP_NAME / APP_PRIMARY_COLOR / etc. override
// flows into both invitation and magic-link emails uniformly. The
// values are static strings (hex colors, brand parts) — no
// HTML-escaping required for the color tokens since they are
// exclusively under server-controlled env validation.
function brandReplacements() {
  return {
    '{{APP_NAME}}': config.APP_NAME,
    '{{NAME_PRIMARY}}': config.APP_NAME_PRIMARY,
    '{{NAME_ACCENT}}': config.APP_NAME_ACCENT,
    '{{TAGLINE}}': config.APP_TAGLINE,
    '{{PRIMARY_COLOR}}': config.APP_PRIMARY_COLOR,
    '{{ACCENT_COLOR}}': config.APP_ACCENT_COLOR,
    '{{DOT_COLOR}}': config.APP_DOT_COLOR,
  };
}

function applyReplacements(input, replacements, { escape }) {
  let out = input;
  for (const [token, raw] of Object.entries(replacements)) {
    const value = escape ? escapeHtml(raw ?? '') : String(raw ?? '');
    out = out.split(token).join(value);
  }
  return out;
}

function renderInvitationMessageHtml(message) {
  const trimmed = typeof message === 'string' ? message.trim() : '';
  if (!trimmed) return '';
  // border-left now reads the configured primary color so the
  // blockquote matches the rest of the brand chrome.
  return [
    `<blockquote style="margin:16px 0; padding:12px 16px; border-left:3px solid ${escapeHtml(config.APP_PRIMARY_COLOR)}; background:#f3f4f6; color:#374151; font-style:italic;">`,
    escapeHtml(trimmed).replace(/\n/g, '<br />'),
    '</blockquote>',
  ].join('');
}

function renderInvitationMessageText(message) {
  const trimmed = typeof message === 'string' ? message.trim() : '';
  if (!trimmed) return '';
  const quoted = trimmed
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${quoted}\n\n`;
}

// Renders one of the four invitation templates (NO/EN × HTML/TXT).
// Substitution is plain string-replace; the only attacker-controllable
// inputs (familyName, inviterName, invitationMessage) get HTML-escaped
// for the .html variant. Brand-token placeholders come from config and
// are NOT escaped since they're env-validated.
function renderInvitationTemplate({
  locale,
  inviterName,
  familyName,
  url,
  invitationMessage,
  expiresInDays,
}) {
  const safeLocale = SUPPORTED_INVITATION_LOCALES.includes(locale) ? locale : 'no';
  const tpl = INVITATION_TEMPLATES[safeLocale];
  const subjectTpl = INVITATION_SUBJECTS[safeLocale];

  const messageBlockHtml = renderInvitationMessageHtml(invitationMessage);
  const messageBlockText = renderInvitationMessageText(invitationMessage);

  // Two replacement passes per format: brand-tokens first (no escape —
  // env-validated), then per-recipient values (escape on HTML).
  const brand = brandReplacements();
  const recipientReplacements = {
    '{{INVITER_NAME}}': inviterName,
    '{{FAMILY_NAME}}': familyName,
    '{{URL}}': url,
    '{{EXPIRES_IN_DAYS}}': String(expiresInDays),
  };

  const html = applyReplacements(
    applyReplacements(tpl.html, brand, { escape: false }),
    recipientReplacements,
    { escape: true }
  ).replace('{{INVITATION_MESSAGE_BLOCK}}', messageBlockHtml);

  const text = applyReplacements(
    applyReplacements(tpl.text, brand, { escape: false }),
    recipientReplacements,
    { escape: false }
  ).replace('{{INVITATION_MESSAGE_BLOCK}}', messageBlockText);

  const subject = applyReplacements(
    applyReplacements(subjectTpl, brand, { escape: false }),
    recipientReplacements,
    { escape: false }
  );

  return { subject, html, text };
}

// Renders the magic-link template (NO/EN × HTML/TXT). Same token surface
// minus the invitation-only fields. Locale defaults to NO since that is
// what the pilot ships and what the original inline-HTML magic-link used.
function renderMagicLinkTemplate({ locale, url }) {
  const safeLocale = SUPPORTED_INVITATION_LOCALES.includes(locale) ? locale : 'no';
  const tpl = MAGIC_LINK_TEMPLATES[safeLocale];
  const subjectTpl = MAGIC_LINK_SUBJECTS[safeLocale];

  const brand = brandReplacements();
  const recipientReplacements = { '{{URL}}': url };

  const html = applyReplacements(
    applyReplacements(tpl.html, brand, { escape: false }),
    recipientReplacements,
    { escape: true }
  );
  const text = applyReplacements(
    applyReplacements(tpl.text, brand, { escape: false }),
    recipientReplacements,
    { escape: false }
  );
  const subject = applyReplacements(subjectTpl, brand, { escape: false });

  return { subject, html, text };
}

async function sendMagicLinkEmail({ to, url, locale = 'no' }) {
  if (!to) throw new Error('sendMagicLinkEmail: to is required');
  if (!url) throw new Error('sendMagicLinkEmail: url is required');
  const { subject, html, text } = renderMagicLinkTemplate({ locale, url });
  return sendEmail({ to, subject, html, text });
}

async function sendInvitationEmail({
  to,
  url,
  familyName,
  inviterName,
  invitationMessage = null,
  expiresInDays = 7,
  locale = 'no',
}) {
  if (!to) throw new Error('sendInvitationEmail: to is required');
  if (!url) throw new Error('sendInvitationEmail: url is required');
  if (!familyName) throw new Error('sendInvitationEmail: familyName is required');
  if (!inviterName) throw new Error('sendInvitationEmail: inviterName is required');
  const { subject, html, text } = renderInvitationTemplate({
    locale,
    inviterName,
    familyName,
    url,
    invitationMessage,
    expiresInDays,
  });
  return sendEmail({ to, subject, html, text });
}

module.exports = {
  isEmailConfigured,
  sendEmail,
  sendMagicLinkEmail,
  sendInvitationEmail,
  __setSenderForTests,
  // Exported for tests so they can render templates without going
  // through the network mock + assert against the substituted output.
  __renderInvitationTemplate: renderInvitationTemplate,
  __renderMagicLinkTemplate: renderMagicLinkTemplate,
  SUPPORTED_INVITATION_LOCALES,
};
