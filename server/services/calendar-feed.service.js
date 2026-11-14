'use strict';

const crypto = require('crypto');
function osloDateString(now = new Date()) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

function timingEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function mondayOf(weekYear) {
  const year = Number(String(weekYear).slice(0, 4));
  const week = Number(String(weekYear).slice(6));
  if (!year || !week) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (dow - 1) + (week - 1) * 7);
  return monday;
}

function ymd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function escapeText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function fold(line) {
  const bytes = Buffer.from(line);
  if (bytes.length <= 73) return line;
  const parts = [];
  let start = 0;
  while (start < bytes.length) {
    const end = Math.min(bytes.length, start === 0 ? 73 : start + 72);
    const chunk = bytes.subarray(start, end).toString('utf8');
    parts.push(start === 0 ? chunk : ` ${chunk}`);
    start = end;
  }
  return parts.join('\r\n');
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Oslo',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
].join('\r\n');

function createCalendarFeedRepo(db) {
  return {
    issue(familyId) {
      const secret = crypto.randomBytes(32).toString('base64url');
      const secretHash = hashSecret(secret);
      db.prepare(
        `INSERT INTO calendar_feeds (family_id, secret_hash, revoked_at)
         VALUES (?, ?, NULL)
         ON CONFLICT(family_id) DO UPDATE SET
           secret_hash = excluded.secret_hash,
           revoked_at = NULL,
           created_at = datetime('now')`
      ).run(familyId, secretHash);
      return secret;
    },
    status(familyId) {
      const row = db
        .prepare(`SELECT revoked_at as revokedAt FROM calendar_feeds WHERE family_id = ?`)
        .get(familyId);
      if (!row) return { active: false };
      return { active: row.revokedAt == null, revoked: row.revokedAt != null };
    },
    revoke(familyId) {
      const info = db
        .prepare(
          `UPDATE calendar_feeds SET revoked_at = datetime('now')
            WHERE family_id = ? AND revoked_at IS NULL`
        )
        .run(familyId);
      return info.changes > 0;
    },
    findFamilyId(secret) {
      const secretHash = hashSecret(secret);
      const row = db
        .prepare(
          `SELECT family_id, secret_hash, revoked_at FROM calendar_feeds WHERE secret_hash = ?`
        )
        .get(secretHash);
      if (!row || row.revoked_at) return null;
      if (!timingEqual(row.secret_hash, secretHash)) return null;
      return row.family_id;
    },
  };
}

function buildIcs(repos, familyId) {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const today = osloDateString(now);
  const horizon = osloDateString(new Date(now.getTime() + 120 * 86400000));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FamilyAssistant//Calendar//NO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-TIMEZONE:Europe/Oslo',
    VTIMEZONE,
  ];

  const weeks = repos._db
    .prepare(
      `SELECT DISTINCT week_year AS weekYear FROM meal_plans
        WHERE family_id = ? AND meal_type = 'middag'`
    )
    .all(familyId)
    .map((row) => row.weekYear);

  const { runWithFamily } = require('../auth/family-context');
  runWithFamily(familyId, () => {
    for (const weekYear of weeks) {
      const monday = mondayOf(weekYear);
      if (!monday) continue;
      for (const slot of repos.mealPlans.getWeek(weekYear)) {
        if (!slot.recipeId) continue;
        if (slot.status === 'away' || slot.status === 'skipped' || slot.status === 'removed') {
          continue;
        }
        const day = addDays(monday, slot.dayOfWeek);
        const date = ymd(day);
        const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
        if (iso < today || iso > horizon) continue;
        const recipe = repos.recipes.getById(slot.recipeId);
        const title = `Middag: ${recipe?.name || 'Middag'}`;
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:dinner-${familyId}-${weekYear}-${slot.dayOfWeek}@familyassistant`);
        lines.push(`DTSTAMP:${stamp}`);
        lines.push(`DTSTART;TZID=Europe/Oslo:${date}T170000`);
        lines.push(`DTEND;TZID=Europe/Oslo:${date}T180000`);
        lines.push(`SUMMARY:${escapeText(title)}`);
        lines.push('END:VEVENT');
      }
      for (const slot of repos.choreSchedules.getWeek(weekYear)) {
        const dayIndex =
          slot.postponedTo != null && slot.postponedTo >= 0 ? slot.postponedTo : slot.scheduledDay;
        if (dayIndex == null || dayIndex < 0) continue;
        const day = addDays(monday, dayIndex);
        const date = ymd(day);
        const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
        if (iso < today || iso > horizon) continue;
        const chore = repos.chores.getAll().find((item) => item.id === slot.choreId);
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:chore-${familyId}-${weekYear}-${slot.choreId}@familyassistant`);
        lines.push(`DTSTAMP:${stamp}`);
        lines.push(`DTSTART;VALUE=DATE:${date}`);
        lines.push(`DTEND;VALUE=DATE:${ymd(addDays(day, 1))}`);
        lines.push(`SUMMARY:${escapeText(`Gjøremål: ${chore?.task || 'Gjøremål'}`)}`);
        lines.push('END:VEVENT');
      }
    }
    const events = repos.calendar.getEvents(today, horizon);
    for (const event of events) {
      const compact = String(event.date || '').replace(/-/g, '');
      if (!compact) continue;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:event-${familyId}-${event.id}@familyassistant`);
      lines.push(`DTSTAMP:${stamp}`);
      if (event.allDay || !event.startTime) {
        const start = new Date(`${event.date}T00:00:00Z`);
        lines.push(`DTSTART;VALUE=DATE:${compact}`);
        lines.push(`DTEND;VALUE=DATE:${ymd(addDays(start, 1))}`);
      } else {
        const clock = String(event.startTime).replace(':', '') + '00';
        lines.push(`DTSTART;TZID=Europe/Oslo:${compact}T${clock.slice(0, 6)}`);
        lines.push(`DTEND;TZID=Europe/Oslo:${compact}T${clock.slice(0, 4)}59`);
      }
      lines.push(`SUMMARY:${escapeText(event.title)}`);
      lines.push('END:VEVENT');
    }
  });

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const hits = new Map();

function allowFeedRequest(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((ts) => now - ts < windowMs);
  if (list.length >= 30) {
    hits.set(ip, list);
    return false;
  }
  list.push(now);
  hits.set(ip, list);
  return true;
}

module.exports = {
  createCalendarFeedRepo,
  buildIcs,
  allowFeedRequest,
  hashSecret,
};
