'use strict';

// The FamilyAssistant repo is public. Operator production hostnames
// must live in Portainer env, never in git.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'public', 'coverage', 'data', '.grok']);
const FORBIDDEN = [/hverdagsplanleggeren\.com/i];

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
      continue;
    }
    if (!/\.(js|ts|tsx|md|html|txt|xml|yml|yaml|example|css|json)$/i.test(entry.name)) {
      continue;
    }
    acc.push(full);
  }
  return acc;
}

test('tracked source does not contain operator production hostnames', () => {
  const hits = [];
  for (const file of walk(ROOT, [])) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of FORBIDDEN) {
      if (re.test(text)) hits.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(hits, [], `operator hostname leaked in:\n${hits.join('\n')}`);
});
