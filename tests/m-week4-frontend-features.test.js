// Uke 4 frontend feature tests
//
// Verifiserer at de nye modulene fra uke 4 er korrekt strukturert og at
// alle funksjonelle kontrakter er på plass:
//
//   - shopping.js har addShoppingItem (bugfix)
//   - core.js har showConfirm med korrekt signature
//   - onboarding.js har startOnboarding + localStorage-flagg
//   - init.js aktiverer onboarding
//   - meals.js har global Esc-handler for modalBg
//
// Statisk analyse — vi parser JS-filene som tekst og verifiserer mønstre.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'public', 'js');

function readModule(name) {
  return fs.readFileSync(path.join(JS_DIR, name), 'utf8');
}

// ============================================================
// Bugfix: addShoppingItem
// ============================================================
describe('Uke4 · Bugfix: addShoppingItem', () => {
  test('shopping.js definerer addShoppingItem-funksjonen', () => {
    const js = readModule('shopping.js');
    assert.ok(
      /async\s+function\s+addShoppingItem\s*\(/.test(js),
      'addShoppingItem er ikke definert som async function'
    );
  });

  test('addShoppingItem leser #addItemInput og #addItemCategory', () => {
    const js = readModule('shopping.js');
    const fnMatch = js.match(/async\s+function\s+addShoppingItem\s*\([\s\S]*?\n\}/);
    assert.ok(fnMatch, 'kan ikke finne addShoppingItem-body');
    const body = fnMatch[0];
    assert.ok(
      body.includes("getElementById('addItemInput')") ||
        body.includes('getElementById("addItemInput")'),
      'addShoppingItem leser ikke addItemInput'
    );
    assert.ok(
      body.includes("getElementById('addItemCategory')") ||
        body.includes('getElementById("addItemCategory")'),
      'addShoppingItem leser ikke addItemCategory'
    );
    assert.ok(
      body.includes("'/api/shopping/add'"),
      'addShoppingItem poster ikke til /api/shopping/add'
    );
  });

  test('addShoppingItem viser toast, ikke alert', () => {
    const js = readModule('shopping.js');
    const fnMatch = js.match(/async\s+function\s+addShoppingItem\s*\([\s\S]*?\n\}/);
    assert.ok(fnMatch);
    const body = fnMatch[0];
    assert.ok(body.includes('showToast('), 'addShoppingItem bruker ikke showToast');
    assert.ok(!body.includes('alert('), 'addShoppingItem bruker alert - burde bruke showToast');
  });
});

// ============================================================
// Confirm dialog
// ============================================================
describe('Uke4 · showConfirm utility', () => {
  test('core.js eksporterer showConfirm med destructive-variant', () => {
    const js = readModule('core.js');
    assert.ok(/function\s+showConfirm\s*\(/.test(js), 'showConfirm-funksjon mangler');
    assert.ok(js.includes('destructive = false'), 'destructive default-parameter mangler');
    assert.ok(js.includes('return new Promise'), 'returnerer ikke Promise');
  });

  test('showConfirm gjenoppretter fokus etter lukking', () => {
    const js = readModule('core.js');
    assert.ok(
      js.includes('previousFocus') || js.includes('document.activeElement'),
      'showConfirm lagrer ikke forrige fokus'
    );
  });

  test('pantry.js bruker showConfirm for removeFromPantry', () => {
    const js = readModule('pantry.js');
    const fnMatch = js.match(/async\s+function\s+removeFromPantry\s*\([\s\S]*?\n\}/);
    assert.ok(fnMatch, 'removeFromPantry mangler');
    const body = fnMatch[0];
    assert.ok(body.includes('showConfirm'), 'removeFromPantry bruker ikke showConfirm');
    assert.ok(
      body.includes('destructive: true'),
      'removeFromPantry bruker ikke destructive-variant'
    );
  });

  test('settings.js bruker showConfirm for removeRecipeSource', () => {
    const js = readModule('settings.js');
    const fnMatch = js.match(/async\s+function\s+removeRecipeSource\s*\([\s\S]*?\n\}/);
    assert.ok(fnMatch, 'removeRecipeSource mangler');
    const body = fnMatch[0];
    assert.ok(body.includes('showConfirm'), 'removeRecipeSource bruker ikke showConfirm');
  });
});

// ============================================================
// Phase 13: old 4-step welcome tour removed in favour of the family
// onboarding wizard at /onboarding.html. The tests below used to assert
// the tour's existence; they are kept as a regression guard for the
// removal itself.
// ============================================================
describe('Phase 13 · Welcome-tour removed in favour of family onboarding', () => {
  test('public/js/onboarding.js is removed', () => {
    const p = path.join(JS_DIR, 'onboarding.js');
    assert.ok(!fs.existsSync(p), 'onboarding.js should be deleted');
  });

  test('init.js no longer calls startOnboarding', () => {
    const js = readModule('init.js');
    assert.ok(!js.includes('startOnboarding'), 'startOnboarding call must be gone');
  });

  test('index.html does not load onboarding.js', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assert.ok(!html.includes('onboarding.js'), 'onboarding.js script tag must be gone');
  });

  test('family onboarding wizard is present at public/onboarding.html', () => {
    const p = path.join(ROOT, 'public', 'onboarding.html');
    assert.ok(fs.existsSync(p), 'onboarding.html missing');
    const html = fs.readFileSync(p, 'utf8');
    assert.match(html, /Familie/);
    assert.match(html, /family-onboarding\.js/);
  });
});

// ============================================================
// Global Esc handler
// ============================================================
describe('Uke4 · Esc lukker modalBg', () => {
  test('meals.js har global keydown-handler for Escape', () => {
    const js = readModule('meals.js');
    assert.ok(
      js.includes('initGlobalModalKeyboard') || js.includes("ev.key !== 'Escape'"),
      'meals.js mangler global Esc-handler'
    );
    assert.ok(js.includes('settingsOpen'), 'Esc-handler sjekker ikke om settings er åpen først');
  });
});

// ============================================================
// BRUKERGUIDE.md
// ============================================================
describe('Uke4 · BRUKERGUIDE.md', () => {
  test('BRUKERGUIDE.md finnes i repo-rot', () => {
    const p = path.join(ROOT, 'BRUKERGUIDE.md');
    assert.ok(fs.existsSync(p), 'BRUKERGUIDE.md mangler');
  });

  test('BRUKERGUIDE.md dekker 6 hovedflyter', () => {
    const md = fs.readFileSync(path.join(ROOT, 'BRUKERGUIDE.md'), 'utf8');
    const topics = [
      /velkomst.*turen/i,
      /planlegge.*middager/i,
      /handletur/i,
      /husarbeid/i,
      /importere.*oppskrifter/i,
      /familieprofil/i,
    ];
    for (const topic of topics) {
      assert.ok(topic.test(md), `BRUKERGUIDE.md mangler seksjon som matcher ${topic}`);
    }
  });

  test('BRUKERGUIDE.md dokumenterer tastatur-snarveier', () => {
    const md = fs.readFileSync(path.join(ROOT, 'BRUKERGUIDE.md'), 'utf8');
    assert.ok(/tastatur/i.test(md), 'ingen seksjon om tastatur');
    assert.ok(/`Esc`/.test(md), 'Esc-tast ikke nevnt');
    assert.ok(/`Enter`/.test(md), 'Enter-tast ikke nevnt');
  });

  test('BRUKERGUIDE.md advarer om allergi-safety', () => {
    const md = fs.readFileSync(path.join(ROOT, 'BRUKERGUIDE.md'), 'utf8');
    assert.ok(/allergi/i.test(md), 'ingen omtale av allergier');
    assert.ok(
      /beste innsats|ikke garantert|dobbeltsjekke/i.test(md),
      'BRUKERGUIDE advarer ikke om LLM-allergi-risiko'
    );
  });
});
