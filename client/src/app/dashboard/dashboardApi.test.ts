// Tests for dashboardApi.ts.
//
// Three contracts:
//   1. Each helper hits the right URL with credentials: 'include'.
//   2. Non-2xx responses throw DashboardApiError with the status.
//   3. isoDate() is timezone-agnostic enough that a fixed Date input
//      produces the expected YYYY-MM-DD slice.

import { test, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import {
  fetchToday,
  fetchShoppingSummary,
  fetchUpcomingEvents,
  isoDate,
  DashboardApiError,
} from './dashboardApi';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe('fetchToday', () => {
  test('GETs /api/today with credentials and parses the body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        dayName: 'Mandag',
        dayOfWeek: 0,
        weekYear: '2026-W18',
        meal: null,
        chores: [],
        events: [],
      })
    );
    const r = await fetchToday();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/today',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
    expect(r.dayName).toBe('Mandag');
    expect(r.chores).toEqual([]);
  });

  test('throws DashboardApiError with status on 500', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { detail: 'boom' }));
    await expect(fetchToday()).rejects.toThrowError(DashboardApiError);
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { detail: 'boom' }));
    try {
      await fetchToday();
    } catch (err) {
      expect(err).toBeInstanceOf(DashboardApiError);
      expect((err as DashboardApiError).status).toBe(500);
    }
  });
});

describe('fetchShoppingSummary', () => {
  test('GETs /api/shopping/list/current and parses the body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        id: 5,
        weekYear: '2026-W18',
        status: 'active',
        items: [{ id: 1, ingredientName: 'Mel', qty: 1, unit: 'kg', checkedOff: false }],
        totalEstPrice: 100,
      })
    );
    const r = await fetchShoppingSummary();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/shopping/list/current',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
    expect(r.items).toHaveLength(1);
  });
});

describe('fetchUpcomingEvents', () => {
  test('encodes the date range into the query string', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { events: [] }));
    await fetchUpcomingEvents('2026-04-29', '2026-05-29');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/calendar/events?from=2026-04-29&to=2026-05-29',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
  });

  test('passes through date + startTime from the API (no startsAt)', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        events: [
          {
            id: 3,
            title: 'Legetime',
            date: '2026-05-10',
            startTime: '10:00',
            endTime: null,
            location: null,
            allDay: false,
            notes: null,
            source: 'local',
          },
        ],
      })
    );
    const r = await fetchUpcomingEvents('2026-05-01', '2026-05-31');
    expect(r.events[0]).toMatchObject({
      id: 3,
      title: 'Legetime',
      date: '2026-05-10',
      startTime: '10:00',
    });
    expect(r.events[0]).not.toHaveProperty('startsAt');
  });
});

describe('isoDate', () => {
  test('returns YYYY-MM-DD for the given Date', () => {
    const d = new Date('2026-04-29T10:00:00Z');
    expect(isoDate(0, d)).toBe('2026-04-29');
  });

  test('adds the offset in days', () => {
    const d = new Date('2026-04-29T10:00:00Z');
    expect(isoDate(30, d)).toBe('2026-05-29');
  });

  test('handles month rollover', () => {
    const d = new Date('2026-04-29T10:00:00Z');
    expect(isoDate(3, d)).toBe('2026-05-02');
  });
});
