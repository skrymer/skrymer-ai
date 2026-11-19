import { test } from 'node:test'
import assert from 'node:assert/strict'
import pack from './skrymer-ai.pack.mjs'

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
