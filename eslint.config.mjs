import js from '@eslint/js';
import html from 'eslint-plugin-html';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'build/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', '.data/**', '.wrangler/**'] },
  js.configs.recommended,
  {
    // The game's inline <script> (classic script, browser globals only).
    files: ['**/*.html'],
    plugins: { html },
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
    rules: { eqeqeq: 'error', 'no-var': 'error', 'prefer-const': 'error', 'no-implicit-globals': 'error' },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: { eqeqeq: 'error', 'prefer-const': 'error' },
  },
  {
    // Portal modules run in the browser (ES modules, absolute /shared/ imports).
    files: ['portal/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Shared + server code runs in browsers, Workers and Node: Web-standard globals only.
    files: ['shared/**/*.mjs', 'server/**/*.mjs', 'functions/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser, ...globals.serviceworker } },
    rules: { eqeqeq: 'error', 'prefer-const': 'error' },
  },
  {
    // The SDK is a classic script injected into games.
    files: ['sdk/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
    rules: { eqeqeq: 'error', 'prefer-const': 'error', 'no-var': 'error' },
  },
  {
    files: ['tests/e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
