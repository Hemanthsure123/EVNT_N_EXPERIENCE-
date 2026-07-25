/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'local-rules'],
  extends: [
    'next/core-web-vitals',
    'plugin:@typescript-eslint/recommended',
    'plugin:storybook/recommended',
    'prettier',
  ],
  ignorePatterns: [
    'node_modules/',
    '.next/',
    'storybook-static/',
    'coverage/',
    'playwright-report/',
    'test-results/',
    'next-env.d.ts',
    'eslint-local-rules/',
    'lib/api/schema.d.ts',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
  },
  overrides: [
    {
      // The design-system enforcement: no raw hex/px in app code.
      files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
      rules: {
        'local-rules/no-raw-values': 'error',
      },
    },
    {
      // Tests / stories may import test utilities freely.
      files: ['**/*.test.{ts,tsx}', '**/*.stories.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
