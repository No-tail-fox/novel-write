// Lint gate (Q-3): only rules that catch real defects, so the gate stays green and meaningful.
// Type errors are tsc's job (three tsconfigs); formatting is not enforced.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**', 'dist/**', 'dist-electron/**', 'dist-renderer/**', 'release/**', 'out/**',
      'vendor/**', '.artifacts/**', '.worktrees/**', '.tmp/**', '.tmp-*/**', '.codex-*/**', 'tmp/**',
      'output/**', 'outputs/**', 'projects/**', 'free-api-router/**', 'services/**/node_modules/**',
      '**/*.min.js', 'public/**', 'resources/**',
      // Browser QA output bundles include third-party runtime code, not maintained sources.
      'tests/qa-history-export-output/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.ts', 'scripts/**/*.{ts,mts}', 'tests/**/*.ts', 'services/**/*.ts'],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 2023, sourceType: 'module' },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'no-debugger': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-unsafe-finally': 'off', // cleanup-error chaining in finally is intentional (html-video-runtime)
      'no-unreachable': 'error',
      'no-compare-neg-zero': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-binary-expression': 'error',
      'no-sparse-arrays': 'error',
      'no-unsafe-negation': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-async-promise-executor': 'error',
      'no-loss-of-precision': 'error',
      'getter-return': 'error',
      'for-direction': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' }, // scripts evaluate browser code in pages; globals are checked by running them
    rules: { ...js.configs.recommended.rules, 'no-undef': 'off', 'no-unsafe-finally': 'off', 'no-unused-vars': 'off', 'no-empty': 'off', 'no-useless-escape': 'off', 'no-control-regex': 'off' },
  },
);
