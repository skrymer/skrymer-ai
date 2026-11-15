import { test } from 'node:test'
import assert from 'node:assert/strict'
import pack from './skrymer-ai.pack.mjs'

const { targets, survivors } = pack.mutation

/** A Stryker `mutation.json` (schema 1) holding [files], each a path mapped to its mutants. */
const report = (files) =>
  JSON.stringify({
    schemaVersion: '1.0',
    thresholds: { high: 80, low: 60 },
    projectRoot: '/work/acme/web',
    files: Object.fromEntries(Object.entries(files).map(([file, mutants]) => [file, { language: 'typescript', source: '', mutants }])),
  })

const mutant = ({ id = '1', mutatorName = 'EqualityOperator', replacement = 'a <= b', status = 'Survived', line = 14 }) => ({
  id,
  mutatorName,
  replacement,
  status,
  static: false,
  coveredBy: [],
  location: { start: { line, column: 3 }, end: { line, column: 9 } },
})

test('Stryker survivors are the mutants no test detected', () => {
  // Given a report with a survivor, an uncovered mutant, and mutants that were killed, timed out or never compiled
  const json = report({
    'src/utils/cart.ts': [
      mutant({ id: '1', line: 14 }),
      mutant({ id: '2', status: 'Killed', line: 15 }),
      mutant({ id: '3', status: 'Timeout', line: 16 }),
    ],
    'src/components/CartLine.tsx': [
      mutant({ id: '4', mutatorName: 'ObjectLiteral', replacement: '{}', status: 'NoCoverage', line: 39 }),
      mutant({ id: '5', status: 'CompileError', line: 40 }),
    ],
  })

  // When the survivors are parsed
  const found = survivors(json)

  // Then only the two undetected mutants come back, keyed to their file and starting line
  assert.deepEqual(found, [
    { file: 'src/utils/cart.ts', line: 14, mutator: 'EqualityOperator', replacement: 'a <= b', status: 'Survived' },
    { file: 'src/components/CartLine.tsx', line: 39, mutator: 'ObjectLiteral', replacement: '{}', status: 'NoCoverage' },
  ])
})

test('a multi-line replacement is folded onto one line and capped', () => {
  // Given a survivor whose replacement is a block spanning lines, tabs and all
  const body = `{\n\tconst total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0)\n\treturn total\n}`
  const json = report({ 'src/utils/cart.ts': [mutant({ mutatorName: 'BlockStatement', replacement: body })] })

  // When the survivors are parsed
  const [found] = survivors(json)

  // Then the replacement has no line breaks or tabs, and stops at 80 characters with an ellipsis
  assert.doesNotMatch(found.replacement, /[\n\t]/)
  assert.equal(found.replacement.length, 80)
  assert.ok(found.replacement.startsWith('{ const total = lines.reduce('))
  assert.ok(found.replacement.endsWith('…'))
})

test('Stryker targets are the scoped files themselves', () => {
  // Given two scoped files
  const files = ['src/utils/cart.ts', 'src/components/CartLine.tsx']

  // When the targets are computed
  const found = targets(files)

  // Then each file is its own --mutate target
  assert.deepEqual(found, files)
})

test('the Stryker mutant count is every mutant in every file, detected or not', () => {
  // Given a report with mutants of every kind across two files
  const json = report({ 'src/utils/cart.ts': [mutant({}), mutant({ status: 'Killed' })], 'src/pages/Home.tsx': [mutant({ status: 'CompileError' })] })

  // When the mutants are counted
  const found = pack.mutation.mutants(json)

  // Then all three count
  assert.equal(found, 3)
})

/** A `read` over a root holding [files], a map of root-relative path to content. */
const rootOf = (files) => (file) => files[file] ?? null

test('a root on ESLint flat config lints its staged files', () => {
  // Given a root with an eslint.config.js and no lint-staged
  const read = rootOf({ 'eslint.config.js': 'export default []', 'package.json': '{}' })

  // When its pre-commit lint is computed
  const found = pack.lint(read)

  // Then ESLint runs on the staged files, quiet about the ones it ignores
  assert.deepEqual(found, [['pnpm', 'exec', 'eslint', '--no-warn-ignored', '{staged}']])
})

test('a root on a legacy .eslintrc runs its own lint script, since that ESLint has no --no-warn-ignored', () => {
  // Given a root with an .eslintrc.json and no flat config or lint-staged
  const read = rootOf({ '.eslintrc.json': '{}', 'package.json': '{}' })

  // When its pre-commit lint is computed
  const found = pack.lint(read)

  // Then the root's lint script runs instead
  assert.deepEqual(found, [['pnpm', 'lint']])
})

test('a root with lint-staged runs it, whatever its ESLint config', () => {
  // Given a root whose package.json configures lint-staged
  const read = rootOf({ 'package.json': JSON.stringify({ 'lint-staged': { '*.tsx': 'eslint --fix' } }) })

  // When its pre-commit lint is computed
  const found = pack.lint(read)

  // Then lint-staged runs
  assert.deepEqual(found, [['pnpm', 'exec', 'lint-staged']])
})
