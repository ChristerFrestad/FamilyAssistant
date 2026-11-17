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
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const chars = Array.from(line);
  const parts = [];
  let chunk = '';
  let budget = 75;
  for (const ch of chars) {
    const size = Buffer.byteLength(ch);
    if (chunk && Buffer.byteLength(chunk) + size > budget) {
      parts.push(chunk);
      chunk = '';
      budget = 74;
    }
    chunk += ch;
  }
  if (chunk) parts.push(chunk);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join('\r\n');
}

function clockParts(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3] || 0);
  if (h > 23 || m > 59 || s > 59) return null;
  return { h, m, s };
}

function formatClock(parts) {
  return `${String(parts.h).padStart(2, '0')}${String(parts.m).padStart(2, '0')}${String(parts.s).padStart(2, '0')}`;
}

function plusOneHour(parts) {
  const total = parts.h * 3600 + parts.m * 60 + parts.s + 3600;
  const dayCarry = Math.floor(total / 86400);
  const rem = total % 86400;
  return {
    dayCarry,
    clock: formatClock({
      h: Math.floor(rem / 3600),
      m: Math.floor((rem % 3600) / 60),
      s: rem % 60,
    }),
  };
}

const VTIMEZONE_LINES = [
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
];

function clockValue(parts) {
  return parts.h * 3600 + parts.m * 60 + parts.s;
}

const RRULE_KEYS = new Set([
  'FREQ',
  'UNTIL',
  'COUNT',
  'INTERVAL',
  'BYSECOND',
  'BYMINUTE',
  'BYHOUR',
  'BYDAY',
  'BYMONTHDAY',
  'BYYEARDAY',
  'BYWEEKNO',
  'BYMONTH',
  'BYSETPOS',
  'WKST',
]);
const RRULE_FREQ = new Set([
  'SECONDLY',
  'MINUTELY',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
]);

function recurrenceChunks(raw) {
  return String(raw || '').split(/\r\n|\n|\r|[\u000b\u000c\u0085\u2028\u2029]|(?=EXDATE)/i);
}

function sanitizeRrule(line) {
  const body = line.replace(/^RRULE:/i, '').replace(/;+$/g, '');
  if (!body) return null;
  const parts = [];
  let freq = '';
  for (const chunk of body.split(';')) {
    if (!chunk) continue;
    const eq = chunk.indexOf('=');
    if (eq <= 0) return null;
    const key = chunk.slice(0, eq).toUpperCase();
    const value = chunk.slice(eq + 1).toUpperCase();
    if (!RRULE_KEYS.has(key) || !/^[A-Z0-9,+\-]+$/.test(value)) return null;
    if (key === 'FREQ') freq = value;
    parts.push(`${key}=${value}`);
  }
  if (!RRULE_FREQ.has(freq)) return null;
  return `RRULE:${parts.join(';')}`;
}

function sanitizeExdate(line) {
  if (!/^EXDATE(?:;[A-Z0-9]+=[A-Za-z0-9_/+-]+)*:[0-9TZ,]+$/i.test(line)) return null;
  return line.replace(/^exdate/i, 'EXDATE');
}

function recurrenceLines(raw) {
  const lines = [];
  for (const chunk of recurrenceChunks(raw)) {
    const line = chunk.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '').trim();
    if (!line) continue;
    if (/^EXDATE/i.test(line)) {
      const safe = sanitizeExdate(line);
      if (safe) lines.push(safe);
      continue;
    }
    const safe = sanitizeRrule(line);
    if (safe) lines.push(safe);
  }
  return lines;
}

function redactRequestPath(pathname) {
  return String(pathname || '').replace(/\/cal(?=\/)[^?#]*/gi, '/cal/[secret]');
}

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
    ...VTIMEZONE_LINES,
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
        if (slot.status === 'away' || slot.status === 'skipped' || slot.status === 'removed') {
          continue;
        }
        const { visibleLibraryDinner } = require('./recipe-library/copy');
        const recipe = slot.recipeId
          ? repos.recipes.getById(slot.recipeId)
          : slot.libraryRecipeId
            ? visibleLibraryDinner(repos, slot.libraryRecipeId)
            : null;
        if (!recipe) continue;
        const title = `Middag: ${recipe.name || 'Middag'}`;
        const day = addDays(monday, slot.dayOfWeek);
        const date = ymd(day);
        const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
        if (iso < today || iso > horizon) continue;
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
      if (event.startTime && !event.allDay && !clockParts(event.startTime)) continue;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:event-${familyId}-${event.id}@familyassistant`);
      lines.push(`DTSTAMP:${stamp}`);
      if (event.allDay || !event.startTime) {
        const start = new Date(`${event.date}T00:00:00Z`);
        lines.push(`DTSTART;VALUE=DATE:${compact}`);
        lines.push(`DTEND;VALUE=DATE:${ymd(addDays(start, 1))}`);
      } else {
        const start = clockParts(event.startTime);
        const end = event.endTime ? clockParts(event.endTime) : null;
        lines.push(`DTSTART;TZID=Europe/Oslo:${compact}T${formatClock(start)}`);
        if (end && clockValue(end) !== clockValue(start)) {
          const endDate =
            clockValue(end) < clockValue(start)
              ? ymd(addDays(new Date(`${event.date}T00:00:00Z`), 1))
              : compact;
          lines.push(`DTEND;TZID=Europe/Oslo:${endDate}T${formatClock(end)}`);
        } else if (!end) {
          const next = plusOneHour(start);
          const endDate = next.dayCarry
            ? ymd(addDays(new Date(`${event.date}T00:00:00Z`), next.dayCarry))
            : compact;
          lines.push(`DTEND;TZID=Europe/Oslo:${endDate}T${next.clock}`);
        }
      }
      for (const ruleLine of recurrenceLines(event.rrule)) {
        lines.push(ruleLine);
      }
      lines.push(`SUMMARY:${escapeText(event.title)}`);
      lines.push('END:VEVENT');
    }
  });

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const hits = new Map();
const MAX_TRACKED_IPS = 1000;

function allowFeedRequest(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const list = (hits.get(key) || []).filter((ts) => now - ts < windowMs);
  hits.delete(key);
  if (list.length >= 30) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  while (hits.size > MAX_TRACKED_IPS) {
    const oldest = hits.keys().next().value;
    hits.delete(oldest);
  }
  return true;
}

module.exports = {
  createCalendarFeedRepo,
  buildIcs,
  allowFeedRequest,
  hashSecret,
  escapeText,
  fold,
  redactRequestPath,
};
