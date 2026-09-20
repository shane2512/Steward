import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/dist/**',
      'spikes/**',
      'docs/**',
      'contracts/**',
      'steward-claude-code-specs/**',
      'scripts/fixtures/**',
      'packages/db/drizzle/**',
      'apps/web/components/ui/**',
      '**/*.cjs',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    // `noUncheckedIndexedAccess` makes `calls[0]` possibly-undefined; in an assertion-heavy test a
    // `!` is the readable form and a wrong index fails the test anyway. Product code keeps the rule.
    files: ['**/test/**/*.ts', 'scripts/live/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
