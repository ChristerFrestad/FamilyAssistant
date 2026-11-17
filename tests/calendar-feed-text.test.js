'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  fold,
  escapeText,
  buildIcs,
  redactRequestPath,
} = require('../server/services/calendar-feed.service');

test('folding stays on character boundaries for æ ø å', () => {
  const line = `SUMMARY:${'æøå'.repeat(30)}`;
  const folded = fold(line);
  for (const part of folded.split('\r\n')) {
    const content = part.startsWith(' ') ? part.slice(1) : part;
    assert.equal(Buffer.byteLength(part) <= 75, true);
    assert.equal(Buffer.from(content, 'utf8').toString('utf8'), content);
  }
  assert.equal(folded.replace(/\r\n /g, ''), line);
});

test('escapeText neutralises bare CR and LF', () => {
  const escaped = escapeText('a\nb\rc');
  assert.equal(escaped.includes('\n'), false);
  assert.equal(escaped.includes('\r'), false);
  assert.equal(escaped, 'a\\nb\\nc');
});

test('escapeText neutralises VT, line separator and NEL', () => {
  const escaped = escapeText('a\u000bb\u2028c\u0085d');
  assert.equal(escaped, 'a\\nb\\nc\\nd');
  assert.equal(/[\u000b\u2028\u0085]/.test(escaped), false);
});

function assertNoBareBreaks(ics) {
  for (let i = 0; i < ics.length; i += 1) {
    if (ics[i] === '\r') assert.equal(ics[i + 1], '\n');
    if (ics[i] === '\n') assert.equal(ics[i - 1], '\r');
  }
}

function feedRepos(events) {
  return {
    _db: { prepare: () => ({ all: () => [] }) },
    calendar: { getEvents: () => events },
  };
}

test('the feed has no bare CR or LF, including the timezone block', () => {
  const ics = buildIcs(feedRepos([]), 1);
  assertNoBareBreaks(ics);
  assert.match(ics, /RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU/);
  assert.match(ics, /RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU/);
});

test('an overnight event ends on the next day', () => {
  const ics = buildIcs(
    feedRepos([
      {
        id: 4,
        title: 'Natt',
        date: '2026-11-17',
        startTime: '23:00',
        endTime: '01:00',
        allDay: false,
      },
    ]),
    1
  );
  assert.match(ics, /DTSTART;TZID=Europe\/Oslo:20261117T230000/);
  assert.match(ics, /DTEND;TZID=Europe\/Oslo:20261118T010000/);
});

test('a Google recurrence keeps EXDATE off the RRULE line', () => {
  const ics = buildIcs(
    feedRepos([
      {
        id: 5,
        title: 'Uke',
        date: '2026-11-17',
        startTime: '17:00',
        endTime: '18:00',
        allDay: false,
        rrule: 'RRULE:FREQ=WEEKLY;EXDATE;TZID=Europe/Oslo:20261124T170000',
      },
    ]),
    1
  );
  const lines = ics.split('\r\n');
  assert.ok(lines.includes('RRULE:FREQ=WEEKLY'));
  assert.ok(lines.includes('EXDATE;TZID=Europe/Oslo:20261124T170000'));
  assert.equal(
    lines.some((line) => line.startsWith('RRULE:') && line.includes('EXDATE')),
    false
  );
  const stored = buildIcs(
    feedRepos([
      {
        id: 6,
        title: 'Uke',
        date: '2026-11-17',
        startTime: '17:00',
        endTime: '18:00',
        allDay: false,
        rrule: 'RRULE:FREQ=WEEKLY\nEXDATE;TZID=Europe/Oslo:20261124T170000',
      },
    ]),
    1
  );
  assert.ok(stored.split('\r\n').includes('RRULE:FREQ=WEEKLY'));
  assert.ok(stored.split('\r\n').includes('EXDATE;TZID=Europe/Oslo:20261124T170000'));
});

test('feed paths are redacted with or without the ics suffix', () => {
  assert.equal(redactRequestPath('/cal/fa_secret.ics'), '/cal/[secret]');
  assert.equal(redactRequestPath('/cal/fa_secret'), '/cal/[secret]');
  assert.equal(redactRequestPath('/api/today'), '/api/today');
});
