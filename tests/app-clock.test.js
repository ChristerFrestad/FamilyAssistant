'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { osloDateString, osloDayOfWeek } = require('../server/services/app-clock');
const { getWeekYearInTimeZone } = require('../server/services/seed.service');

test('today in Oslo is Monday just after midnight while UTC is still Sunday', () => {
  const instant = new Date('2026-01-04T23:30:00.000Z');
  assert.equal(instant.getUTCDay(), 0);
  assert.equal(osloDateString(instant), '2026-01-05');
  assert.equal(osloDayOfWeek(instant), 0);
  assert.equal(getWeekYearInTimeZone(instant), '2026-W02');
});

test('summer time uses the Oslo date, two hours ahead of UTC', () => {
  const instant = new Date('2026-07-05T22:30:00.000Z');
  assert.equal(osloDateString(instant), '2026-07-06');
  assert.equal(osloDayOfWeek(instant), 0);
});
