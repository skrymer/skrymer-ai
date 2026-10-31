/**
 * The nuxt pack's default rule fragment. Each `path`, TDD glob and format glob is relative to
 * a stack root the project config names, so a project states only its roots. `/core:setup`
 * proposes a root wherever `detect` finds a Nuxt config, and enables the `lsp` plugins. A
 * test command matches within one shell command. A prompt rule matches the words of a prompt,
 * whatever the roots. The formatter runs in the root, so the root's own Prettier and ESLint
 * configs apply; a project on another package manager or toolchain replaces it with its
 * stack's own `format`, and likewise `check`, the build and tests the sign-off runs in the root
 * before it spawns any agent, and `test`, one named test, for the sign-off's red-proof recorder.
 */
const prettier = ['pnpm', 'exec', 'prettier', '--write', '--log-level', 'warn']

export default {
  detect: { files: ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'] },
  lsp: ['typescript-lsp@claude-plugins-official'],
  test: ['pnpm', 'exec', 'vitest', 'run', '-t', '{test}'],
  check: [
    ['pnpm', 'lint'],
    ['pnpm', 'typecheck'],
    ['pnpm', 'test'],
  ],
  tdd: {
    files: ['app/**/*.{ts,vue}', 'server/**/*.ts', 'shared/**/*.ts'],
    testCommands: [/\bvitest\b|\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test\b/],
  },
  format: [
    { files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'], run: [prettier, ['pnpm', 'exec', 'eslint', '--fix']] },
    { files: ['**/*.{json,css,md,yml,yaml}'], run: [prettier] },
  ],
  mutation: {
    engine: 'stryker',
    source: ['app/**/*.{ts,vue}', 'server/**/*.ts', 'shared/**/*.ts'],
    targets: (files) => files,
    run: ['pnpm', 'exec', 'stryker', 'run', '--mutate', '{targets}', '--reporters', 'json,clear-text'],
    report: 'reports/mutation/mutation.json',
    mutants: (json) => Object.values(JSON.parse(json).files).reduce((sum, { mutants }) => sum + mutants.length, 0),
    survivors: strykerSurvivors,
    memory: '10G',
    notes: 'skills/frontend-dev/references/stryker.md',
  },
  duplication: {
    tests: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    declaration: /(?<![\w.])(?:it|test)(?:\.\w+(?:\([^)]*\))?)*\s*\(/,
    formats: ['typescript', 'vue'],
    remedy:
      'Use Extract Function: an inline composable when both copies share a file, a shared composable ' +
      'or a component when they do not, and a function in utils/ for pure code. Slide Statements ' +
      'first when the copies are interleaved with other code. A new utils/ export, or a new component, ' +
      'prop or slot, is the exception, since the TDD gate refuses one no test drives: stub it, wrap ' +
      'the copy you will delete in a transient jscpd:ignore pair, drive it red-green from the stub, ' +
      'then replace both copies and drop the pair in the same edit.',
  },
  skills: {
    prompts: [
      {
        id: 'nuxt-test-layer',
        pattern: /\bvitest\b|\brendersuspended\b|\btesting library\b|@nuxt\/test-utils\b|\b(vue|nuxt|component|frontend) tests?\b/i,
        skills: ['nuxt:component-testing', 'core:tdd'],
        why: 'a component test queries and drives the UI the way a user does, one red-green cycle at a time.',
      },
    ],
    files: [
      {
        id: 'vitest-test',
        path: /(?:app|server|shared|test)\/.+\.(?:test|spec)\.[cm]?[jt]s$/,
        skills: ['nuxt:component-testing'],
        why: 'A Vitest test renders through renderSuspended and queries by role, per the testing conventions.',
      },
      {
        id: 'frontend-source',
        path: /(?:app|server|shared)\//,
        skills: ['nuxt:frontend-dev'],
        why: 'Pages, components, composables and server routes follow the playbook’s architecture rules.',
      },
    ],
  },
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
