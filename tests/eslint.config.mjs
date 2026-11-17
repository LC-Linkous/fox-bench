// ESLint for the page, its tests and the Node tools. Run from the repository root: `cd tests && npm run lint`.
// The rule that earned this its place: no-undef (a page check read `opts.clockSet` where the parameter was
// `clockSet`; every network fox in a shell game made validation throw, and no test walked that path).
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['flasher/vendor/**', 'tests/node_modules/**', '_site/**', '**/build/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],      // `catch {}` is how this code says "best effort"
      'no-control-regex': 'off',                             // the REPL and console protocols are control characters
    },
  },
];
