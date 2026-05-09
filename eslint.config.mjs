// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.js', '**/*.mjs', 'prisma/migrations/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
      },
      globals: {
        node: true,
        es2023: true,
      },
    },
    plugins: {
      prettier: prettierPlugin,
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      // Prettier
      'prettier/prettier': 'error',

      // TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/interface-name-prefix': 'off',

      // Unused imports / vars (replaces base rule)
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      // Imports
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'object',
            'type',
          ],
          pathGroups: [
            { pattern: '@/**', group: 'internal', position: 'before' },
            { pattern: '@common/**', group: 'internal', position: 'before' },
            { pattern: '@config/**', group: 'internal', position: 'before' },
            { pattern: '@infrastructure/**', group: 'internal', position: 'before' },
            { pattern: '@modules/**', group: 'internal', position: 'before' },
            { pattern: '@jobs/**', group: 'internal', position: 'before' },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-unresolved': 'off',

      // General
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-unused-vars': 'off',
    },
  },
  prettierConfig,
);
