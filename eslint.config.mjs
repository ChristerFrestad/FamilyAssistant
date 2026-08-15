// ESLint v9 flat config
// Uke 1 av ISO-planen: linting aktivert med lempelige regler som baseline.
// Gradvis tightening skjer i senere uker etter hvert som kodebase kureres.

import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'backups/**',
      'coverage/**',
      'public/index.html',
      'public/dist/**',
      'public/v2/**',
      'public/www/**',
      'marketing/**',
      '.claude/**',
      'db-*.js',
    ],
  },

  js.configs.recommended,

  // Backend (server/, scripts/) - CommonJS, Node 20+
  {
    files: ['server/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'prefer-const': 'warn',
      'no-var': 'warn',
      eqeqeq: ['warn', 'smart'],
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
      'no-prototype-builtins': 'warn',
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-func-assign': 'error',
      'no-redeclare': 'error',
      'valid-typeof': 'error',
    },
  },

  // Tester - node:test
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'prefer-const': 'warn',
      'no-control-regex': 'off',
      'no-regex-spaces': 'off',
      'no-useless-escape': 'warn',
    },
  },

  // Service worker
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
    },
  },

  // Frontend v2 — TypeScript + React under client/src/. Phase 1b.1.5
  // commit 2 added this block after Phase 1b.1 surfaced that
  // client/src/**/*.{ts,tsx} were silently ignored by ESLint (no
  // matching files-pattern existed). The TypeScript parser handles
  // .ts/.tsx syntax, the recommended set from @typescript-eslint
  // catches the usual TS pitfalls, and react-hooks rules guard against
  // hook-order and stale-closure mistakes. The next commit adds
  // no-restricted-imports to enforce the app/dev boundary in lint.
  {
    files: ['client/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      // Browser globals for app code (window, document, fetch, ...).
      // Node globals would be wrong here — client code runs in the
      // browser. Build-time TS files (vite.config.ts, vite-plugins/*)
      // live outside client/src/ and are validated by typecheck:client
      // via tsconfig include, not by this lint block.
      globals: { ...globals.browser },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      // Apply @typescript-eslint's recommended set as the baseline.
      ...tsPlugin.configs.recommended.rules,
      // React hooks safety. rules-of-hooks errors loud; exhaustive-deps
      // warns so a missing dep does not block CI but still nags.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Match the server-side convention for unused-var ignores so a
      // leading underscore signals intentional non-use everywhere.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // TypeScript already validates symbol resolution with full type
      // info, so ESLint's core no-undef double-checks the same thing
      // less reliably (e.g. it flags TS-only globals like the JSX
      // namespace as undefined). The @typescript-eslint maintainers
      // recommend disabling no-undef for .ts/.tsx files. tsc keeps the
      // safety net in npm run typecheck:client.
      'no-undef': 'off',
    },
  },

  // Architectural rule: app/ may NOT import from dev/. The Vite plugin
  // in client/vite-plugins/enforce-isolation.ts enforces the same
  // boundary at build time; this lint block fires earlier — in the
  // editor, on save, and in `npm run lint` — so violations surface
  // before the developer ever runs `vite build`. Scoped to
  // client/src/app/** only so files under client/src/dev/ remain
  // free to import FROM app/ (a preview page for `Button` should
  // obviously import the real Button).
  //
  // See client/src/dev/README.md and AGENTS.md DEL 7.7 for the
  // boundary's rationale.
  {
    files: ['client/src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/dev/**', '../dev/*', './dev/*', '*/dev/*'],
              message:
                'app/ kan ikke importere fra dev/. Se client/src/dev/README.md for begrunnelse.',
            },
          ],
        },
      ],
    },
  },
];
