import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
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
