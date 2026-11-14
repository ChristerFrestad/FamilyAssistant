'use strict';

// The household clock. There is no per-family zone yet, so "today"
// follows Europe/Oslo even when the process clock is UTC.

const APP_TIME_ZONE = 'Europe/Oslo';

const WEEKDAY_INDEX = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/**
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD in Europe/Oslo
 */
function osloDateString(now = new Date()) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Monday = 0 … Sunday = 6, matching meal_plans.day_of_week.
 * @param {Date} [now]
 * @returns {number}
 */
function osloDayOfWeek(now = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    weekday: 'short',
  }).format(now);
  const index = WEEKDAY_INDEX[weekday];
  return index === undefined ? 0 : index;
}

module.exports = { APP_TIME_ZONE, osloDateString, osloDayOfWeek };
