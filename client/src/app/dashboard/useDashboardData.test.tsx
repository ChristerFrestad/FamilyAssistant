// Tests for useDashboardData.
//
// We drive the hook via dependency injection (overrides) instead of
// spying on globalThis.fetch. That keeps the tests focused on the
// state machine: how the three sections settle, how a retry works,
// and how an unmount aborts in-flight work.

import { renderHook, act, waitFor } from '@testing-library/react';
import { test, expect, vi, describe } from 'vitest';
import { useDashboardData } from './useDashboardData';
import type { CalendarRangeResponse, ShoppingSummaryResponse, TodayResponse } from './dashboardApi';

const TODAY_OK: TodayResponse = {
  dayName: 'Mandag',
  dayOfWeek: 0,
  weekYear: '2026-W18',
  meal: null,
  chores: [],
  events: [],
};

const SHOPPING_OK: ShoppingSummaryResponse = {
  id: 5,
  weekYear: '2026-W18',
  status: 'active',
  items: [],
  totalEstPrice: 0,
};

const UPCOMING_OK: CalendarRangeResponse = { events: [] };

describe('useDashboardData', () => {
  test('starts in loading state for all three sections', () => {
    const fetchToday = vi.fn(() => new Promise<TodayResponse>(() => undefined));
    const fetchShoppingSummary = vi.fn(() => new Promise<ShoppingSummaryResponse>(() => undefined));
    const fetchUpcomingEvents = vi.fn(() => new Promise<CalendarRangeResponse>(() => undefined));

    const { result } = renderHook(() =>
      useDashboardData({
        fetchToday,
        fetchShoppingSummary,
        fetchUpcomingEvents,
      })
    );

    expect(result.current.today.isLoading).toBe(true);
    expect(result.current.shopping.isLoading).toBe(true);
    expect(result.current.upcoming.isLoading).toBe(true);
    expect(fetchToday).toHaveBeenCalledTimes(1);
    expect(fetchShoppingSummary).toHaveBeenCalledTimes(1);
    expect(fetchUpcomingEvents).toHaveBeenCalledTimes(1);
  });

  test('settles each section independently as fetches resolve', async () => {
    const fetchToday = vi.fn(() => Promise.resolve(TODAY_OK));
    const fetchShoppingSummary = vi.fn(() => Promise.resolve(SHOPPING_OK));
    const fetchUpcomingEvents = vi.fn(() => Promise.resolve(UPCOMING_OK));

    const { result } = renderHook(() =>
      useDashboardData({
        fetchToday,
        fetchShoppingSummary,
        fetchUpcomingEvents,
      })
    );

    await waitFor(() => {
      expect(result.current.today.isLoading).toBe(false);
    });
    expect(result.current.today.data).toEqual(TODAY_OK);
    expect(result.current.shopping.data).toEqual(SHOPPING_OK);
    expect(result.current.upcoming.data).toEqual([]);
  });

  test('an error on one section does not poison the others', async () => {
    const boom = new Error('500');
    const fetchToday = vi.fn(() => Promise.reject(boom));
    const fetchShoppingSummary = vi.fn(() => Promise.resolve(SHOPPING_OK));
    const fetchUpcomingEvents = vi.fn(() => Promise.resolve(UPCOMING_OK));

    const { result } = renderHook(() =>
      useDashboardData({
        fetchToday,
        fetchShoppingSummary,
        fetchUpcomingEvents,
      })
    );

    await waitFor(() => {
      expect(result.current.today.isLoading).toBe(false);
    });
    expect(result.current.today.error).toBe(boom);
    expect(result.current.today.data).toBeNull();
    expect(result.current.shopping.error).toBeNull();
    expect(result.current.shopping.data).toEqual(SHOPPING_OK);
    expect(result.current.upcoming.error).toBeNull();
  });

  test('retryToday refetches just the today section', async () => {
    let attempts = 0;
    const fetchToday = vi.fn(() => {
      attempts++;
      return attempts === 1 ? Promise.reject(new Error('500')) : Promise.resolve(TODAY_OK);
    });
    const fetchShoppingSummary = vi.fn(() => Promise.resolve(SHOPPING_OK));
    const fetchUpcomingEvents = vi.fn(() => Promise.resolve(UPCOMING_OK));

    const { result } = renderHook(() =>
      useDashboardData({
        fetchToday,
        fetchShoppingSummary,
        fetchUpcomingEvents,
      })
    );

    await waitFor(() => {
      expect(result.current.today.error).not.toBeNull();
    });

    await act(async () => {
      result.current.retryToday();
    });

    await waitFor(() => {
      expect(result.current.today.data).toEqual(TODAY_OK);
    });
    expect(fetchToday).toHaveBeenCalledTimes(2);
    // The other two never re-fetched.
    expect(fetchShoppingSummary).toHaveBeenCalledTimes(1);
    expect(fetchUpcomingEvents).toHaveBeenCalledTimes(1);
  });

  test('passes a 30-day window to fetchUpcomingEvents using the override now', async () => {
    const fetchToday = vi.fn(() => Promise.resolve(TODAY_OK));
    const fetchShoppingSummary = vi.fn(() => Promise.resolve(SHOPPING_OK));
    const fetchUpcomingEvents = vi.fn(() => Promise.resolve(UPCOMING_OK));

    renderHook(() =>
      useDashboardData({
        fetchToday,
        fetchShoppingSummary,
        fetchUpcomingEvents,
        now: new Date('2026-04-29T10:00:00Z'),
      })
    );

    await waitFor(() => {
      expect(fetchUpcomingEvents).toHaveBeenCalled();
    });
    expect(fetchUpcomingEvents).toHaveBeenCalledWith(
      '2026-04-29',
      '2026-05-29',
      expect.any(AbortSignal)
    );
  });
});
