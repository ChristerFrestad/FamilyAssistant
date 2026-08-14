'use strict';

// Google Calendar OAuth helper. Separate from login google.js — do not
// reuse login scopes or state cookies. Calendar uses access_type=offline
// and scope calendar.events so we can store a refresh token.

const crypto = require('crypto');
const { config } = require('../../config');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const STATE_TTL_MS = 15 * 60 * 1000;
const STATE_PURPOSE = 'google-calendar';

function isClientConfigured() {
  return Boolean(config.GOOGLE_CLIENT_ID);
}

function missingConfigReason() {
  if (!config.GOOGLE_CLIENT_ID) return 'GOOGLE_CLIENT_ID is not configured';
  if (!config.GOOGLE_CLIENT_SECRET) return 'GOOGLE_CLIENT_SECRET is not configured';
  if (!config.APP_URL) return 'APP_URL is not configured';
  if (!config.SESSION_SECRET || String(config.SESSION_SECRET).length < 32) {
    return 'SESSION_SECRET is not configured';
  }
  return null;
}

function redirectUriFor() {
  const base = config.APP_URL;
  if (!base) return null;
  return String(base).replace(/\/+$/, '') + '/api/integrations/google-calendar/callback';
}

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyState(signed) {
  if (typeof signed !== 'string' || !signed.includes('.')) return null;
  const [body, mac] = signed.split('.');
  const expected = crypto
    .createHmac('sha256', config.SESSION_SECRET)
    .update(body)
    .digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || payload.purpose !== STATE_PURPOSE) return null;
    if (typeof payload.ts !== 'number' || Date.now() - payload.ts > STATE_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

function createState({ familyId, userId }) {
  return signState({
    purpose: STATE_PURPOSE,
    familyId,
    userId,
    nonce: crypto.randomBytes(8).toString('hex'),
    ts: Date.now(),
  });
}

function buildAuthorizationUrl({ state }) {
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUriFor(),
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline',
    include_granted_scopes: 'false',
    prompt: 'consent',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function exchangeCode({ code, fetchImpl }) {
  const doFetch = fetchImpl || fetch;
  const body = new URLSearchParams({
    code,
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUriFor(),
    grant_type: 'authorization_code',
  });
  const res = await doFetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Google calendar token exchange failed (${res.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Google calendar token exchange returned invalid JSON');
  }
}

async function refreshAccessToken({ refreshToken, fetchImpl }) {
  const doFetch = fetchImpl || fetch;
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await doFetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Google calendar token refresh failed (${res.status})`);
  }
  return res.json();
}

module.exports = {
  CALENDAR_SCOPE,
  STATE_PURPOSE,
  isClientConfigured,
  missingConfigReason,
  redirectUriFor,
  createState,
  verifyState,
  buildAuthorizationUrl,
  exchangeCode,
  refreshAccessToken,
};
