'use strict';

// Host-gated marketing site. Empty MARKETING_HOSTS must not change
// LAN / app behaviour. Apex Host serves crawlable HTML from marketing/.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');

const APEX = 'hverdagsplanleggeren.com';
const WWW = 'www.hverdagsplanleggeren.com';
const APP = 'app.hverdagsplanleggeren.com';

let server;

before(async () => {
  process.env.MARKETING_HOSTS = `${APEX},${WWW}`;
  process.env.MARKETING_CANONICAL = 'https://hverdagsplanleggeren.com';
  server = await startTestServer();
});

after(async () => {
  if (server) await server.close();
  delete process.env.MARKETING_HOSTS;
  delete process.env.MARKETING_CANONICAL;
});

function get(path, host) {
  return request(server.baseUrl, 'GET', path, { headers: { Host: host } });
}

describe('marketing host routing', () => {
  test('apex GET / is crawlable HTML with the 5-second product sentence', async () => {
    const r = await get('/', APEX);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'] || '', /text\/html/);
    assert.match(r.raw, /Ett sted for middag, gjøremål, kjøkkenet og handlelisten/);
    assert.match(r.raw, /<h1/);
    assert.match(r.raw, /Hverdagsplanleggeren er en norsk familieapp/);
    assert.equal(r.headers['x-robots-tag'], 'index, follow');
  });

  test('loopback GET / is not the marketing page', async () => {
    const r = await request(server.baseUrl, 'GET', '/');
    assert.notEqual(r.status, 301);
    assert.ok(
      !String(r.raw).includes('Ett sted for middag, gjøremål, kjøkkenet og handlelisten'),
      'LAN/app host must not receive the marketing homepage'
    );
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  });

  test('app host GET / is not marketing', async () => {
    const r = await get('/', APP);
    assert.ok(!String(r.raw).includes('Ett sted for middag, gjøremål, kjøkkenet og handlelisten'));
  });

  test('www GET / 301s to canonical apex', async () => {
    const r = await get('/', WWW);
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, 'https://hverdagsplanleggeren.com/');
  });

  test('unknown marketing path is 404, not the SPA shell', async () => {
    const r = await get('/does-not-exist', APEX);
    assert.equal(r.status, 404);
    assert.ok(!String(r.raw).includes('id="root"'));
  });

  test('entity pages serve on apex', async () => {
    for (const p of ['/middag/', '/handleliste/', '/gjoremål/', '/slik-fungerer-det/', '/en/']) {
      const r = await get(p, APEX);
      assert.equal(r.status, 200, p);
      assert.match(r.raw, /<h1/);
    }
  });

  test('apex robots.txt allows crawlers and points at sitemap', async () => {
    const r = await get('/robots.txt', APEX);
    assert.equal(r.status, 200);
    assert.match(r.raw, /Allow: \//);
    assert.match(r.raw, /Sitemap: https:\/\/hverdagsplanleggeren.com\/sitemap.xml/);
    assert.match(r.raw, /GPTBot/);
  });

  test('app host robots.txt disallows everything', async () => {
    const r = await get('/robots.txt', APP);
    assert.equal(r.status, 200);
    assert.match(r.raw, /Disallow: \//);
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  });

  test('llms.txt is the agent map', async () => {
    const r = await get('/llms.txt', APEX);
    assert.equal(r.status, 200);
    assert.match(r.raw, /Hverdagsplanleggeren/);
    assert.match(r.raw, /middag, gjøremål/);
    assert.match(r.raw, /llms-full.txt/);
  });
});
