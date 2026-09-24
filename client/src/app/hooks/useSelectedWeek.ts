// Shared selected-ISO-week state for Meals + Shopping.
//
// Encoded in the URL as ?week=YYYY-WNN so deep-links work and both
// screens stay in sync when the user navigates between them. When the
// param is absent or invalid, we land on the current ISO week.

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  getIsoWeekYear,
  nextIsoWeek,
  parseWeekParam,
  previousIsoWeek,
  weekSearchPath,
} from './isoWeek';

const WEEK_PARAM = 'week';

export interface UseSelectedWeekResult {
  /** Selected ISO week (YYYY-WNN). */
  weekYear: string;
  /** Current calendar ISO week at hook call time (or overrides.now). */
  currentWeekYear: string;
  isCurrentWeek: boolean;
  goPrevWeek: () => void;
  goNextWeek: () => void;
  setWeekYear: (weekYear: string) => void;
  /** Preserve week when linking to another screen (e.g. /shopping). */
  pathWithWeek: (pathname: string) => string;
}

export interface UseSelectedWeekOverrides {
  /** Test override for "now". */
  now?: Date;
}

export function useSelectedWeek(overrides: UseSelectedWeekOverrides = {}): UseSelectedWeekResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentWeekYear = getIsoWeekYear(overrides.now ?? new Date());
  const fromUrl = parseWeekParam(searchParams.get(WEEK_PARAM));
  const weekYear = fromUrl ?? currentWeekYear;

  const setWeekYear = useCallback(
    (next: string): void => {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (next === currentWeekYear) {
            nextParams.delete(WEEK_PARAM);
          } else {
            nextParams.set(WEEK_PARAM, next);
          }
          return nextParams;
        },
        { replace: true }
      );
    },
    [currentWeekYear, setSearchParams]
  );

  const goPrevWeek = useCallback((): void => {
    setWeekYear(previousIsoWeek(weekYear));
  }, [setWeekYear, weekYear]);

  const goNextWeek = useCallback((): void => {
    setWeekYear(nextIsoWeek(weekYear));
  }, [setWeekYear, weekYear]);

  const pathWithWeek = useCallback(
    (pathname: string): string => weekSearchPath(pathname, weekYear, currentWeekYear),
    [weekYear, currentWeekYear]
  );

  return useMemo(
    () => ({
      weekYear,
      currentWeekYear,
      isCurrentWeek: weekYear === currentWeekYear,
      goPrevWeek,
      goNextWeek,
      setWeekYear,
      pathWithWeek,
    }),
    [
      weekYear,
      currentWeekYear,
      goPrevWeek,
      goNextWeek,
      setWeekYear,
      pathWithWeek,
    ]
  );
}
