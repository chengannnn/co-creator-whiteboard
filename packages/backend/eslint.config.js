import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: globals.node,
      parserOptions: {
        ecmaVersion: 2020,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
    },
  },
];
