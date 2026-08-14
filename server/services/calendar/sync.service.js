'use strict';

const { getFamilyId, runWithFamily } = require('../../auth/family-context');
const { decrypt, encrypt } = require('../../auth/crypto');
const { createGoogleCalendarClient } = require('./google.client');
const { refreshAccessToken } = require('./google.oauth');
const { createCalDavClient } = require('./icloud.caldav');
const { parseVEvent, serializeVEvent } = require('./ics');

function googleDateParts(event) {
  const start = event.start || {};
  const end = event.end || {};
  if (start.date) {
    return {
      date: start.date,
      startTime: null,
      endTime: null,
      allDay: true,
    };
  }
  const startIso = start.dateTime || '';
  const endIso = end.dateTime || '';
  return {
    date: startIso.slice(0, 10) || null,
    startTime: startIso.length >= 16 ? startIso.slice(11, 16) : null,
    endTime: endIso.length >= 16 ? endIso.slice(11, 16) : null,
    allDay: false,
  };
}

function expiresAtFromSeconds(expiresIn) {
  const sec = Number(expiresIn);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return new Date(Date.now() + sec * 1000).toISOString();
}

async function resolveGoogleAccessToken(repos, integration, fetchImpl) {
  const expiry = integration.access_token_expires_at
    ? Date.parse(integration.access_token_expires_at)
    : 0;
  if (integration.access_token_enc && expiry && expiry > Date.now() + 60_000) {
    return decrypt(integration.access_token_enc);
  }
  if (!integration.refresh_token_enc) {
    throw new Error('Google refresh token is missing');
  }
  const refreshToken = decrypt(integration.refresh_token_enc);
  const tokens = await refreshAccessToken({ refreshToken, fetchImpl });
  const accessTokenEnc = tokens.access_token ? encrypt(tokens.access_token) : null;
  repos.calendarIntegrations.updateTokens(integration.id, {
    accessTokenEnc,
    accessTokenExpiresAt: expiresAtFromSeconds(tokens.expires_in),
    refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
  });
  return tokens.access_token;
}

async function pullGoogle(repos, integration, { googleClient, fetchImpl } = {}) {
  const client =
    googleClient ||
    createGoogleCalendarClient({
      fetchImpl,
      getAccessToken: () => resolveGoogleAccessToken(repos, integration, fetchImpl),
    });
  const calendarId = integration.calendar_external_id || 'primary';
  const data = await client.list(calendarId);
  for (const item of data.items || []) {
    if (!item || !item.id || item.status === 'cancelled') continue;
    const parts = googleDateParts(item);
    if (!parts.date) continue;
    repos.calendar.upsertExternal({
      title: item.summary || '(untitled)',
      date: parts.date,
      startTime: parts.startTime,
      endTime: parts.endTime,
      allDay: parts.allDay,
      location: item.location || null,
      notes: item.description || null,
      rrule: Array.isArray(item.recurrence) ? item.recurrence.join(';') : item.recurrence || null,
      source: 'google',
      externalId: item.id,
      etag: item.etag || null,
      calendarExternalId: calendarId,
      kind: item.eventType || 'event',
    });
  }
  return data.nextSyncToken || null;
}

async function pullIcloud(repos, integration, { caldavClient } = {}) {
  const client =
    caldavClient ||
    createCalDavClient({
      email: integration.account_email,
      password: integration.app_password_enc ? decrypt(integration.app_password_enc) : '',
    });
  let calendarUrl = integration.calendar_external_id;
  if (!calendarUrl && typeof client.discover === 'function') {
    const discovered = await client.discover();
    calendarUrl = discovered && discovered.href;
  }
  if (!calendarUrl) {
    throw new Error('iCloud calendar URL is missing');
  }
  const items = await client.report(calendarUrl);
  for (const item of items || []) {
    const parsed = (item.events && item.events[0]) || parseVEvent(item.ics);
    if (!parsed || !parsed.uid || !parsed.date) continue;
    repos.calendar.upsertExternal({
      title: parsed.title || '(untitled)',
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      location: parsed.location,
      notes: parsed.notes,
      rrule: parsed.rrule,
      source: 'icloud',
      externalId: parsed.uid,
      etag: item.etag || null,
      calendarExternalId: calendarUrl,
    });
  }
}

async function pushLocal(repos, integration, { googleClient, caldavClient } = {}) {
  if (!integration.write_enabled) return;
  const familyId = getFamilyId();
  const locals = repos._db
    .prepare(
      `SELECT id, title, date, start_time as startTime, end_time as endTime,
              location, notes, all_day as allDay, rrule, external_id as externalId
         FROM calendar_events
        WHERE family_id = ? AND IFNULL(source, 'local') = 'local' AND external_id IS NULL
          AND IFNULL(hidden, 0) = 0`
    )
    .all(familyId);

  if (integration.provider === 'google' && googleClient && typeof googleClient.insert === 'function') {
    const calendarId = integration.calendar_external_id || 'primary';
    for (const ev of locals) {
      const created = await googleClient.insert(calendarId, {
        summary: ev.title,
        location: ev.location || undefined,
        description: ev.notes || undefined,
        start: ev.startTime
          ? { dateTime: `${ev.date}T${ev.startTime}:00` }
          : { date: ev.date },
        end: ev.endTime
          ? { dateTime: `${ev.date}T${ev.endTime}:00` }
          : { date: ev.date },
      });
      if (created && created.id) {
        repos.calendar.update(ev.id, {
          source: 'google',
          externalId: created.id,
          etag: created.etag || null,
          calendarExternalId: calendarId,
        });
      }
    }
    return;
  }

  if (integration.provider === 'icloud' && caldavClient && typeof caldavClient.put === 'function') {
    const calendarUrl = integration.calendar_external_id || '';
    for (const ev of locals) {
      const uid = `fa-${ev.id}@familyassistant`;
      const href = calendarUrl.replace(/\/?$/, '/') + `${uid}.ics`;
      await caldavClient.put(href, serializeVEvent({ ...ev, uid }));
      repos.calendar.update(ev.id, {
        source: 'icloud',
        externalId: uid,
        calendarExternalId: calendarUrl || null,
      });
    }
  }
}

async function syncIntegration(repos, integration, deps = {}) {
  if (!integration) throw new Error('syncIntegration requires an integration');
  if (integration.provider === 'google') {
    await pullGoogle(repos, integration, deps);
  } else if (integration.provider === 'icloud') {
    await pullIcloud(repos, integration, deps);
  } else {
    throw new Error(`Unsupported calendar provider: ${integration.provider}`);
  }
  await pushLocal(repos, integration, deps);
  repos.calendarIntegrations.markSynced(integration.id, { error: null });
}

async function runWithFamilySync(familyId, repos, deps = {}) {
  return runWithFamily(familyId, async () => {
    const integrations = repos.calendarIntegrations.listRaw();
    const results = [];
    for (const integration of integrations) {
      try {
        await syncIntegration(repos, integration, deps);
        results.push({ id: integration.id, ok: true });
      } catch (err) {
        const message = err && err.message ? err.message : 'sync failed';
        repos.calendarIntegrations.markSynced(integration.id, { error: message });
        results.push({ id: integration.id, ok: false, error: message });
      }
    }
    return results;
  });
}

module.exports = {
  syncIntegration,
  runWithFamily: runWithFamilySync,
  pullGoogle,
  pullIcloud,
  pushLocal,
};
