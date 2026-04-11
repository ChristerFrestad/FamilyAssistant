#!/usr/bin/env node
/**
 * scripts/coverage-gate.js
 *
 * Uke 1 av ISO-planen: lag en CI-gate som feiler hvis kodedekning
 * faller under definert terskel. Bruker native Node --experimental-test-coverage
 * og parser siste summary-linje fra spec-reporter-output.
 *
 * Usage:
 *   node --test --experimental-test-coverage tests/*.test.js 2>&1 | node scripts/coverage-gate.js
 *
 * Exit codes:
 *   0 = OK
 *   1 = coverage under terskel
 *   2 = klarte ikke å parse output
 */

'use strict';

// Terskler (baseline satt 2026-04-10). Økes gradvis etter uke 3-4 når frontend splittes.
const THRESHOLDS = {
  lines: 80.0,
  branches: 68.0,
  functions: 72.0,
};

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  process.stdout.write(c);
});
process.stdin.on('end', () => {
  // Siste "all files"-linje har form:
  // ℹ all files    |  83.26 |  71.15 |  75.83 |
  const match = buf.match(/all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/);
  if (!match) {
    console.error('\n[coverage-gate] FEIL: klarte ikke å parse "all files"-raden fra test-output.');
    process.exit(2);
  }
  const [, lines, branches, functions] = match.map(Number);
  console.log(
    `\n[coverage-gate] Resultat: lines=${lines}%, branches=${branches}%, functions=${functions}%`
  );
  console.log(
    `[coverage-gate] Terskel:  lines=${THRESHOLDS.lines}%, branches=${THRESHOLDS.branches}%, functions=${THRESHOLDS.functions}%`
  );

  const failures = [];
  if (lines < THRESHOLDS.lines) failures.push(`lines ${lines}% < ${THRESHOLDS.lines}%`);
  if (branches < THRESHOLDS.branches)
    failures.push(`branches ${branches}% < ${THRESHOLDS.branches}%`);
  if (functions < THRESHOLDS.functions)
    failures.push(`functions ${functions}% < ${THRESHOLDS.functions}%`);

  if (failures.length) {
    console.error(`[coverage-gate] BLOKKERT:\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('[coverage-gate] OK - alle terskler over baseline.');
  process.exit(0);
});
