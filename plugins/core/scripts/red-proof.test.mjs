import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git, gitProject, runScript } from './git-fixture.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'red-proof.mjs')

const CART = 'export const total = (a, b) => a + b\n'

/** A project with a nuxt root whose one-test command is Node's runner, holding a cart and its test. */
function project() {
  const dir = gitProject({
    '.claude/skrymer-ai.config.mjs': "export default { stacks: { nuxt: { roots: ['web'], test: ['node', '--test', '--test-name-pattern', '{test}'] } } }\n",
    'web/cart.mjs': CART,
    'web/cart.test.mjs': "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from './cart.mjs'\n\ntest('a cart adds two prices', () => assert.equal(total(1, 2), 3))\n",
  })
  return realpathSync(dir)
}

const log = (dir, label) => join(dir, '.git', 'skrymer-ai', 'red', `${label}.log`)

test('a test that fails against the mutant on a copy is recorded as the red, and the source is left alone', () => {
  // Given a cart whose sum a test pins
  const dir = project()

  // When the sum is mutated to a difference and the test is run against it
  const { status, stdout } = runScript(SCRIPT, dir, ['CR-1', '--file', 'web/cart.mjs', '--find', 'a + b', '--replace', 'a - b', '--test', 'a cart adds two prices'])

  // Then the red is recorded with the FIXED cell that cites it, and the source is unchanged
  assert.equal(status, 0, stdout)
  assert.equal(stdout, `red: "a cart adds two prices" fails against the mutant.\nFIXED: a cart adds two prices — red ${log(dir, 'CR-1')}\n`)
  const recorded = readFileSync(log(dir, 'CR-1'), 'utf8')
  assert.match(recorded, new RegExp(`^HEAD: ${git(dir, 'rev-parse', 'HEAD')}\\n`))
  assert.match(recorded, /\nmutation: web\/cart\.mjs: "a \+ b" → "a - b"\n/)
  assert.match(recorded, /\n\$ node --test --test-name-pattern a cart adds two prices\n/)
  assert.match(recorded, /\nexit: 1\n$/)
  assert.equal(readFileSync(join(dir, 'web', 'cart.mjs'), 'utf8'), CART)
  assert.equal(git(dir, 'status', '--short'), '')
})

test('a test that still passes with the mutation applied is no red, and the run fails', () => {
  // Given a cart whose test doesn't reach a third argument
  const dir = project()

  // When a mutation the test can't see is applied
  const { status, stdout } = runScript(SCRIPT, dir, ['CR-2', '--file', 'web/cart.mjs', '--find', '(a, b)', '--replace', '(a, b, c)', '--test', 'a cart adds two prices'])

  // Then it fails, saying the test doesn't pin the fix, and the log shows the pass
  assert.equal(status, 1)
  assert.equal(stdout, `STOP: "a cart adds two prices" passes with the mutation applied, so it doesn't pin the fix. Log: ${log(dir, 'CR-2')}\n`)
  assert.match(readFileSync(log(dir, 'CR-2'), 'utf8'), /\nexit: 0\n$/)
})

test('a mutation whose text is not in the file exactly once stops before anything runs', () => {
  // Given a cart
  const dir = project()

  // When the text to replace is absent
  const { status, stdout } = runScript(SCRIPT, dir, ['CR-3', '--file', 'web/cart.mjs', '--find', 'a * b', '--replace', 'a / b', '--test', 'a cart adds two prices'])

  // Then it stops naming the problem, and records nothing
  assert.deepEqual([status, stdout], [1, 'STOP: "a * b" is in web/cart.mjs 0 times; a mutation replaces text that is there exactly once.\n'])
  assert.equal(existsSync(log(dir, 'CR-3')), false)
})
