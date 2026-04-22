'use strict';

// Regression test for PR #59 — handleliste-tab empty bug.
//
// Empirical symptom (reported 2026-04-22): clicking the "Handletur" tab
// fired zero requests to /api/shopping/list/current in DevTools. Root cause
// traced to a likely stale cached shopping.js (SW VERSION had not been
// bumped since PR #33 — all of PR #42-#46 shipped without invalidating the
// cache).
//
// This test exercises the tab-switch code path in a minimal mock-DOM so
// future regressions where loadShopping is undefined at click-time, or
// switchTab throws before firing the fetch, are caught before reaching
// production.
//
// The test does NOT use jsdom (avoids new devDependency). It builds a
// tiny classList/getElementById/querySelectorAll stub that is just enough
// for tabs.js + shopping.js + core.js to evaluate and interact.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUB = path.join(__dirname, '..', 'public');
const JS = path.join(PUB, 'js');

// ---------------------------------------------------------------------------
// Minimal DOM — just enough for the tab-switch path to work.
// ---------------------------------------------------------------------------

function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    _classes: new Set(),
    dataset: {},
    attributes: {},
    style: {},
    _listeners: {},
    _innerHTML: '',
    onclick: null,
    classList: null,
    children: [],
  };
  el.classList = {
    add: (c) => el._classes.add(c),
    remove: (c) => el._classes.delete(c),
    contains: (c) => el._classes.has(c),
    toggle: (c) => (el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c)),
  };
  el.setAttribute = (n, v) => (el.attributes[n] = v);
  el.getAttribute = (n) => el.attributes[n];
  el.hasAttribute = (n) => n in el.attributes;
  el.removeAttribute = (n) => delete el.attributes[n];
  el.addEventListener = (ev, fn) => (el._listeners[ev] ||= []).push(fn);
  el.removeEventListener = (ev, fn) => {
    if (el._listeners[ev]) el._listeners[ev] = el._listeners[ev].filter((f) => f !== fn);
  };
  el.appendChild = (c) => {
    el.children.push(c);
    return c;
  };
  el.querySelectorAll = () => [];
  el.querySelector = () => null;
  el.closest = () => null;
  el.click = () => {
    if (typeof el.onclick === 'function') el.onclick({ target: el });
    for (const fn of el._listeners.click || []) fn({ target: el });
  };
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return el._innerHTML;
    },
    set(v) {
      el._innerHTML = String(v);
    },
  });
  return el;
}

function makeSandbox({ fetchImpl } = {}) {
  const doc = makeEl('html');
  doc._byId = {};
  doc._allTabs = [];
  doc._allViews = [];
  doc.getElementById = (id) => doc._byId[id] || null;
  doc.querySelector = (sel) => {
    if (sel.startsWith('#')) return doc._byId[sel.slice(1)] || null;
    return null;
  };
  doc.querySelectorAll = (sel) => {
    if (sel === '.tab') return doc._allTabs;
    if (sel === '.view') return doc._allViews;
    return [];
  };
  // doc already has addEventListener from makeEl('html')
  doc.createElement = makeEl;
  doc.body = makeEl('body');
  doc.activeElement = null;

  for (const view of ['viewToday', 'viewMeals', 'viewShopping', 'viewChores', 'viewChat']) {
    const viewDiv = makeEl('div');
    viewDiv.id = view;
    doc._byId[view] = viewDiv;
    doc._allViews.push(viewDiv);

    const tabBtn = makeEl('button');
    tabBtn.dataset.view = view;
    doc._allTabs.push(tabBtn);
  }

  const shoppingContent = makeEl('div');
  shoppingContent.id = 'shoppingContent';
  shoppingContent.setAttribute('aria-busy', 'true');
  doc._byId.shoppingContent = shoppingContent;

  const fetchCalls = [];
  const defaultFetch = async (url) => {
    fetchCalls.push({ url });
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        id: null,
        weekYear: '2026-W17',
        status: null,
        enrichmentStatus: 'done',
        items: [],
        categories: [],
        totalEstPrice: 0,
      }),
    };
  };

  const sandbox = {
    document: doc,
    navigator: { serviceWorker: undefined },
    fetch: fetchImpl || defaultFetch,
    localStorage: {
      _data: {},
      getItem(k) {
        return this._data[k] || null;
      },
      setItem(k, v) {
        this._data[k] = v;
      },
      removeItem(k) {
        delete this._data[k];
      },
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
  };
  sandbox.window = {
    document: doc,
    location: { href: 'http://localhost/', reload() {} },
    _events: {},
    addEventListener(ev, fn) {
      (this._events[ev] ||= []).push(fn);
    },
    removeEventListener(ev, fn) {
      if (this._events[ev]) this._events[ev] = this._events[ev].filter((f) => f !== fn);
    },
    dispatchEvent() {},
  };
  sandbox.globalThis = sandbox;

  return { sandbox, doc, fetchCalls };
}

function loadScripts(sandbox, scripts) {
  const ctx = vm.createContext(sandbox);
  for (const file of scripts) {
    const src = fs.readFileSync(path.join(JS, file), 'utf8');
    vm.runInContext(src, ctx, { filename: file });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PR #59 · tab-switch triggers shopping fetch', () => {
  test('loadShopping is a global function after loading core.js + shopping.js', () => {
    const { sandbox } = makeSandbox();
    loadScripts(sandbox, ['core.js', 'shopping.js']);
    assert.equal(typeof sandbox.loadShopping, 'function');
  });

  test('switchTab is a global function after loading tabs.js', () => {
    const { sandbox } = makeSandbox();
    loadScripts(sandbox, ['core.js', 'tabs.js']);
    assert.equal(typeof sandbox.switchTab, 'function');
  });

  test('switchTab(viewShoppingButton) fires GET /api/shopping/list/current', async () => {
    const { sandbox, doc, fetchCalls } = makeSandbox();
    loadScripts(sandbox, ['core.js', 'tabs.js', 'today.js', 'meals.js', 'shopping.js']);

    const shoppingBtn = doc._allTabs.find((b) => b.dataset.view === 'viewShopping');
    assert.ok(shoppingBtn, 'viewShopping tab button must exist in fixture');

    sandbox.switchTab(shoppingBtn);
    // loadShopping is async; await a tick so the pending fetch fires.
    await new Promise((r) => setTimeout(r, 50));

    const shoppingFetches = fetchCalls.filter((c) =>
      String(c.url).includes('/api/shopping/list/current')
    );
    assert.equal(
      shoppingFetches.length,
      1,
      `expected exactly 1 fetch to /api/shopping/list/current, got ${shoppingFetches.length}. ` +
        `All calls: ${JSON.stringify(fetchCalls.map((c) => c.url))}`
    );
  });

  test('switchTab uses typeof-guards so a missing loadShopping does NOT throw', () => {
    const { sandbox, doc } = makeSandbox();
    loadScripts(sandbox, ['core.js', 'tabs.js']); // deliberately skip shopping.js
    assert.equal(typeof sandbox.loadShopping, 'undefined');

    const shoppingBtn = doc._allTabs.find((b) => b.dataset.view === 'viewShopping');
    // If the guards were missing, this would throw ReferenceError and the
    // whole switchTab would abort. The fix adds `typeof ... === 'function'`
    // around each load* call.
    assert.doesNotThrow(() => sandbox.switchTab(shoppingBtn));
  });

  test('tabs.js source contains typeof-guards (structural assertion)', () => {
    const src = fs.readFileSync(path.join(JS, 'tabs.js'), 'utf8');
    assert.match(
      src,
      /typeof\s+loadShopping\s*===\s*'function'/,
      'switchTab must guard loadShopping call with typeof-check'
    );
    assert.match(
      src,
      /typeof\s+loadToday\s*===\s*'function'/,
      'switchTab must guard loadToday call with typeof-check'
    );
  });

  test('init.js preloads shopping data on boot', () => {
    const src = fs.readFileSync(path.join(JS, 'init.js'), 'utf8');
    assert.match(
      src,
      /loadShopping\(\)\.catch\(/,
      'init.js must preload shopping data via loadShopping().catch(...) in boot'
    );
  });

  test('sw.js VERSION has been bumped past v1.7-phase22 (PR #59 fix)', () => {
    const src = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
    const match = src.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(match, 'VERSION constant must exist in sw.js');
    assert.notEqual(
      match[1],
      'v1.7-phase22',
      'sw.js VERSION must be bumped past v1.7-phase22 so cached pre-PR-46 shopping.js is invalidated'
    );
  });
});
