import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.angular/**',
      '**/node_modules/**',
      '.local/**',
      'vendor/settlemaker/src/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  { languageOptions: { globals: { ...globals.node } } },
  { files: ['client/**'], languageOptions: { globals: { ...globals.browser } } },
  prettier,
);
