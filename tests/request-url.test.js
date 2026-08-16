'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIncomingUrl } = require('../server/http/request-url');

const HOST = 'marketing.example';

function pathOf(reqUrl) {
  return normalizeIncomingUrl(reqUrl, HOST).pathname;
}

test('normal GET / stays /', () => {
  assert.equal(pathOf('/'), '/');
  assert.equal(pathOf('/login'), '/login');
  assert.equal(pathOf('/middag/'), '/middag/');
});

test('empty or missing request-target becomes /', () => {
  assert.equal(pathOf(''), '/');
  assert.equal(pathOf(null), '/');
  assert.equal(pathOf(undefined), '/');
});

test('bare host (Messenger no-slash share) becomes /', () => {
  assert.equal(pathOf('marketing.example'), '/');
  assert.equal(pathOf('marketing.example/'), '/');
  assert.equal(pathOf('/marketing.example'), '/');
  assert.equal(pathOf('/marketing.example/'), '/');
});

test('absolute-form without path becomes /', () => {
  assert.equal(pathOf('https://marketing.example'), '/');
  assert.equal(pathOf('https://marketing.example/'), '/');
  assert.equal(pathOf('http://marketing.example/login'), '/login');
});

test('query string is kept when collapsing the host to /', () => {
  const u = normalizeIncomingUrl('https://marketing.example?fbclid=1', HOST);
  assert.equal(u.pathname, '/');
  assert.equal(u.search, '?fbclid=1');
});
