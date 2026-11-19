/**
 * The react pack's default rule fragment. Each `path`, TDD glob and format glob is relative to
 * a stack root the project config names, so a project states only its roots. `/core:setup`
 * proposes a root wherever `detect` finds a package.json depending on React (in its
 * dependencies or devDependencies, not an override or a peer), and enables the `lsp` plugins.
 * A test command matches within one shell command. A prompt rule matches the words of a
 * prompt, whatever the roots. The formatter runs in the root, so the root's own Prettier and ESLint
 * configs apply. Its commands, like `check` (the build and tests the sign-off and CI run in the
 * root), `lint` (what the pre-commit hook runs when the root has staged files) and `test` (one
 * named test, for the sign-off's red-proof recorder), are written for pnpm: the `node` toolchain
 * runs them through the root's own package manager, gives a CI job its setup steps, and runs
 * lint-staged at pre-commit when the root configures it. A stack's own `format`, `check`,
 * `lint` or `test` replaces the pack's and runs as written.
 */
const prettier = ['pnpm', 'exec', 'prettier', '--write', '--log-level', 'warn']

export default {
  detect: { files: ['package.json'], contains: /"(?:dependencies|devDependencies)"\s*:\s*\{[^}]*"react"\s*:/ },
  lsp: ['typescript-lsp@claude-plugins-official'],
  toolchain: 'node',
  test: ['pnpm', 'exec', 'vitest', 'run', '-t', '{test}'],
  check: [
    ['pnpm', 'lint'],
    ['pnpm', 'build'],
    ['pnpm', 'test'],
  ],
  lint: (read) => (usesFlatConfig(read) ? [['pnpm', 'exec', 'eslint', '--no-warn-ignored', '{staged}']] : [['pnpm', 'lint']]),
  tdd: {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    testCommands: [/\bvitest\b|\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test\b/],
  },
  format: [
    { files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'], run: [prettier, ['pnpm', 'exec', 'eslint', '--fix']] },
    { files: ['**/*.{json,css,md,yml,yaml}'], run: [prettier] },
  ],
  mutation: {
    engine: 'stryker',
    source: ['src/**/*.{ts,tsx,js,jsx}'],
    run: ['pnpm', 'exec', 'stryker', 'run', '--mutate', '{targets}', '--reporters', 'json,clear-text'],
    report: 'reports/mutation/mutation.json',
    memory: '10G',
    notes: 'skills/frontend-dev/references/stryker.md',
  },
  duplication: {
    tests: ['**/*.{test,spec}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    declaration: /(?<![\w.])(?:it|test)(?:\.\w+(?:\([^)]*\))?)*\s*\(/,
    formats: ['javascript', 'typescript', 'jsx', 'tsx'],
    remedy:
      'Use Extract Function: a custom hook in the same file when both copies share one, a shared hook ' +
      'or a component when they do not, and a plain function in src/utils/ for pure code. Slide ' +
      'Statements first when the copies are interleaved with other code. A new src/utils/ export, or a ' +
      'new component or prop, is the exception, since the TDD gate refuses one no test drives: stub it, ' +
      'wrap the copy you will delete in a transient jscpd:ignore pair, drive it red-green from the stub, ' +
      'then replace both copies and drop the pair in the same edit.',
  },
  skills: {
    prompts: [
      {
        id: 'react-test-layer',
        pattern: /\bvitest\b|\btesting library\b|@testing-library\/react\b|\b(react|component|frontend) tests?\b/i,
        skills: ['react:component-testing', 'core:tdd'],
        why: 'a component test queries and drives the UI the way a user does, one red-green cycle at a time.',
      },
    ],
    files: [
      {
        id: 'react-test',
        path: /(?:src|test)\/.+\.(?:test|spec)\.[cm]?[jt]sx?$/,
        skills: ['react:component-testing'],
        why: 'A Vitest test renders with Testing Library and queries by role, per the testing conventions.',
      },
      {
        id: 'react-source',
        path: /src\//,
        skills: ['react:frontend-dev'],
        why: 'Components, hooks and utils follow the playbook’s architecture rules.',
      },
    ],
  },
}

const FLAT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts']

/**
 * Whether the root [read] reads from is on ESLint flat config. A legacy `.eslintrc` ESLint has no
 * `--no-warn-ignored` and would lint every staged file, package.json included, so it runs the
 * root's own lint script instead.
 */
function usesFlatConfig(read) {
  return FLAT_CONFIGS.some((file) => read(file) !== null)
}
