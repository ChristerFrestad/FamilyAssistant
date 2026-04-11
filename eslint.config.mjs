// ESLint v9 flat config
// Uke 1 av ISO-planen: linting aktivert med lempelige regler som baseline.
// Gradvis tightening skjer i senere uker etter hvert som kodebase kureres.

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'backups/**',
      'coverage/**',
      'public/index.html',
      'public/dist/**',
      '.claude/**',
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
];
