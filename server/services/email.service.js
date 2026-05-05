// Transactional email sender used by magic-link authentication.
//
// Uses the Resend HTTP API directly (fetch, no SDK dependency). Resend
// supports custom domains — the RESEND_FROM env must be a verified sender
// for the configured RESEND_API_KEY.
//
// For local development and integration tests there are two escape hatches:
//   - isEmailConfigured() returns false → callers should return 503 instead
//     of trying to send.
//   - __setSenderForTests(fn) swaps out the network call; helpers.js uses it
//     to capture the outgoing payload without hitting the network.
//
// White-label note: subject and body strings interpolate config.APP_NAME
// (defaults to 'FamilyAssistant') so a deploy that sets APP_NAME picks up
// its own brand without code changes. See CLAUDE.md DEL 7.12.
//
// Invitation templates (NO + EN) live next to this file under
// server/email/templates/. They are loaded synchronously on module-init
// — total payload is ~4 KB and reading them once at boot keeps the
// per-send hot-path allocation-free. See sendInvitationEmail() below.

const fs = require('fs');
const path = require('path');
const { config } = require('../config');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Cache of {locale: { html, text }} populated at module-init. Throwing
// at boot is intentional — a missing template file is a packaging bug,
// not a per-request failure.
const TEMPLATES_DIR = path.join(__dirname, '..', 'email', 'templates');
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

const INVITATION_SUBJECTS = {
  no: '{{INVITER_NAME}} inviterer deg til {{FAMILY_NAME}} på {{APP_NAME}}',
  en: '{{INVITER_NAME}} invites you to {{FAMILY_NAME}} on {{APP_NAME}}',
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

async function sendMagicLinkEmail({ to, url }) {
  // White-label: interpolate APP_NAME so a custom-brand deploy
  // (e.g. APP_NAME=Hverdagsplanleggeren) emits the right brand
  // in the magic-link email. config.APP_NAME defaults to
  // 'FamilyAssistant' when the env var is unset.
  const appName = config.APP_NAME;
  const subject = `Logg inn på ${appName}`;
  const text = [
    `Hei!`,
    ``,
    `Klikk lenken under for å logge inn på ${appName}.`,
    `Lenken er gyldig i 15 minutter og kan bare brukes én gang.`,
    ``,
    url,
    ``,
    `Hvis du ikke ba om denne lenken kan du ignorere denne eposten.`,
  ].join('\n');
  const html = `
    <!DOCTYPE html>
    <html lang="no">
      <body style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height:1.5;">
        <h2>Logg inn på ${escapeHtml(appName)}</h2>
        <p>Klikk lenken under for å logge inn. Lenken er gyldig i 15 minutter og kan bare brukes én gang.</p>
        <p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Logg inn</a></p>
        <p style="color:#6b7280;font-size:13px;">Hvis knappen ikke virker, lim denne adressen inn i nettleseren:<br>${escapeHtml(url)}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin-top:32px;">
        <p style="color:#9ca3af;font-size:12px;">Hvis du ikke ba om denne lenken kan du ignorere denne eposten.</p>
      </body>
    </html>
  `.trim();
  return sendEmail({ to, subject, html, text });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Renders one of the four invitation templates (NO/EN × HTML/TXT).
//
// Substitution is plain string-replace — no template engine — because
// we control the templates, the variable set is fixed, and the only
// dynamic input that can be attacker-controlled (familyName, inviterName,
// invitationMessage) is HTML-escaped for the .html template. The .txt
// template skips escaping by design: plain-text MUAs render '<' literally.
//
// invitationMessage handling:
//   - Empty / null  → INVITATION_MESSAGE_BLOCK is replaced with an empty
//                     string, and surrounding whitespace in the template
//                     stays intact (so we don't get "Hi!\n\n\n\nClick...").
//   - Present       → wrapped in a styled <blockquote> for HTML and
//                     prefixed with "> " line-by-line for text.
function renderInvitationTemplate({
  locale,
  inviterName,
  familyName,
  appName,
  url,
  invitationMessage,
  expiresInDays,
}) {
  const safeLocale = SUPPORTED_INVITATION_LOCALES.includes(locale) ? locale : 'no';
  const tpl = INVITATION_TEMPLATES[safeLocale];
  const subjectTpl = INVITATION_SUBJECTS[safeLocale];

  const messageBlockHtml = renderInvitationMessageHtml(invitationMessage);
  const messageBlockText = renderInvitationMessageText(invitationMessage);

  const replacements = {
    '{{INVITER_NAME}}': inviterName,
    '{{FAMILY_NAME}}': familyName,
    '{{APP_NAME}}': appName,
    '{{URL}}': url,
    '{{EXPIRES_IN_DAYS}}': String(expiresInDays),
  };

  const html = applyReplacements(tpl.html, replacements, { escape: true }).replace(
    '{{INVITATION_MESSAGE_BLOCK}}',
    messageBlockHtml
  );
  const text = applyReplacements(tpl.text, replacements, { escape: false }).replace(
    '{{INVITATION_MESSAGE_BLOCK}}',
    messageBlockText
  );
  const subject = applyReplacements(subjectTpl, replacements, { escape: false });

  return { subject, html, text };
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
  return [
    '<blockquote style="margin:16px 0; padding:12px 16px; border-left:3px solid #2563eb; background:#f3f4f6; color:#374151; font-style:italic;">',
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

// Sends the invitation email. Resend must be configured; callers can
// pre-check via isEmailConfigured() and skip the call (logging the URL
// instead) for self-host deploys without Resend wired up.
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
    appName: config.APP_NAME,
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
  SUPPORTED_INVITATION_LOCALES,
};
