#!/usr/bin/env node
'use strict';

// Copies the authored marketing site into public/www and brings
// self-hosted fonts + README screenshots with it. Safe to re-run.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'marketing');
const DEST = path.join(ROOT, 'public', 'www');
const FONT_SRC = path.join(ROOT, 'client', 'src', 'app', 'styles', 'fonts');
const SHOT_SRC = path.join(ROOT, 'docs', 'screenshots');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'fonts' || entry.name === 'screens') continue;
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

function copyNamed(from, to, names) {
  fs.mkdirSync(to, { recursive: true });
  for (const [srcName, destName] of names) {
    const a = path.join(from, srcName);
    if (!fs.existsSync(a)) continue;
    fs.copyFileSync(a, path.join(to, destName));
  }
}

if (!fs.existsSync(path.join(SRC, 'index.html'))) {
  console.error('marketing/index.html missing');
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
copyDir(SRC, DEST);

copyNamed(FONT_SRC, path.join(DEST, 'fonts'), [
  ['InstrumentSerif-Regular.woff2', 'InstrumentSerif-Regular.woff2'],
  ['InstrumentSerif-Italic.woff2', 'InstrumentSerif-Italic.woff2'],
  ['Geist[wght].woff2', 'Geist.woff2'],
  ['GeistMono[wght].woff2', 'GeistMono.woff2'],
  ['OFL-Geist.txt', 'OFL-Geist.txt'],
  ['OFL-InstrumentSerif.txt', 'OFL-InstrumentSerif.txt'],
]);

copyNamed(FONT_SRC, path.join(SRC, 'fonts'), [
  ['InstrumentSerif-Regular.woff2', 'InstrumentSerif-Regular.woff2'],
  ['InstrumentSerif-Italic.woff2', 'InstrumentSerif-Italic.woff2'],
  ['Geist[wght].woff2', 'Geist.woff2'],
  ['GeistMono[wght].woff2', 'GeistMono.woff2'],
]);

copyNamed(SHOT_SRC, path.join(DEST, 'screens'), [
  ['01-dashboard.png', '01-dashboard.png'],
  ['02-meals-weekplan.png', '02-meals-weekplan.png'],
  ['03-shopping-list.png', '03-shopping-list.png'],
  ['04-pantry.png', '04-pantry.png'],
]);

copyNamed(SHOT_SRC, path.join(SRC, 'screens'), [
  ['01-dashboard.png', '01-dashboard.png'],
  ['02-meals-weekplan.png', '02-meals-weekplan.png'],
  ['03-shopping-list.png', '03-shopping-list.png'],
  ['04-pantry.png', '04-pantry.png'],
]);

console.log('marketing → public/www');
