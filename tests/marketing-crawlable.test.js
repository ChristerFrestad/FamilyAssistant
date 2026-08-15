'use strict';

// The marketing homepage must be meaningful without JavaScript:
// title, description, H1, FAQ in the source, parseable JSON-LD.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOME = fs.readFileSync(path.join(__dirname, '..', 'marketing', 'index.html'), 'utf8');

test('homepage title and description name all four surfaces', () => {
  assert.match(HOME, /<title>Hverdagsplanleggeren — middag, gjøremål, kjøkken og handleliste/);
  assert.match(HOME, /name="description"[^>]+middag, gjøremål/);
  assert.match(HOME, /kjøkkenet og handlelisten/);
});

test('H1 is the 5-second sentence', () => {
  assert.match(HOME, /<h1[^>]*>Ett sted for middag, gjøremål, kjøkkenet og handlelisten\.<\/h1>/);
});

test('FAQ answers live in HTML source', () => {
  assert.match(HOME, /Hva er Hverdagsplanleggeren\?/);
  assert.match(HOME, /Hverdagsplanleggeren er en norsk familieapp som samler middag, gjøremål/);
  assert.match(HOME, /Er Hverdagsplanleggeren gratis\?/);
});

test('JSON-LD graph parses and includes required types', () => {
  const match = HOME.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'JSON-LD script missing');
  const data = JSON.parse(match[1]);
  const types = (data['@graph'] || []).map((n) => n['@type']);
  for (const needed of ['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage', 'HowTo']) {
    assert.ok(types.includes(needed), `missing ${needed}`);
  }
  const app = data['@graph'].find((n) => n['@type'] === 'SoftwareApplication');
  assert.equal(app.offers.price, '0');
  assert.ok(app.featureList.some((f) => /kjøkken/i.test(f) || /matskap/i.test(f)));
});

test('canonical, hreflang and CTA are present', () => {
  assert.match(HOME, /rel="canonical" href="\{\{CANONICAL\}\}\/"/);
  assert.match(HOME, /hreflang="nb-NO"/);
  assert.match(HOME, /hreflang="en"/);
  assert.match(HOME, /login\?mode=register/);
});

test('source HTML does not embed operator production hostnames', () => {
  assert.doesNotMatch(HOME, /hverdagsplanleggeren\.com/i);
});
