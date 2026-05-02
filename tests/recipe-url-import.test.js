'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  extractJsonLd,
  findRecipeNode,
  mapRecipeNode,
  parseIsoDuration,
  parseIngredientLine,
  assertSupportedUrl,
} = require('../server/services/recipe-url-import.service');

test('parseIsoDuration handles PT30M / PT1H / PT1H15M', () => {
  assert.strictEqual(parseIsoDuration('PT30M'), '30 min');
  assert.strictEqual(parseIsoDuration('PT1H'), '1 t');
  assert.strictEqual(parseIsoDuration('PT1H15M'), '1 t 15 min');
  assert.strictEqual(parseIsoDuration(''), null);
  assert.strictEqual(parseIsoDuration('garbage'), null);
});

test('parseIngredientLine splits "200 g laks" into name+qty+unit', () => {
  assert.deepStrictEqual(parseIngredientLine('200 g laks'), {
    name: 'laks',
    qty: 200,
    unit: 'g',
  });
  assert.deepStrictEqual(parseIngredientLine('1 dl fløte'), {
    name: 'fløte',
    qty: 1,
    unit: 'dl',
  });
});

test('parseIngredientLine falls back to qty=1, unit=stk for unparseable input', () => {
  const out = parseIngredientLine('salt og pepper etter smak');
  assert.strictEqual(out.qty, 1);
  assert.strictEqual(out.unit, 'stk');
  assert.strictEqual(out.name, 'salt og pepper etter smak');
});

test('extractJsonLd returns parsed blocks', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">{"@type":"Recipe","name":"Taco"}</script>
      <script type="application/ld+json">{"@type":"Organization","name":"Matprat"}</script>
    </head></html>`;
  const blocks = extractJsonLd(html);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].name, 'Taco');
});

test('findRecipeNode walks @graph to find Recipe', () => {
  const data = [{ '@graph': [{ '@type': 'WebPage' }, { '@type': 'Recipe', name: 'Pizza' }] }];
  const node = findRecipeNode(data);
  assert.ok(node);
  assert.strictEqual(node.name, 'Pizza');
});

test('findRecipeNode returns null when no Recipe present', () => {
  const data = [{ '@type': 'Organization' }];
  assert.strictEqual(findRecipeNode(data), null);
});

test('mapRecipeNode maps a full matprat-like payload', () => {
  const url = new URL('https://www.matprat.no/oppskrifter/rask/taco/');
  const node = {
    '@type': 'Recipe',
    name: 'Klassisk Taco',
    recipeCategory: 'Hverdag',
    totalTime: 'PT20M',
    recipeYield: 4,
    recipeIngredient: ['400 g kjøttdeig', '1 pk tortilla', 'salt og pepper'],
    recipeInstructions: [
      { '@type': 'HowToStep', text: 'Brun kjøttet.' },
      { '@type': 'HowToStep', text: 'Varm tortillaene.' },
    ],
  };
  const out = mapRecipeNode(node, url);
  assert.strictEqual(out.name, 'Klassisk Taco');
  assert.strictEqual(out.category, 'rask');
  assert.strictEqual(out.prepTime, '20 min');
  assert.strictEqual(out.servings, 4);
  assert.strictEqual(out.url, 'https://www.matprat.no/oppskrifter/rask/taco/');
  assert.strictEqual(out.source, 'matprat');
  assert.strictEqual(out.ingredients.length, 3);
  assert.match(out.notes, /Brun kjøttet/);
});

test('assertSupportedUrl blocks Instagram with friendly message', () => {
  assert.throws(() => assertSupportedUrl('https://www.instagram.com/p/xyz/'), /Instagram/i);
});

test('assertSupportedUrl blocks Pinterest', () => {
  assert.throws(() => assertSupportedUrl('https://pin.it/abc'), /Pinterest/i);
});

test('assertSupportedUrl blocks private IP ranges (SSRF guard)', () => {
  assert.throws(() => assertSupportedUrl('http://192.168.1.1/recipe'), /public/i);
});

test('assertSupportedUrl rejects non-http schemes', () => {
  assert.throws(() => assertSupportedUrl('file:///etc/passwd'), /http:/);
});
