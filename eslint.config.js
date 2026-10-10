const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['src/renderer/vendor/**', 'node_modules/**', 'dist/**', 'out/**', 'build/**'],
  },
  js.configs.recommended,
  {
    files: ['src/main/**/*.js', 'tools/**/*.js', 'test/**/*.js', 'eslint.config.js', 'playwright.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
  {
    files: ['src/renderer/scripts/state.js'],
    languageOptions: {
      sourceType: 'script',
    },
  },
  {
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];
