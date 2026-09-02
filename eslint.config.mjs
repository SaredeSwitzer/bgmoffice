// Deliberately narrow: this exists to catch bugs that CRASH A PAGE but still compile,
// not to enforce style. It was added after a real one — a link referenced a variable
// declared in a different component in the same file, which is valid syntax, so the
// build passed and the Reminders page died at runtime in production.
//
// Every rule here flags something that is almost certainly a genuine mistake. Nothing
// here is a matter of taste, so a failure should always be worth stopping for.
//
// Run with `npm run lint`. It also runs as part of `npm run build`, which means a
// deploy cannot ship one of these.

import reactHooks from 'eslint-plugin-react-hooks';

const BROWSER = [
  'window', 'document', 'console', 'fetch', 'navigator', 'localStorage', 'sessionStorage',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'alert', 'confirm', 'prompt', 'FormData', 'Blob', 'URL',
  'URLSearchParams', 'File', 'FileReader', 'FileList', 'Image', 'Intl', 'crypto', 'location',
  'history', 'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'AbortController',
  'atob', 'btoa', 'TextDecoder', 'TextEncoder', 'IntersectionObserver', 'ResizeObserver',
  'MutationObserver', 'HTMLElement', 'Node', 'Element', 'DOMParser', 'XMLHttpRequest',
  'WebSocket', 'Notification', 'performance', 'structuredClone', 'queueMicrotask',
  'matchMedia', 'getComputedStyle', 'scrollTo', 'Audio', 'CSS', 'DataTransfer', 'Response',
  'Request', 'Headers', 'AbortSignal', 'ClipboardItem', 'requestIdleCallback',
];

const NODE = [
  'require', 'module', 'exports', 'process', '__dirname', '__filename', 'Buffer', 'console',
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'URL', 'URLSearchParams', 'TextDecoder', 'TextEncoder', 'crypto', 'structuredClone',
  'AbortController', 'Blob', 'performance', 'global', 'Response', 'Request', 'Headers',
];

// Each of these means "this code cannot do what it looks like it does".
const RULES = {
  'no-undef':             'error', // the one that would have caught the Reminders crash
  'no-dupe-keys':         'error',
  'no-dupe-args':         'error',
  'no-dupe-else-if':      'error',
  'no-duplicate-case':    'error',
  'no-unreachable':       'error',
  'no-func-assign':       'error',
  'no-cond-assign':       'error',
  'no-self-compare':      'error',
  'no-unsafe-negation':   'error',
  'no-sparse-arrays':     'error',
  'valid-typeof':         'error',
  'no-obj-calls':         'error',
  'no-import-assign':     'error',
  'no-const-assign':      'error',
  'no-class-assign':      'error',
  'use-isnan':            'error',
  // Reading a const/let before its declaration line throws at render time — it compiles
  // fine and the page comes up blank. That shipped once (a useEffect that used a value
  // declared a few lines below it, My Tasks, 2026-09-02), so it's caught here now.
  'no-use-before-define':  ['error', { functions: false, classes: false, variables: true }],
};

const asGlobals = names => Object.fromEntries(names.map(n => [n, 'readonly']));

export default [
  { ignores: ['**/node_modules/**', 'client/dist/**', 'server/uploads/**'] },

  // Frontend — ES modules with JSX.
  {
    files: ['client/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: asGlobals(BROWSER),
    },
    // The plugin is registered only so the existing
    // `// eslint-disable-next-line react-hooks/exhaustive-deps` comments scattered through
    // the codebase resolve to a real rule. ESLint errors on a disable comment naming a rule
    // it doesn't know about, which would fail the build for no good reason. The rule itself
    // stays off — turning it on is a separate, much noisier decision.
    plugins: { 'react-hooks': reactHooks },
    rules: { ...RULES, 'react-hooks/exhaustive-deps': 'off' },
  },

  // Backend — CommonJS.
  {
    files: ['server/**/*.js', 'api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: asGlobals(NODE),
    },
    rules: RULES,
  },
];
