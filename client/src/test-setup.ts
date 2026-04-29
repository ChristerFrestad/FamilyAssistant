// Vitest setup file — runs once before every test suite. We use it
// for three cross-cutting concerns that are awkward to repeat in
// every test file:
//
//   1. Extend Vitest's `expect` with the DOM-aware matchers from
//      @testing-library/jest-dom (toBeInTheDocument, toHaveAttribute,
//      toHaveTextContent, ...). Despite the package name, jest-dom
//      v6 shipped first-class Vitest support; the side-effect import
//      has the same effect with either runner.
//
//   2. Register the React Testing Library cleanup hook so each test
//      starts with an empty DOM. RTL exposes `cleanup()` which
//      unmounts every component the previous test rendered. When
//      `globals: true` is configured, RTL's `index` module wires
//      this into `afterEach` automatically by detecting the global
//      `afterEach` function. With `globals: false` (our choice for
//      explicit imports and clean type surfaces), no global
//      `afterEach` exists at module-load time, so the hook never
//      registers and DOM nodes leak between tests — `getByTestId`
//      then sees N copies and throws "found multiple elements".
//      Wiring `cleanup` here restores the expected per-test
//      isolation under our explicit-imports config.
//
//   3. Initialize i18n with the production resource bundles + the
//      Norwegian default. Components that call useTranslation()
//      otherwise return the bare translation key (e.g.
//      "actions.close") instead of the resolved Norwegian text
//      ("Lukk"), and tests that assert on rendered text fail.
//      Importing the side-effect-style config wires i18next on the
//      module graph the same way main.tsx does in production, so
//      tests run against the real resource bundles rather than a
//      mock — keeping production and test in lock-step.
//
// Keep this file deliberately small. Anything beyond cross-cutting
// matchers / cleanup / i18n init belongs next to the component
// being tested, so the reasoning chain stays local.

import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import i18n from './app/i18n/config';

// jsdom ships with navigator.language='en-US', so the i18next
// language-detector defaults to English in tests. Force Norwegian
// before every test so component assertions match the pilot's
// Norwegian-by-default behavior. Tests that need to verify the
// English bundle can call i18n.changeLanguage('en') inside the
// individual test and reset before the next one runs.
beforeEach(() => {
  i18n.changeLanguage('no');
});

afterEach(() => {
  cleanup();
});
