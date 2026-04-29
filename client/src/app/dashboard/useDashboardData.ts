// Hook that orchestrates the three parallel fetches feeding the
// dashboard cards. Each section (today/shopping/events) keeps its
// own loading + error state AND its own AbortController so a
// retry on one card doesn't cancel an in-flight fetch on another.
//
// Strategy A from PR-#? Fase 2A analysis: no aggregated backend
// endpoint, no Promise.all-as-one-thing. The three fetches fire
// together when the hook mounts, but each settles independently
// so we get per-card retry granularity for free.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchToday,
  fetchShoppingSummary,
  fetchUpcomingEvents,
  isoDate,
  type CalendarEvent,
  type TodayResponse,
  type ShoppingSummaryResponse,
} from './dashboardApi';

const UPCOMING_WINDOW_DAYS = 30;

type SectionState<T> = {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
};

export interface DashboardData {
  today: SectionState<TodayResponse>;
  shopping: SectionState<ShoppingSummaryResponse>;
  upcoming: SectionState<CalendarEvent[]>;
  retryToday: () => void;
  retryShopping: () => void;
  retryUpcoming: () => void;
}

function initialSection<T>(): SectionState<T> {
  return { data: null, isLoading: true, error: null };
}

/**
 * Optional override hook for tests — lets a test inject the three
 * fetch helpers without spying on globalThis.fetch. Production code
 * never passes overrides; the hook resolves to the real helpers.
 */
export interface UseDashboardDataOverrides {
  fetchToday?: typeof fetchToday;
  fetchShoppingSummary?: typeof fetchShoppingSummary;
  fetchUpcomingEvents?: typeof fetchUpcomingEvents;
  /** Test override for "today" — defaults to new Date() at call time. */
  now?: Date;
}

export function useDashboardData(overrides: UseDashboardDataOverrides = {}): DashboardData {
  const [today, setToday] = useState<SectionState<TodayResponse>>(initialSection);
  const [shopping, setShopping] = useState<SectionState<ShoppingSummaryResponse>>(initialSection);
  const [upcoming, setUpcoming] = useState<SectionState<CalendarEvent[]>>(initialSection);

  // Per-section abort-controllers stored in refs so a retry on one
  // card never cancels another card's in-flight fetch. Unmount aborts
  // all three.
  const todayCtrlRef = useRef<AbortController | null>(null);
  const shoppingCtrlRef = useRef<AbortController | null>(null);
  const upcomingCtrlRef = useRef<AbortController | null>(null);

  const todayFn = overrides.fetchToday ?? fetchToday;
  const shoppingFn = overrides.fetchShoppingSummary ?? fetchShoppingSummary;
  const upcomingFn = overrides.fetchUpcomingEvents ?? fetchUpcomingEvents;
  const now = overrides.now;

  const loadToday = useCallback((): void => {
    todayCtrlRef.current?.abort();
    const ctrl = new AbortController();
    todayCtrlRef.current = ctrl;
    setToday({ data: null, isLoading: true, error: null });
    todayFn(ctrl.signal).then(
      (data) => {
        if (ctrl.signal.aborted) return;
        setToday({ data, isLoading: false, error: null });
      },
      (err) => {
        if (ctrl.signal.aborted) return;
        setToday({
          data: null,
          isLoading: false,
          error: err instanceof Error ? err : new Error('Failed to load today'),
        });
      }
    );
  }, [todayFn]);

  const loadShopping = useCallback((): void => {
    shoppingCtrlRef.current?.abort();
    const ctrl = new AbortController();
    shoppingCtrlRef.current = ctrl;
    setShopping({ data: null, isLoading: true, error: null });
    shoppingFn(ctrl.signal).then(
      (data) => {
        if (ctrl.signal.aborted) return;
        setShopping({ data, isLoading: false, error: null });
      },
      (err) => {
        if (ctrl.signal.aborted) return;
        setShopping({
          data: null,
          isLoading: false,
          error: err instanceof Error ? err : new Error('Failed to load shopping'),
        });
      }
    );
  }, [shoppingFn]);

  const loadUpcoming = useCallback((): void => {
    upcomingCtrlRef.current?.abort();
    const ctrl = new AbortController();
    upcomingCtrlRef.current = ctrl;
    setUpcoming({ data: null, isLoading: true, error: null });
    const baseDate = now ?? new Date();
    const from = isoDate(0, baseDate);
    const to = isoDate(UPCOMING_WINDOW_DAYS, baseDate);
    upcomingFn(from, to, ctrl.signal).then(
      (res) => {
        if (ctrl.signal.aborted) return;
        setUpcoming({ data: res.events ?? [], isLoading: false, error: null });
      },
      (err) => {
        if (ctrl.signal.aborted) return;
        setUpcoming({
          data: null,
          isLoading: false,
          error: err instanceof Error ? err : new Error('Failed to load events'),
        });
      }
    );
  }, [upcomingFn, now]);

  // Initial fan-out on mount + abort on unmount. Keep the deps
  // array empty so the three loaders fire exactly once per mount;
  // per-card retry uses the dedicated callbacks below.
  useEffect(() => {
    loadToday();
    loadShopping();
    loadUpcoming();
    return () => {
      todayCtrlRef.current?.abort();
      shoppingCtrlRef.current?.abort();
      upcomingCtrlRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    today,
    shopping,
    upcoming,
    retryToday: loadToday,
    retryShopping: loadShopping,
    retryUpcoming: loadUpcoming,
  };
}
