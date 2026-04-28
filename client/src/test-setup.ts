// Vitest setup file — runs once before every test suite. We use it
// for two cross-cutting concerns that are awkward to repeat in every
// test file:
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
// Keep this file deliberately small. Anything beyond cross-cutting
// matchers / cleanup belongs next to the component being tested, so
// the reasoning chain stays local.

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
