import { describe, expect, test } from 'vitest';
import {
  getIsoWeekYear,
  nextIsoWeek,
  parseWeekParam,
  previousIsoWeek,
  weekSearchPath,
} from './isoWeek';

describe('getIsoWeekYear', () => {
  test('maps a known Thursday to its ISO week', () => {
    // 2026-04-30 is Thursday of 2026-W18
    expect(getIsoWeekYear(new Date(2026, 3, 30))).toBe('2026-W18');
  });
});

describe('previousIsoWeek / nextIsoWeek', () => {
  test('steps within the same year', () => {
    expect(previousIsoWeek('2026-W18')).toBe('2026-W17');
    expect(nextIsoWeek('2026-W18')).toBe('2026-W19');
  });

  test('crosses the year boundary backward from W01', () => {
    const prev = previousIsoWeek('2026-W01');
    expect(prev).toMatch(/^2025-W(52|53)$/);
  });

  test('next then previous returns to start', () => {
    const start = '2026-W01';
    expect(previousIsoWeek(nextIsoWeek(start))).toBe(start);
  });
});

describe('parseWeekParam', () => {
  test('accepts valid weeks and rejects junk', () => {
    expect(parseWeekParam('2026-W09')).toBe('2026-W09');
    expect(parseWeekParam('2026-W9')).toBeNull();
    expect(parseWeekParam('nope')).toBeNull();
    expect(parseWeekParam(null)).toBeNull();
  });
});

describe('weekSearchPath', () => {
  test('omits ?week when on the current week', () => {
    expect(weekSearchPath('/meals', '2026-W18', '2026-W18')).toBe('/meals');
  });
  test('adds ?week when viewing another week', () => {
    expect(weekSearchPath('/shopping', '2026-W19', '2026-W18')).toBe('/shopping?week=2026-W19');
  });
});
