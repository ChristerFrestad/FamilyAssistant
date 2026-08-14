'use strict';

// Minimal VEVENT parse/serialize. Only SUMMARY, DTSTART, DTEND, UID,
// LOCATION, DESCRIPTION (plus RRULE when present).

function unfold(ics) {
  return String(ics || '')
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '');
}

function unescapeIcs(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function escapeIcs(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function parseIcsDateTime(raw) {
  if (!raw) return { date: null, time: null };
  const value = String(raw).trim();
  const compact = value.replace(/[-:]/g, '');
  const m = compact.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/);
  if (!m) return { date: null, time: null };
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const time = m[4] ? `${m[4]}:${m[5]}` : null;
  return { date, time };
}

function parsePropertyLine(line) {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const meta = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const name = meta.split(';')[0].toUpperCase();
  return { name, value };
}

function parseVEvent(ics) {
  const text = unfold(ics);
  const match = text.match(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/i);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line) continue;
    const parsed = parsePropertyLine(line);
    if (!parsed) continue;
    fields[parsed.name] = parsed.value;
  }
  const start = parseIcsDateTime(fields.DTSTART);
  const end = parseIcsDateTime(fields.DTEND);
  return {
    uid: fields.UID || null,
    title: unescapeIcs(fields.SUMMARY || ''),
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    location: fields.LOCATION ? unescapeIcs(fields.LOCATION) : null,
    notes: fields.DESCRIPTION ? unescapeIcs(fields.DESCRIPTION) : null,
    rrule: fields.RRULE || null,
  };
}

function parseVEvents(ics) {
  const text = unfold(ics);
  const blocks = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) || [];
  return blocks.map(parseVEvent).filter(Boolean);
}

function formatIcsUtc(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${da}T${h}${mi}${s}Z`;
}

function formatIcsLocal(dateStr, timeStr) {
  const ymd = String(dateStr || '').replace(/-/g, '');
  if (!timeStr) return ymd;
  const hm = String(timeStr).replace(':', '');
  return `${ymd}T${hm.padEnd(6, '0')}`;
}

function serializeVEvent(ev) {
  const uid = ev.uid || ev.externalId || (ev.id != null ? `fa-${ev.id}@familyassistant` : null);
  if (!uid) throw new Error('serializeVEvent requires uid or id');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FamilyAssistant//Calendar//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    ev.startTime
      ? `DTSTART:${formatIcsLocal(ev.date, ev.startTime)}`
      : `DTSTART;VALUE=DATE:${formatIcsLocal(ev.date)}`,
  ];
  if (ev.endTime) lines.push(`DTEND:${formatIcsLocal(ev.date, ev.endTime)}`);
  lines.push(`SUMMARY:${escapeIcs(ev.title || '')}`);
  if (ev.location) lines.push(`LOCATION:${escapeIcs(ev.location)}`);
  if (ev.notes) lines.push(`DESCRIPTION:${escapeIcs(ev.notes)}`);
  if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = {
  parseVEvent,
  parseVEvents,
  serializeVEvent,
  parseIcsDateTime,
  escapeIcs,
  unescapeIcs,
};
