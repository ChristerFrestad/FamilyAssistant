// Unit tests for LRU response cache (ren logikk)

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createCache, cacheKey } = require('../server/http/cache');

describe('createCache', () => {
  test('set + get returnerer data', () => {
    const c = createCache({ max: 10, ttlMs: 1000 });
    c.set('a', { foo: 'bar' });
    assert.deepEqual(c.get('a'), { foo: 'bar' });
    assert.equal(c.stats().hits, 1);
  });

  test('miss på ikke-eksisterende key', () => {
    const c = createCache();
    assert.equal(c.get('missing'), undefined);
    assert.equal(c.stats().misses, 1);
  });

  test('TTL expires', async () => {
    const c = createCache({ ttlMs: 10 });
    c.set('a', 1);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(c.get('a'), undefined);
  });

  test('LRU evicts oldest at max', () => {
    const c = createCache({ max: 3 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    c.set('d', 4); // skal evikte 'a'
    assert.equal(c.get('a'), undefined);
    assert.equal(c.get('d'), 4);
  });

  test('tag-invalidering fjerner alle entries med tag', () => {
    const c = createCache();
    c.set('a', 1, { tags: ['meals'] });
    c.set('b', 2, { tags: ['meals', 'today'] });
    c.set('c', 3, { tags: ['shopping'] });
    const removed = c.invalidateTag('meals');
    assert.equal(removed, 2);
    assert.equal(c.get('a'), undefined);
    assert.equal(c.get('b'), undefined);
    assert.equal(c.get('c'), 3);
  });

  test('LRU touch — get gjør entry fersk', () => {
    const c = createCache({ max: 3 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    c.get('a'); // touch 'a'
    c.set('d', 4); // skal evikte 'b' (eldste etter touch)
    assert.equal(c.get('a'), 1);
    assert.equal(c.get('b'), undefined);
  });
});

describe('cacheKey family scope', () => {
  function ctx(familyId, pathname = '/api/today', query = {}) {
    return { familyId, pathname, query };
  }

  test('positive integer family ids never share a key', () => {
    const a = cacheKey(ctx(2));
    const b = cacheKey(ctx(3));
    assert.equal(a, 'f2:/api/today?');
    assert.equal(b, 'f3:/api/today?');
    assert.notEqual(a, b);
  });

  test('null, undefined, 0, and non-integers collapse to anon', () => {
    assert.equal(cacheKey(ctx(null)), 'anon:/api/today?');
    assert.equal(cacheKey(ctx(undefined)), 'anon:/api/today?');
    assert.equal(cacheKey(ctx(0)), 'anon:/api/today?');
    assert.equal(cacheKey(ctx('2')), 'anon:/api/today?');
  });

  test('query string is sorted so key order is stable', () => {
    const key = cacheKey(ctx(4, '/api/calendar/events', { to: '2026-06-30', from: '2026-06-01' }));
    assert.equal(key, 'f4:/api/calendar/events?from=2026-06-01&to=2026-06-30');
  });
});
