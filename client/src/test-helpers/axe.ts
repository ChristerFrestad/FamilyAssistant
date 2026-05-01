// jest-axe wrapper for vitest. Centralizes the axe configuration so
// every test file gets the same rule-set and the same level of strictness.
//
// Usage:
//   import { renderAndAxe, expectNoAxeViolations } from '../../test-helpers/axe';
//
//   it('has no a11y violations', async () => {
//     const { container } = render(<MyComponent />);
//     await expectNoAxeViolations(container);
//   });
//
// Rule selection: we run the WCAG 2.0 A, AA and 2.1 AA rule packs that
// axe-core ships out of the box. Best-practice rules (e.g. landmark
// uniqueness when not strictly required by WCAG) are EXCLUDED — they
// are valuable but produce false positives on isolated component
// fragments rendered without a surrounding <main>/<nav>. Test them at
// the screen level instead, where the full landmark structure is
// present.
//
// Color-contrast rule is DISABLED inside jsdom because jsdom does
// not paint pixels and cannot resolve OKLCH values. Contrast is
// verified separately by client/src/app/styles/contrast.test.ts which
// computes ratios mathematically from tokens.css.

import { axe, toHaveNoViolations } from 'jest-axe';
import { expect } from 'vitest';

expect.extend(toHaveNoViolations);

export const AXE_OPTIONS = {
  runOnly: {
    type: 'tag' as const,
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  },
  rules: {
    // jsdom does not compute layout; color-contrast checks need real
    // pixel data. Use contrast.test.ts for this dimension instead.
    'color-contrast': { enabled: false },
    // Landmark rules that fail on component-level renders. Re-enable
    // them at screen-level via per-call options if needed.
    region: { enabled: false },
  },
};

/**
 * Run axe against a DOM subtree and assert zero violations. Wraps the
 * raw axe call so tests do not have to repeat the configuration. The
 * second argument lets a single test override or extend the default
 * options when it needs stricter or looser checks (e.g. enabling
 * `region` on a screen-level test).
 */
export async function expectNoAxeViolations(
  container: Element,
  optionsOverride?: Parameters<typeof axe>[1]
): Promise<void> {
  const options = optionsOverride ?? AXE_OPTIONS;
  const results = await axe(container, options);
  expect(results).toHaveNoViolations();
}
