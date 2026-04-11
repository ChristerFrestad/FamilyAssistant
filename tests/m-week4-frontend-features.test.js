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
// Onboarding wizard
// ============================================================
describe('Uke4 · Onboarding wizard', () => {
  test('onboarding.js finnes og eksporterer startOnboarding', () => {
    const p = path.join(JS_DIR, 'onboarding.js');
    assert.ok(fs.existsSync(p), 'onboarding.js mangler');
    const js = readModule('onboarding.js');
    assert.ok(/function\s+startOnboarding\s*\(/.test(js), 'startOnboarding mangler');
    assert.ok(/function\s+isOnboarded\s*\(/.test(js), 'isOnboarded mangler');
    assert.ok(/function\s+markOnboarded\s*\(/.test(js), 'markOnboarded mangler');
  });

  test('Onboarding bruker localStorage for persistence', () => {
    const js = readModule('onboarding.js');
    assert.ok(js.includes('localStorage'), 'localStorage ikke i bruk');
    assert.ok(js.includes("'fa-onboarded'") || js.includes('"fa-onboarded"'), 'nøkkelen mangler');
  });

  test('Onboarding har minst 3 steg', () => {
    const js = readModule('onboarding.js');
    const stepsMatch = js.match(/ONBOARDING_STEPS\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(stepsMatch, 'ONBOARDING_STEPS array mangler');
    const stepCount = (stepsMatch[1].match(/\btitle:/g) || []).length;
    assert.ok(stepCount >= 3, `onboarding har bare ${stepCount} steg, trenger minst 3`);
  });

  test('init.js kaller startOnboarding ved oppstart', () => {
    const js = readModule('init.js');
    assert.ok(js.includes('startOnboarding'), 'init.js kaller ikke startOnboarding');
  });

  test('index.html laster onboarding.js før init.js', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const onboardingIdx = html.indexOf('onboarding.js');
    const initIdx = html.indexOf('init.js');
    assert.ok(onboardingIdx > 0, 'onboarding.js ikke lastet');
    assert.ok(initIdx > 0, 'init.js ikke lastet');
    assert.ok(onboardingIdx < initIdx, 'onboarding.js må lastes før init.js');
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
