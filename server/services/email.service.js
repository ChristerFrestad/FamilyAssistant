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

const { config } = require('../config');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

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

module.exports = {
  isEmailConfigured,
  sendEmail,
  sendMagicLinkEmail,
  __setSenderForTests,
};
