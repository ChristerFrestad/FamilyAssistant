// WCAG 2.1 AA token-contrast verification.
//
// This suite locks in the contrast guarantees produced by the design
// tokens in tokens.css. It is the source of truth for the kontrast-
// part of the WCAG audit shipped in Phase 3A.
//
// Approach: parse tokens.css, extract the OKLCH literal for each token
// in both light and dark themes, then assert the contrast ratio for
// every pair the product actually uses (Button primary, Field error,
// body text, etc.). When a designer changes a token, this suite tells
// them whether the change holds AA — no more hand-estimation.
//
// Tied to BESLUTNING 4 in docs/analyses/2026-05-01-fase-3a-wcag.md.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseOklch, type OklchColor } from './contrast';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = resolve(__dirname, 'tokens.css');
const TOKENS_SOURCE = readFileSync(TOKENS_PATH, 'utf-8');

// Extract a token block delimited by `{ ... }` for a given selector.
// Tokens.css has three blocks of interest: `:root` (light defaults),
// `@media (prefers-color-scheme: dark) :root` (system dark), and
// `[data-theme='light']` / `[data-theme='dark']` explicit overrides.
// We assert against the explicit blocks since those are what the
// product actually serves once ThemeProvider sets the attribute.
function extractBlock(label: string, source: string): string {
  const start = source.indexOf(label);
  if (start === -1) throw new Error(`Cannot find block "${label}" in tokens.css`);
  const open = source.indexOf('{', start);
  if (open === -1) throw new Error(`No opening brace after "${label}"`);
  // Walk to the matching close brace, tracking nesting (the @media
  // dark block contains a nested :root).
  let depth = 1;
  let i = open + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  return source.slice(open + 1, i - 1);
}

function extractToken(name: string, block: string): OklchColor {
  // Match `--name: oklch(...);` allowing whitespace and decimal numbers.
  const re = new RegExp(`--${name}\\s*:\\s*(oklch\\([^;]+\\))\\s*;`);
  const m = block.match(re);
  if (!m || m[1] === undefined) {
    throw new Error(`Token --${name} not found in block`);
  }
  return parseOklch(m[1].trim());
}

const LIGHT_BLOCK = extractBlock("[data-theme='light']", TOKENS_SOURCE);
const DARK_BLOCK = extractBlock("[data-theme='dark']", TOKENS_SOURCE);

const LIGHT = {
  canvas0: extractToken('canvas-0', LIGHT_BLOCK),
  canvas1: extractToken('canvas-1', LIGHT_BLOCK),
  canvas2: extractToken('canvas-2', LIGHT_BLOCK),
  text1: extractToken('text-1', LIGHT_BLOCK),
  text2: extractToken('text-2', LIGHT_BLOCK),
  text3: extractToken('text-3', LIGHT_BLOCK),
  mint: extractToken('mint', LIGHT_BLOCK),
  mintDeep: extractToken('mint-deep', LIGHT_BLOCK),
  coral: extractToken('coral', LIGHT_BLOCK),
  coralDeep: extractToken('coral-deep', LIGHT_BLOCK),
  rose: extractToken('rose', LIGHT_BLOCK),
  roseDeep: extractToken('rose-deep', LIGHT_BLOCK),
  ink: extractToken('ink', LIGHT_BLOCK),
  inkContrast: extractToken('ink-contrast', LIGHT_BLOCK),
};

const DARK = {
  canvas0: extractToken('canvas-0', DARK_BLOCK),
  canvas1: extractToken('canvas-1', DARK_BLOCK),
  text1: extractToken('text-1', DARK_BLOCK),
  text2: extractToken('text-2', DARK_BLOCK),
  text3: extractToken('text-3', DARK_BLOCK),
  mint: extractToken('mint', DARK_BLOCK),
  mintDeep: extractToken('mint-deep', DARK_BLOCK),
  coral: extractToken('coral', DARK_BLOCK),
  coralDeep: extractToken('coral-deep', DARK_BLOCK),
  rose: extractToken('rose', DARK_BLOCK),
  roseDeep: extractToken('rose-deep', DARK_BLOCK),
  ink: extractToken('ink', DARK_BLOCK),
  inkContrast: extractToken('ink-contrast', DARK_BLOCK),
};

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

// Sanity: parseOklch round-trips a known literal accurately.
describe('contrast utility', () => {
  it('parses an OKLCH literal with three components', () => {
    const c = parseOklch('oklch(0.5 0.14 155)');
    expect(c.L).toBeCloseTo(0.5, 5);
    expect(c.C).toBeCloseTo(0.14, 5);
    expect(c.h).toBeCloseTo(155, 5);
    expect(c.alpha).toBe(1);
  });

  it('parses an OKLCH literal with alpha', () => {
    const c = parseOklch('oklch(1 0 0 / 0.72)');
    expect(c.alpha).toBeCloseTo(0.72, 5);
  });

  it('throws for malformed input', () => {
    expect(() => parseOklch('rgb(255 0 0)')).toThrow(/Cannot parse/);
  });

  it('returns a contrast of 1 for identical colors', () => {
    const c = parseOklch('oklch(0.5 0.14 155)');
    expect(contrastRatio(c, c)).toBeCloseTo(1, 5);
  });

  it('returns ~21:1 for pure white over pure black', () => {
    const white = parseOklch('oklch(1 0 0)');
    const black = parseOklch('oklch(0 0 0)');
    // True WCAG ratio between the sRGB extremes is exactly 21.
    // OKLCH conversion introduces a small numerical drift; allow >=20.
    expect(contrastRatio(white, black)).toBeGreaterThan(20);
  });
});

// The body of the audit: every pair the product actually paints.
describe('WCAG AA token contrast — light theme', () => {
  it('text-1 on canvas-0 clears AA Normal (body text default)', () => {
    expect(contrastRatio(LIGHT.text1, LIGHT.canvas0)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('text-2 on canvas-0 clears AA Normal (secondary body text)', () => {
    expect(contrastRatio(LIGHT.text2, LIGHT.canvas0)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('text-3 on canvas-0 clears AA Large (hint and meta text only)', () => {
    // text-3 is documented in BESLUTNING 3 as hint/meta-only.
    expect(contrastRatio(LIGHT.text3, LIGHT.canvas0)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('ink-contrast on mint clears AA Normal (Button primary surface)', () => {
    // BESLUTNING 4: this is the fix that motivated Phase 3A.
    expect(contrastRatio(LIGHT.inkContrast, LIGHT.mint)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('ink-contrast on mint-deep clears AA Normal (Button primary hover)', () => {
    expect(contrastRatio(LIGHT.inkContrast, LIGHT.mintDeep)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('rose-deep on canvas-0 clears AA Normal (Field error text)', () => {
    expect(contrastRatio(LIGHT.roseDeep, LIGHT.canvas0)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('coral-deep on canvas-0 clears AA Normal (Delete-account text)', () => {
    expect(contrastRatio(LIGHT.coralDeep, LIGHT.canvas0)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('ink on canvas-0 clears AAA (high-contrast headings)', () => {
    expect(contrastRatio(LIGHT.ink, LIGHT.canvas0)).toBeGreaterThanOrEqual(7);
  });

  // Regression-anchor: the bare --mint at L=0.58 (pre-fix) failed AA;
  // verify the new L=0.50 fixes it. If a designer reverts to L=0.58
  // for cosmetic reasons, this catches it.
  it('mint lightness is 0.50 (post-WCAG-fix)', () => {
    expect(LIGHT.mint.L).toBeCloseTo(0.5, 2);
  });

  it('mint-deep lightness is 0.38 (post-WCAG-fix)', () => {
    expect(LIGHT.mintDeep.L).toBeCloseTo(0.38, 2);
  });
});

describe('WCAG AA token contrast — dark theme', () => {
  it('text-1 on canvas-0 clears AA Normal (body text default)', () => {
    expect(contrastRatio(DARK.text1, DARK.canvas0)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('text-2 on canvas-0 clears AA Normal (secondary body text)', () => {
    expect(contrastRatio(DARK.text2, DARK.canvas0)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('text-3 on canvas-0 clears AA Large (hint and meta text only)', () => {
    expect(contrastRatio(DARK.text3, DARK.canvas0)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('ink-contrast on mint clears AA Normal (Button primary surface)', () => {
    expect(contrastRatio(DARK.inkContrast, DARK.mint)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('ink-contrast on mint-deep clears AA Normal (Button primary hover)', () => {
    expect(contrastRatio(DARK.inkContrast, DARK.mintDeep)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('rose-deep on canvas-0 clears AA Normal (Field error text)', () => {
    expect(contrastRatio(DARK.roseDeep, DARK.canvas0)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('coral-deep on canvas-0 clears AA Normal (Delete-account text)', () => {
    expect(contrastRatio(DARK.coralDeep, DARK.canvas0)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('ink on canvas-0 clears AAA (high-contrast headings)', () => {
    expect(contrastRatio(DARK.ink, DARK.canvas0)).toBeGreaterThanOrEqual(7);
  });
});
