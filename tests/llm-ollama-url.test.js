'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeBaseUrl } = require('../server/llm/ollama');

test('normalizeBaseUrl strips query-string appended by browser paste', () => {
  assert.strictEqual(
    normalizeBaseUrl('http://192.168.50.123:8080/?model=llama3.2%3A3b'),
    'http://192.168.50.123:8080'
  );
});

test('normalizeBaseUrl strips hash fragment', () => {
  assert.strictEqual(normalizeBaseUrl('http://host:8080/#foo'), 'http://host:8080');
});

test('normalizeBaseUrl preserves reverse-proxy path without trailing slash', () => {
  assert.strictEqual(
    normalizeBaseUrl('https://proxy.example/ollama/'),
    'https://proxy.example/ollama'
  );
});

test('normalizeBaseUrl collapses multiple trailing slashes', () => {
  assert.strictEqual(normalizeBaseUrl('http://host:8080///'), 'http://host:8080');
});

test('normalizeBaseUrl returns DEFAULT_BASE_URL-shape for empty input', () => {
  const out = normalizeBaseUrl('');
  assert.ok(out.startsWith('http://localhost:'), 'default base should be localhost');
});

test('normalizeBaseUrl throws on garbage input', () => {
  assert.throws(() => normalizeBaseUrl('not-a-url-at-all'), /Invalid LLM base URL/);
});
