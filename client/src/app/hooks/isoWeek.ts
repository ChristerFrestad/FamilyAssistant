// ISO week helpers shared by Meals + Shopping week navigation.
// Must stay aligned with server/seed.js getWeekYear (UTC).

const WEEK_RE = /^(\d{4})-W(\d{2})$/;

export function isValidWeekYear(weekYear: string): boolean {
  return WEEK_RE.test(weekYear);
}

/**
 * ISO week-year string (YYYY-WNN) for a calendar date.
 * Matches server/seed.js getWeekYear.
 */
export function getIsoWeekYear(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Return the week string when valid, else null. */
export function parseWeekParam(value: string | null | undefined): string | null {
  if (!value || !isValidWeekYear(value)) return null;
  return value;
}

export function previousIsoWeek(weekYear: string): string {
  const m = WEEK_RE.exec(weekYear);
  if (!m) return weekYear;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week > 1) return `${year}-W${String(week - 1).padStart(2, '0')}`;
  // Dec 28 is always in the last ISO week of that year.
  return getIsoWeekYear(new Date(Date.UTC(year - 1, 11, 28)));
}

export function nextIsoWeek(weekYear: string): string {
  const m = WEEK_RE.exec(weekYear);
  if (!m) return weekYear;
  const year = Number(m[1]);
  const week = Number(m[2]);
  // Monday of this ISO week via Jan 4 (always in week 1), then +7 days.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (week - 1) * 7);
  monday.setUTCDate(monday.getUTCDate() + 7);
  return getIsoWeekYear(monday);
}

/**
 * Build a path that carries ?week= only when it differs from the current
 * ISO week (keeps default URLs clean).
 */
export function weekSearchPath(pathname: string, weekYear: string, currentWeek: string): string {
  if (weekYear === currentWeek) return pathname;
  return `${pathname}?week=${encodeURIComponent(weekYear)}`;
}
