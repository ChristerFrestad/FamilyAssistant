// Backend client for the Calendar screen.
//
// Endpoints:
//   GET    /api/calendar/events?from=&to=  — list events in a date range
//   POST   /api/calendar/events            — create (requireRole adult)
//   DELETE /api/calendar/events/:id        — delete (requireRole adult)
//
// Same fetch conventions as familyApi/dashboardApi: credentials:'include'
// so the HttpOnly session cookie tags every request, and a single
// CalendarApiError that carries the HTTP status.

export class CalendarApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CalendarApiError';
    this.status = status;
  }
}

// ============================================================
// Response shapes — match GET /api/calendar/events (and /api/today)
// ============================================================

export interface CalendarEvent {
  id: number;
  title: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  allDay?: boolean;
  notes?: string | null;
  source?: string | null;
  rrule?: string | null;
  kind?: string | null;
  externalId?: string | null;
  hidden?: boolean;
}

export interface CalendarRangeResponse {
  events: CalendarEvent[];
}

export interface CreateCalendarEventBody {
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  allDay?: boolean;
  notes?: string | null;
}

export interface CreateCalendarEventResponse {
  ok: true;
  event: CalendarEvent;
}

// ============================================================
// Internal helpers
// ============================================================

interface FetchOptions {
  signal?: AbortSignal;
}

async function callApi(
  path: string,
  init: RequestInit,
  options: FetchOptions = {}
): Promise<unknown> {
  const finalInit: RequestInit = {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init.headers ?? {}) },
  };
  if (options.signal) finalInit.signal = options.signal;

  const res = await fetch(path, finalInit);
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // Non-JSON body — fall through to status check.
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new CalendarApiError(res.status, detail);
  }
  return parsed;
}

// ============================================================
// Public API
// ============================================================

export async function fetchCalendarEvents(
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<CalendarRangeResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  const url = `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return (await callApi(url, { method: 'GET' }, init)) as CalendarRangeResponse;
}

export async function createCalendarEvent(
  body: CreateCalendarEventBody,
  signal?: AbortSignal
): Promise<CreateCalendarEventResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return (await callApi(
    '/api/calendar/events',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    init
  )) as CreateCalendarEventResponse;
}

export async function deleteCalendarEvent(id: number, signal?: AbortSignal): Promise<{ ok: true }> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return (await callApi(`/api/calendar/events/${id}`, { method: 'DELETE' }, init)) as {
    ok: true;
  };
}
