'use strict';

// Google Calendar API v3 client. fetch is injectable so tests never
// talk to live Google.

const API_BASE = 'https://www.googleapis.com/calendar/v3';

function encodePath(value) {
  return encodeURIComponent(String(value));
}

function createGoogleCalendarClient({ fetchImpl, getAccessToken } = {}) {
  const doFetch = fetchImpl || fetch;

  async function request(method, path, { query, body } = {}) {
    if (typeof getAccessToken !== 'function') {
      throw new Error('Google calendar client is missing getAccessToken');
    }
    const token = await getAccessToken();
    const url = new URL(API_BASE + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v != null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    const res = await doFetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text().catch(() => '');
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const err = new Error(`Google Calendar ${method} ${path} failed (${res.status})`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  return {
    list(calendarId = 'primary', { syncToken, timeMin, timeMax, pageToken } = {}) {
      const query = { singleEvents: 'true', maxResults: '250' };
      if (syncToken) query.syncToken = syncToken;
      if (timeMin) query.timeMin = timeMin;
      if (timeMax) query.timeMax = timeMax;
      if (pageToken) query.pageToken = pageToken;
      return request('GET', `/calendars/${encodePath(calendarId)}/events`, { query });
    },
    insert(calendarId, event) {
      return request('POST', `/calendars/${encodePath(calendarId)}/events`, { body: event });
    },
    patch(calendarId, eventId, patch) {
      return request('PATCH', `/calendars/${encodePath(calendarId)}/events/${encodePath(eventId)}`, {
        body: patch,
      });
    },
    delete(calendarId, eventId) {
      return request(
        'DELETE',
        `/calendars/${encodePath(calendarId)}/events/${encodePath(eventId)}`
      );
    },
  };
}

module.exports = { createGoogleCalendarClient, API_BASE };
