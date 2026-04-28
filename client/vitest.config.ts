// Vitest configuration for the v2 frontend.
//
// We extend the existing Vite config so React, the enforce-isolation
// plugin, and the alias resolution all carry into tests unchanged. A
// drift between dev/build behavior and test behavior would be the
// most expensive class of bug, so the rule is: change vite.config.ts
// once, both surfaces follow.
//
// Test environment is jsdom: a Node-based DOM implementation that
// renders React components into a synthetic document. happy-dom would
// be lighter, but jsdom is the de-facto standard for React Testing
// Library and matches what most React-component examples assume.
//
// `globals: false` keeps describe/it/expect out of the global
// namespace. Tests must `import { test, expect } from 'vitest'`
// explicitly. This trades a few characters of boilerplate for full
// IDE-aware imports, no global type pollution, and no surprise when
// a tooling upgrade renames a global.
//
// Default coverage uses v8 (the same engine as Node's built-in
// coverage). Reports go under `coverage/client/` so they sit beside
// the existing `coverage/` directory used by the server suite without
// stepping on it.

import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: false,
      // Loaded once before any test file. The setup imports
      // @testing-library/jest-dom which extends Vitest's `expect`
      // with DOM-specific matchers (toBeInTheDocument, toHaveAttribute,
      // toHaveTextContent, ...). Without this file, those matchers
      // throw "is not a function" inside tests.
      setupFiles: [path.resolve(__dirname, 'src/test-setup.ts')],
      // Where Vitest looks for tests. Co-located patterns (sibling
      // *.test.tsx next to source) and a centralized `__tests__/`
      // folder are both supported. The actual placement is decided
      // per-component in Phase 1b.3 — this glob covers either choice.
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/*.{test,spec}.{ts,tsx}'],
      // The dev-only preview tree is product code we do not want
      // Vitest to crawl as a test source.
      exclude: ['node_modules', 'dist', '../public/v2'],
      coverage: {
        provider: 'v8',
        reportsDirectory: path.resolve(__dirname, '..', 'coverage', 'client'),
        reporter: ['text', 'html', 'lcov'],
        // Only measure shippable component source. The dev-preview
        // tree, Vite plugins, build artifacts, and the placeholder
        // App.tsx (which has no tests until routing lands) all stay
        // out of the report so coverage numbers reflect real app
        // surface area rather than scaffolding.
        include: ['src/app/**/*.{ts,tsx}'],
        exclude: [
          'src/app/**/*.d.ts',
          'src/app/**/*.test.{ts,tsx}',
          'src/app/App.tsx',
          'src/main.tsx',
        ],
      },
    },
  })
);
