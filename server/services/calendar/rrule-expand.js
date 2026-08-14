'use strict';

// Lightweight RRULE expansion for GET windows. If no rrule is present
// the event is returned as-is (when it falls inside [from, to]).

function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatYmd(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const da = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function addDays(date, n) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + n);
  return next;
}

function addMonths(date, n) {
  const next = new Date(date.getFullYear(), date.getMonth() + n, date.getDate());
  // Clamp overflow (Jan 31 + 1 month → last day of Feb)
  if (next.getDate() !== date.getDate()) {
    next.setDate(0);
  }
  return next;
}

function parseRrule(rrule) {
  if (!rrule || typeof rrule !== 'string') return null;
  const body = rrule.replace(/^RRULE:/i, '').trim();
  if (!body) return null;
  const parts = {};
  for (const chunk of body.split(';')) {
    const [k, v] = chunk.split('=');
    if (!k || v == null) continue;
    parts[k.toUpperCase()] = v;
  }
  if (!parts.FREQ) return null;
  return parts;
}

function untilToYmd(until) {
  if (!until) return null;
  const compact = String(until).replace(/[-:]/g, '');
  const m = compact.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function nextOccurrence(current, freq, interval) {
  if (freq === 'DAILY') return addDays(current, interval);
  if (freq === 'WEEKLY') return addDays(current, 7 * interval);
  if (freq === 'MONTHLY') return addMonths(current, interval);
  if (freq === 'YEARLY') return addMonths(current, 12 * interval);
  return null;
}

function expandRrule(event, from, to) {
  const start = parseYmd(event.date);
  if (!start) return [];
  const parsed = parseRrule(event.rrule);
  if (!parsed) {
    return event.date >= from && event.date <= to ? [event] : [];
  }
  const freq = String(parsed.FREQ).toUpperCase();
  const interval = Math.max(1, parseInt(parsed.INTERVAL, 10) || 1);
  const count = parsed.COUNT ? Math.max(1, parseInt(parsed.COUNT, 10) || 1) : 400;
  const until = untilToYmd(parsed.UNTIL);
  const hardEnd = until && until < to ? until : to;

  const out = [];
  let current = start;
  let n = 0;
  while (n < count) {
    const ymd = formatYmd(current);
    if (ymd > hardEnd) break;
    if (ymd >= from && ymd <= to) {
      out.push({ ...event, date: ymd });
    }
    const next = nextOccurrence(current, freq, interval);
    if (!next) break;
    current = next;
    n += 1;
    if (n > 2000) break;
  }
  return out;
}

function expandRecurring(events, from, to) {
  const list = Array.isArray(events) ? events : [];
  const out = [];
  for (const ev of list) {
    if (!ev || !ev.rrule) {
      if (ev && ev.date >= from && ev.date <= to) out.push(ev);
      continue;
    }
    out.push(...expandRrule(ev, from, to));
  }
  out.sort((a, b) => {
    const d = String(a.date).localeCompare(String(b.date));
    if (d !== 0) return d;
    return String(a.startTime || '').localeCompare(String(b.startTime || ''));
  });
  return out;
}

module.exports = { expandRecurring, expandRrule, parseRrule };
