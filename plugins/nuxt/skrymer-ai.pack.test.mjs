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
    'app/utils/cart.ts': [
      mutant({ id: '1', line: 14 }),
      mutant({ id: '2', status: 'Killed', line: 15 }),
      mutant({ id: '3', status: 'Timeout', line: 16 }),
    ],
    'app/components/CartLine.vue': [
      mutant({ id: '4', mutatorName: 'ObjectLiteral', replacement: '{}', status: 'NoCoverage', line: 39 }),
      mutant({ id: '5', status: 'CompileError', line: 40 }),
    ],
  })

  // When the survivors are parsed
  const found = survivors(json)

  // Then only the two undetected mutants come back, keyed to their file and starting line
  assert.deepEqual(found, [
    { file: 'app/utils/cart.ts', line: 14, mutator: 'EqualityOperator', replacement: 'a <= b', status: 'Survived' },
    { file: 'app/components/CartLine.vue', line: 39, mutator: 'ObjectLiteral', replacement: '{}', status: 'NoCoverage' },
  ])
})

test('a multi-line replacement is folded onto one line and capped', () => {
  // Given a survivor whose replacement is a block spanning lines, tabs and all
  const body = `{\n\tconst total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0)\n\treturn total\n}`
  const json = report({ 'app/utils/cart.ts': [mutant({ mutatorName: 'BlockStatement', replacement: body })] })

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
  const files = ['app/utils/cart.ts', 'app/components/CartLine.vue']

  // When the targets are computed
  const found = targets(files)

  // Then each file is its own --mutate target
  assert.deepEqual(found, files)
})

test('the Stryker mutant count is every mutant in every file, detected or not', () => {
  // Given a report with mutants of every kind across two files
  const json = report({ 'app/utils/cart.ts': [mutant({}), mutant({ status: 'Killed' })], 'app/pages/index.vue': [mutant({ status: 'CompileError' })] })

  // When the mutants are counted
  const found = pack.mutation.mutants(json)

  // Then all three count
  assert.equal(found, 3)
})
