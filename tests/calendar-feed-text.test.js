'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fold, escapeText } = require('../server/services/calendar-feed.service');

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
