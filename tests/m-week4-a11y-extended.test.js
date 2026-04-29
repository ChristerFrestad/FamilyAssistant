// Uke 4 (FE-10): utvidet a11y-regresjonstest for modulariserte frontend-filer
//
// Tidligere M3.3-testen skannet bare index.html. Nå som frontend er splittet
// i public/js/*.js og public/css/*.css, utvider vi statisk a11y-skanning til:
//
//   1. Verifisere at alle inline onclick-refs i HTML peker til definerte
//      funksjoner i public/js/* (ingen "dead references" som f.eks.
//      addShoppingItem() var før uke 4-fixet)
//   2. Alle modal/dialog-konstruksjoner i JS har role="dialog" + aria-modal
//   3. ConfirmDialog har aria-labelledby + aria-describedby
//   4. Onboarding-overlay har tab-focus-trap (Esc + Tab-handling)
//   5. Alle destruktive DELETE-operasjoner bruker showConfirm, ikke native confirm()
//
// Statisk analyse — ingen nettleser eller puppeteer krevet. Dette holder
// CI-kjøringen rask og uten nye devDeps.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const JS_DIR = path.join(ROOT, 'public', 'js');

function readHtml() {
  return fs.readFileSync(HTML_PATH, 'utf8');
}
function readAllJs() {
  if (!fs.existsSync(JS_DIR)) return '';
  const files = fs
    .readdirSync(JS_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();
  return files
    .map((f) => fs.readFileSync(path.join(JS_DIR, f), 'utf8'))
    .join('\n/*MODULEBREAK*/\n');
}

describe('Uke4 · A11y utvidet — inline handlers peker til definerte funksjoner', () => {
  test('Alle onclick="fn()" i HTML er definert i public/js/*', () => {
    const html = readHtml();
    const js = readAllJs();
    // Hent ut alle unike funksjonsnavn fra onclick-attributter i HTML-skallet
    const handlers = new Set();
    for (const m of html.matchAll(/onclick\s*=\s*["']([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) {
      handlers.add(m[1]);
    }
    const missing = [];
    for (const h of handlers) {
      // Sjekk om funksjonen er definert (enten function-decl eller async function).
      // Bruk strengkonkatenasjon for å unngå at backslashes konsumeres av template-literal.
      const pattern = '(?:^|\\s)(?:async\\s+)?function\\s+' + h + '\\s*\\(';
      const re = new RegExp(pattern, 'm');
      if (!re.test(js)) missing.push(h);
    }
    assert.deepEqual(
      missing,
      [],
      `inline onclick-refs uten tilsvarende funksjonsdefinisjon: ${missing.join(', ')}`
    );
  });
});

describe('Uke4 · A11y utvidet — dialogs og modaler', () => {
  test('showConfirm oppretter dialog med role="dialog" og aria-modal', () => {
    const js = readAllJs();
    // Finn showConfirm-funksjonen
    assert.ok(js.includes('function showConfirm('), 'showConfirm-funksjon mangler');
    assert.ok(/role['"]?\s*,\s*['"]dialog['"]/.test(js), 'showConfirm bruker ikke role=dialog');
    assert.ok(
      /aria-modal['"]?\s*,\s*['"]true['"]/.test(js),
      'showConfirm setter ikke aria-modal=true'
    );
    assert.ok(/aria-labelledby/.test(js), 'showConfirm bruker ikke aria-labelledby');
    assert.ok(/aria-describedby/.test(js), 'showConfirm bruker ikke aria-describedby');
  });

  test('showConfirm har tab-fokus-håndtering', () => {
    const js = readAllJs();
    assert.ok(/ev\.key\s*===\s*['"]Tab['"]/.test(js), 'showConfirm håndterer ikke Tab-key');
    assert.ok(/ev\.key\s*===\s*['"]Escape['"]/.test(js), 'showConfirm håndterer ikke Escape-key');
  });

  // The legacy /public/onboarding.html assertion that previously lived
  // here was retired in PR #77 (atomic onboarding) when the wizard moved
  // to the v2 SPA at /v2/onboarding/*.

  test('Global Esc-handler lukker modalBg', () => {
    const js = readAllJs();
    assert.ok(
      js.includes('initGlobalModalKeyboard') || js.includes("ev.key !== 'Escape'"),
      'global modal-esc-handler mangler'
    );
  });
});

describe('Uke4 · A11y utvidet — destructive operations bruker showConfirm', () => {
  test('Ingen native confirm() i destructive delete-paths', () => {
    const js = readAllJs();

    // Finn delete-handlers: funksjoner som kaller DELETE-metoden
    // Vi hopper over showConfirm og initGlobalModalKeyboard sine kommentarer
    // siden de nevner "confirm" i dokumentasjon.
    const lines = js.split('\n');
    const offenders = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match faktisk bruk av native confirm(), ikke i kommentar
      if (/^\s*(?:if\s*\(|const\s+\w+\s*=\s*)?confirm\s*\(/.test(line)) {
        // Sjekk at denne linjen ikke er en del av showConfirm-definisjonen
        // (som ikke selv kaller confirm)
        offenders.push({ line: i + 1, text: line.trim().slice(0, 100) });
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `native confirm() i stedet for showConfirm: ${JSON.stringify(offenders)}`
    );
  });
});

describe('Uke4 · A11y utvidet — CSS bevarer prefers-reduced-motion', () => {
  test('Confirm-dialog respekterer prefers-reduced-motion', () => {
    const cssPath = path.join(ROOT, 'public', 'css', 'components-extended.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert.ok(
      /prefers-reduced-motion[^}]*confirm-overlay/s.test(css) ||
        /prefers-reduced-motion:\s*reduce[^}]*confirm/s.test(css),
      'confirm-dialog mangler prefers-reduced-motion-regel'
    );
  });
});
