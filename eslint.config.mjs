import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default defineConfig([
  globalIgnores(['coverage', 'dist', 'docs']),
  js.configs.recommended,
  stylistic.configs.customize({
    arrowParens: true,
    braceStyle: '1tbs',
    semi: true,
  }),
  {
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@stylistic/operator-linebreak': ['error', 'before'],
      '@stylistic/quote-props': ['error', 'as-needed'],
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'object-shorthand': 'error',
      'prefer-const': 'error',
      'prefer-template': 'error',
      'sort-imports': ['error', { ignoreDeclarationSort: true }],
    },
  },
  {
    files: ['*.js', '*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['*.js'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.mocha,
        Compressor: 'readonly',
        expect: 'readonly',
      },
    },
    rules: {
      'no-new': 'off',
      'no-unused-expressions': 'off',
    },
  },
]);
