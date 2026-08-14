// Hook that owns Chores fetch + selected-day state.
//
// GET /api/chores/current is required. GET /api/family is a soft
// dependency used only for the adult assignee picker.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFamily, type FamilyUser } from '../family/familyApi';
import { fetchChoresCurrent, type ChoresCurrentResponse } from './choresApi';
import { isoWeekday } from './choreUtils';

export interface UseChoresDataResult {
  week: ChoresCurrentResponse | null;
  isLoading: boolean;
  error: Error | null;
  familyUsers: FamilyUser[];
  selectedDayIndex: number;
  todayIndex: number;
  selectDay: (index: number) => void;
  retry: () => void;
  /** Refetch without flipping the skeleton. */
  refresh: () => void;
}

export interface UseChoresDataOverrides {
  fetchChoresCurrent?: typeof fetchChoresCurrent;
  fetchFamily?: typeof fetchFamily;
  now?: Date;
}

export function useChoresData(overrides: UseChoresDataOverrides = {}): UseChoresDataResult {
  const fetchChoresFn = overrides.fetchChoresCurrent ?? fetchChoresCurrent;
  const fetchFamilyFn = overrides.fetchFamily ?? fetchFamily;
  const fixedNow = overrides.now;

  const [week, setWeek] = useState<ChoresCurrentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [familyUsers, setFamilyUsers] = useState<FamilyUser[]>([]);

  const today = fixedNow ?? new Date();
  const todayIndex = isoWeekday(today);
  const [selectedDayIndex, setSelectedDayIndex] = useState(todayIndex);

  const choresCtrlRef = useRef<AbortController | null>(null);
  const familyCtrlRef = useRef<AbortController | null>(null);

  const silentLoad = useCallback((): void => {
    choresCtrlRef.current?.abort();
    familyCtrlRef.current?.abort();
    const choresCtrl = new AbortController();
    const familyCtrl = new AbortController();
    choresCtrlRef.current = choresCtrl;
    familyCtrlRef.current = familyCtrl;

    fetchChoresFn(choresCtrl.signal).then(
      (res) => {
        if (choresCtrl.signal.aborted) return;
        setWeek(res);
      },
      () => {
        /* keep the last good week */
      }
    );

    fetchFamilyFn(familyCtrl.signal).then(
      (res) => {
        if (familyCtrl.signal.aborted) return;
        setFamilyUsers(Array.isArray(res.users) ? res.users : []);
      },
      () => {
        /* keep last users */
      }
    );
  }, [fetchChoresFn, fetchFamilyFn]);

  const load = useCallback((): void => {
    choresCtrlRef.current?.abort();
    familyCtrlRef.current?.abort();
    const choresCtrl = new AbortController();
    const familyCtrl = new AbortController();
    choresCtrlRef.current = choresCtrl;
    familyCtrlRef.current = familyCtrl;

    setIsLoading(true);
    setError(null);

    fetchChoresFn(choresCtrl.signal).then(
      (res) => {
        if (choresCtrl.signal.aborted) return;
        setWeek(res);
        setIsLoading(false);
      },
      (err: unknown) => {
        if (choresCtrl.signal.aborted) return;
        setWeek(null);
        setIsLoading(false);
        setError(err instanceof Error ? err : new Error('Failed to load chores'));
      }
    );

    fetchFamilyFn(familyCtrl.signal).then(
      (res) => {
        if (familyCtrl.signal.aborted) return;
        setFamilyUsers(Array.isArray(res.users) ? res.users : []);
      },
      () => {
        if (familyCtrl.signal.aborted) return;
        setFamilyUsers([]);
      }
    );
  }, [fetchChoresFn, fetchFamilyFn]);

  useEffect(() => {
    load();
    const choresCtrl = choresCtrlRef.current;
    const familyCtrl = familyCtrlRef.current;
    return () => {
      choresCtrl?.abort();
      familyCtrl?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectDay = useCallback((index: number): void => {
    if (!Number.isInteger(index) || index < 0 || index > 6) return;
    setSelectedDayIndex(index);
  }, []);

  return {
    week,
    isLoading,
    error,
    familyUsers,
    selectedDayIndex,
    todayIndex,
    selectDay,
    retry: load,
    refresh: silentLoad,
  };
}
