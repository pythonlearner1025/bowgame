/**
 * Enforces the repository's human-readable TypeScript and JavaScript conventions.
 * Generated browser modules are checked through their authored TypeScript sources instead.
 */
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import typescriptEslint from 'typescript-eslint';

const IDENTIFIER_EXCEPTIONS = ['dt', 'id', 'url', 'x', 'y', 'z', 'w', 'i', 'j', 'k'];

const sharedRules = {
  'capitalized-comments': ['warn', 'always', { ignoreConsecutiveComments: true }],
  complexity: ['warn', 12],
  curly: ['error', 'all'],
  eqeqeq: ['error', 'always'],
  'id-length': [
    'error',
    {
      exceptions: IDENTIFIER_EXCEPTIONS,
      min: 2,
      properties: 'never',
    },
  ],
  'max-depth': ['error', 3],
  'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': [
    'warn',
    { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true },
  ],
  'max-params': ['error', 4],
  'max-statements-per-line': ['error', { max: 1 }],
  'no-bitwise': 'warn',
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-implicit-coercion': 'error',
  'no-magic-numbers': [
    'warn',
    {
      ignore: [-1, 0, 1, 2],
      ignoreArrayIndexes: true,
      ignoreDefaultValues: true,
      ignoreEnums: true,
    },
  ],
  'no-multi-assign': 'error',
  'no-nested-ternary': 'error',
  'no-param-reassign': 'error',
  'no-return-assign': 'error',
  'no-sequences': 'error',
  'no-unused-expressions': 'error',
  'no-var': 'error',
  'padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: '*', next: 'return' },
    { blankLine: 'always', prev: '*', next: 'function' },
    { blankLine: 'always', prev: 'function', next: '*' },
  ],
  'prefer-const': 'error',
  'spaced-comment': ['error', 'always', { markers: ['/'] }],
};

export default typescriptEslint.config(
  {
    ignores: [
      'assets/**',
      'dist/**',
      'evidence/**',
      'node_modules/**',
      'scripts/**',
      'test-results/**',
      'worker-configuration.d.ts',
    ],
  },
  eslint.configs.recommended,
  ...typescriptEslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      jsdoc,
    },
    rules: {
      ...sharedRules,
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: ['variable', 'function'],
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'jsdoc/require-description': 'error',
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            ArrowFunctionExpression: false,
            ClassDeclaration: true,
            ClassExpression: true,
            FunctionDeclaration: true,
            FunctionExpression: false,
            MethodDefinition: true,
          },
        },
      ],
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
    },
  },
  {
    files: ['tests/**/*.{js,mjs,ts}'],
    rules: {
      'max-lines-per-function': 'off',
      'no-magic-numbers': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    rules: {
      // JavaScript cannot express TypeScript return annotations; JSDoc remains mandatory.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    files: ['eslint.config.js'],
    rules: {
      'no-magic-numbers': 'off',
    },
  },
  prettier,
);
