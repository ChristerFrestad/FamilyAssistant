// Vitest setup file — runs once before every test suite. We use it
// only to extend Vitest's `expect` with the DOM-aware matchers from
// @testing-library/jest-dom (e.g. toBeInTheDocument, toHaveAttribute,
// toHaveTextContent). Despite the package name, jest-dom v6 shipped
// first-class Vitest support; the import has the same effect with
// either runner.
//
// Keep this file deliberately small. Anything else that looks like
// "global test setup" should live in the relevant test file or a
// helper next to the component, so the reasoning chain stays local.

import '@testing-library/jest-dom/vitest';
