// Unit tests for LRU response cache (ren logikk)

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createCache } = require('../server/http/cache');

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
    await new Promise(r => setTimeout(r, 20));
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
