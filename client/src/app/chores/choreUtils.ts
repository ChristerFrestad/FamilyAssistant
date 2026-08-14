// Pure helpers for the Chores week board. Kept out of the screen so
// sorting, overdue, and role rules stay unit-testable without jsdom.

import type { CurrentChore } from './choresApi';

export const CHORE_ICON_PRESET = [
  '🧹',
  '🏠',
  '✨',
  '🌿',
  '🛏️',
  '🚿',
  '🗑️',
  '❄️',
  '♻️',
  '👕',
  '🍽️',
  '✅',
] as const;

export type ChoreIcon = (typeof CHORE_ICON_PRESET)[number];

/** ISO weekday with Monday=0..Sunday=6 (matches backend dayOfWeek). */
export function isoWeekday(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Friday → next week is stored as postponedTo / effectiveDay = -1. */
export function isVisibleThisWeek(chore: CurrentChore): boolean {
  return chore.effectiveDay >= 0 && chore.effectiveDay <= 6;
}

export function isOverdue(chore: CurrentChore, todayIndex: number): boolean {
  return chore.status === 'pending' && chore.effectiveDay < todayIndex && chore.effectiveDay >= 0;
}

export function isOpen(chore: CurrentChore): boolean {
  return chore.status === 'pending' || chore.status === 'postponed';
}

export function sortChoresForDay(chores: CurrentChore[], todayIndex: number): CurrentChore[] {
  return [...chores].sort((a, b) => {
    const rank = (c: CurrentChore): number => {
      if (isOverdue(c, todayIndex)) return 0;
      if (c.status !== 'done') return 1;
      return 2;
    };
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return a.choreId - b.choreId;
  });
}

export function choresOnDay(chores: CurrentChore[], dayIndex: number): CurrentChore[] {
  return chores.filter((c) => isVisibleThisWeek(c) && c.effectiveDay === dayIndex);
}

export function dayHasPending(chores: CurrentChore[], dayIndex: number): boolean {
  return choresOnDay(chores, dayIndex).some((c) => isOpen(c));
}

export function dayHasOverdue(
  chores: CurrentChore[],
  dayIndex: number,
  todayIndex: number
): boolean {
  return choresOnDay(chores, dayIndex).some((c) => isOverdue(c, todayIndex));
}

export function pendingCountOnDay(chores: CurrentChore[], dayIndex: number): number {
  return choresOnDay(chores, dayIndex).filter((c) => isOpen(c)).length;
}

export function canCompleteChore(
  chore: CurrentChore,
  role: string | undefined,
  userId: number | undefined
): boolean {
  if (!isOpen(chore)) return false;
  if (role === 'owner' || role === 'adult') return true;
  if (role !== 'child') return false;
  if (!Object.prototype.hasOwnProperty.call(chore, 'assignedUserId')) return true;
  if (chore.assignedUserId == null) return true;
  return chore.assignedUserId === userId;
}

/** Adult + pending + Mon–Fri. Sat/Sun no-op on the server. */
export function canPostponeChore(chore: CurrentChore, isAdult: boolean): boolean {
  if (!isAdult) return false;
  if (chore.status !== 'pending') return false;
  return chore.effectiveDay >= 0 && chore.effectiveDay <= 4;
}

export function frequencyBadgeVariant(frequency: string): 'mint' | 'cyan' | 'amber' {
  if (frequency === '14_dager' || frequency === 'interval') return 'cyan';
  if (frequency === 'etter_behov') return 'amber';
  return 'mint';
}

export function frequencyI18nKey(frequency: string): string {
  if (frequency === '14_dager' || frequency === 'interval') return 'frequency.14_dager';
  if (frequency === 'etter_behov') return 'frequency.etter_behov';
  return 'frequency.ukentlig';
}
