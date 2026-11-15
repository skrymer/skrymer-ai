/**
 * The react pack's default rule fragment. Each `path`, TDD glob and format glob is relative to
 * a stack root the project config names, so a project states only its roots. `/core:setup`
 * proposes a root wherever `detect` finds a package.json depending on React (in its
 * dependencies or devDependencies, not an override or a peer), and enables the `lsp` plugins.
 * A test command matches within one shell command. A prompt rule matches the words of a
 * prompt, whatever the roots. The formatter runs in the root, so the root's own
 * Prettier and ESLint configs apply; a project on another package manager or toolchain replaces
 * it with its stack's own `format`, and likewise `check`, the build and tests the sign-off and CI
 * run in the root, `lint`, what the pre-commit hook runs when the root has staged files, and
 * `test`, one named test, for the sign-off's red-proof recorder. `ci` gives the GitHub Actions
 * steps a CI job takes in the root before its `check`: pnpm as the root's `packageManager` pins
 * it, Node as its `.nvmrc` names it, and the install.
 */
const prettier = ['pnpm', 'exec', 'prettier', '--write', '--log-level', 'warn']

export default {
  detect: { files: ['package.json'], contains: /"(?:dependencies|devDependencies)"\s*:\s*\{[^}]*"react"\s*:/ },
  lsp: ['typescript-lsp@claude-plugins-official'],
  test: ['pnpm', 'exec', 'vitest', 'run', '-t', '{test}'],
  check: [
    ['pnpm', 'lint'],
    ['pnpm', 'build'],
    ['pnpm', 'test'],
  ],
  lint: (read) => (usesLintStaged(read) ? [['pnpm', 'exec', 'lint-staged']] : [['pnpm', 'exec', 'eslint', '--no-warn-ignored', '{staged}']]),
  ci: (root, read) => {
    const at = (file) => (root ? `${root}/${file}` : file)
    const pinned = /^pnpm@/.test(json(read('package.json'))?.packageManager ?? '')
    const node = read('.nvmrc') === null ? { 'node-version': 'lts/*' } : { 'node-version-file': at('.nvmrc') }
    const lockfile = read('pnpm-lock.yaml') === null ? {} : { 'cache-dependency-path': at('pnpm-lock.yaml') }
    return [
      { uses: 'pnpm/action-setup@v4', with: pinned ? { package_json_file: at('package.json') } : { version: 10 } },
      { uses: 'actions/setup-node@v4', with: { ...node, cache: 'pnpm', ...lockfile } },
      { run: 'pnpm install --frozen-lockfile' },
    ]
  },
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
    targets: (files) => files,
    run: ['pnpm', 'exec', 'stryker', 'run', '--mutate', '{targets}', '--reporters', 'json,clear-text'],
    report: 'reports/mutation/mutation.json',
    mutants: (json) => Object.values(JSON.parse(json).files).reduce((sum, { mutants }) => sum + mutants.length, 0),
    survivors: strykerSurvivors,
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

const LINT_STAGED_CONFIGS = ['.lintstagedrc', '.lintstagedrc.json', '.lintstagedrc.yaml', '.lintstagedrc.yml', '.lintstagedrc.mjs', '.lintstagedrc.cjs', '.lintstagedrc.js', 'lint-staged.config.js', 'lint-staged.config.mjs', 'lint-staged.config.cjs', 'lint-staged.config.ts']

/** Whether the root [read] reads from configures lint-staged, in its package.json or a config file of its own. */
function usesLintStaged(read) {
  if (LINT_STAGED_CONFIGS.some((file) => read(file) !== null)) return true
  return json(read('package.json'))?.['lint-staged'] !== undefined
}

/** [text] parsed as JSON, or null when there is none or it doesn't parse. */
function json(text) {
  try {
    return text === null ? null : JSON.parse(text)
  } catch {
    return null
  }
}

/** Stryker's statuses for a mutant no test detected; Timeout counts as a kill, CompileError as invalid. */
const UNDETECTED = new Set(['Survived', 'NoCoverage'])
const REPLACEMENT_CAP = 80

/**
 * Every mutant in a Stryker `mutation.json` [json] that no test detected, keyed to the report's
 * file (relative to the stack root, where Stryker runs) and starting line. A replacement is
 * folded onto one line and capped, so it fits one row of the survivors file.
 */
function strykerSurvivors(json) {
  return Object.entries(JSON.parse(json).files).flatMap(([file, { mutants }]) =>
    mutants
      .filter(({ status }) => UNDETECTED.has(status))
      .map(({ location, mutatorName, replacement = '', status }) => ({
        file,
        line: location.start.line,
        mutator: mutatorName,
        replacement: oneLine(replacement),
        status,
      }))
  )
}

function oneLine(text) {
  const folded = text.replace(/\s+/g, ' ').trim()
  return folded.length > REPLACEMENT_CAP ? `${folded.slice(0, REPLACEMENT_CAP - 1)}…` : folded
}
