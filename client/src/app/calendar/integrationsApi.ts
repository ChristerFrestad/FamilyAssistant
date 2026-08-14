// Backend client for calendar integrations (Google + iCloud).
// Never persist or log secrets on the client. GET never includes them.

import { CalendarApiError } from './calendarApi';

export interface CalendarIntegration {
  id: number;
  provider: 'google' | 'icloud' | string;
  accountEmail: string;
  calendarDisplayName?: string | null;
  writeEnabled?: boolean;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

export interface CalendarIntegrationsResponse {
  integrations: CalendarIntegration[];
  googleConfigured?: boolean;
}

async function callApi(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    signal,
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const reason =
      parsed && typeof parsed === 'object' && parsed !== null && 'reason' in parsed
        ? String((parsed as { reason: unknown }).reason)
        : parsed && typeof parsed === 'object' && parsed !== null && 'detail' in parsed
          ? String((parsed as { detail: unknown }).detail)
          : `HTTP ${res.status}`;
    throw new CalendarApiError(res.status, reason);
  }
  return parsed;
}

export async function fetchCalendarIntegrations(
  signal?: AbortSignal
): Promise<CalendarIntegrationsResponse> {
  return (await callApi(
    '/api/integrations/calendar',
    { method: 'GET' },
    signal
  )) as CalendarIntegrationsResponse;
}

export async function connectIcloud(body: {
  email: string;
  appPassword: string;
  calendarExternalId?: string;
}): Promise<{ ok: true; integration: CalendarIntegration }> {
  return (await callApi('/api/integrations/calendar/icloud', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })) as { ok: true; integration: CalendarIntegration };
}

export async function disconnectCalendarIntegration(id: number): Promise<{ ok: true }> {
  return (await callApi(`/api/integrations/calendar/${id}`, { method: 'DELETE' })) as { ok: true };
}

export async function startGoogleCalendar(): Promise<{ url: string }> {
  return (await callApi('/api/integrations/google-calendar/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })) as { url: string };
}
