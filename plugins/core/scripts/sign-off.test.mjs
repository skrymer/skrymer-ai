import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitProject, runScript } from './git-fixture.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'sign-off.mjs')

const configOf = (body) => `import { defineConfig } from 'skrymer-ai'\n\nexport default defineConfig(${body})\n`

/** A check command that records it ran in the root, then exits with [code] after printing [said]. */
const checkThat = (name, code = 0, said = `${name} ok`) => ['node', '-e', `require('fs').writeFileSync('${name}.ran', ''); console.log(${JSON.stringify(said)}); process.exit(${code})`]

/** kotlin-spring under api, nuxt under web and web-e2e under e2e, with [signOff] and each check given by [checks]. */
function project(branch, { signOff, api = [checkThat('api-build')], web = [checkThat('web-lint'), checkThat('web-test')] } = {}) {
  const stacks = `{ 'kotlin-spring': { roots: ['api'], check: ${JSON.stringify(api)} }, nuxt: { roots: ['web'], check: ${JSON.stringify(web)} }, 'web-e2e': { roots: ['e2e'] } }`
  return gitProject(
    {
      '.claude/skrymer-ai.config.mjs': configOf(`{ stacks: ${stacks}${signOff ? `, signOff: ${signOff}` : ''} }`),
      '.gitignore': '*.ran\n',
      'api/build.gradle.kts': '',
      'api/src/main/kotlin/acme/Order.kt': 'package acme\n\nclass Order\n',
      'web/nuxt.config.ts': '',
      'web/app/utils/cart.ts': 'export const total = 0\n',
      'e2e/playwright.config.ts': '',
    },
    branch
  )
}

const KOTLIN_CHANGE = { 'api/src/main/kotlin/acme/Order.kt': 'package acme\n\nclass Order(val id: Int)\n' }

test('the plan lists the gates a config selects in core’s order, whatever order the config lists them in', () => {
  // Given a config selecting verify, check-adrs and simplify, in that order
  const dir = project(KOTLIN_CHANGE, { signOff: `{ gates: ['verify', 'check-adrs', 'simplify'] }` })

  // When the plan runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then exactly those gates are numbered in core's order, and the rest are named as not selected
  assert.equal(status, 0, out)
  const gates = [...out.matchAll(/^ {2}\d\. (\S+)/gm)].map((match) => match[1])
  assert.deepEqual(gates, ['simplify', 'check-adrs', 'verify'])
  assert.match(out, /^ {2}not selected: mutation, code-review$/m)
})

test('the plan names the fixed core, which runs whatever gates are selected', () => {
  // Given a config selecting a single gate
  const dir = project(KOTLIN_CHANGE, { signOff: `{ gates: ['simplify'] }` })

  // When the plan runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then the adversary, acceptance ledger, resolutions pass and retro are still named
  assert.equal(status, 0, out)
  assert.match(out, /^fixed core, in every sign-off: adversary, acceptance ledger, resolutions pass, retro$/m)
})

test('the plan names each engine gate’s stacks, from the enabled packs that provide its engine', () => {
  // Given no signOff, so every gate whose engine is available runs
  const dir = project(KOTLIN_CHANGE)

  // When the plan runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then mutation runs per stack with a mutation engine, and verify per stack with a verify engine
  assert.equal(status, 0, out)
  assert.match(out, /^ {2}2\. mutation {6}kotlin-spring \(api\), nuxt \(web\)$/m)
  assert.match(out, /^ {2}5\. verify {8}web-e2e \(e2e\)$/m)
})

test('the plan names the check each touched stack runs before any agent, and the untouched ones it skips', () => {
  // Given a branch changing Kotlin source only
  const dir = project(KOTLIN_CHANGE)

  // When the plan runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then kotlin-spring's check is named and nuxt is skipped as untouched
  assert.equal(status, 0, out)
  assert.match(out, /^ {2}kotlin-spring \(api\): node -e /m)
  assert.match(out, /^ {2}nuxt \(web\): SKIP — the branch changed nothing under web$/m)
  assert.match(out, /^ {2}run: node \S*sign-off\.mjs check$/m)
})

test('check runs each touched stack’s commands in its root and passes when they do', () => {
  // Given a branch changing a Kotlin file and a Nuxt file
  const dir = project({ ...KOTLIN_CHANGE, 'web/app/utils/cart.ts': 'export const total = 1\n' })

  // When the check runs
  const { status, out } = runScript(SCRIPT, dir, ['check'])

  // Then every command ran in its stack's root, and the check passes
  assert.equal(status, 0, out)
  for (const ran of ['api/api-build.ran', 'web/web-lint.ran', 'web/web-test.ran']) assert.ok(existsSync(join(dir, ran)), `${ran} should exist`)
  assert.match(out, /^kotlin-spring \(api\): passed$/m)
  assert.match(out, /^nuxt \(web\): passed$/m)
})

test('check leaves a stack the branch did not touch alone', () => {
  // Given a branch changing Kotlin source only
  const dir = project(KOTLIN_CHANGE)

  // When the check runs
  const { status, out } = runScript(SCRIPT, dir, ['check'])

  // Then nuxt's commands never ran
  assert.equal(status, 0, out)
  assert.ok(!existsSync(join(dir, 'web/web-lint.ran')))
})

test('a failing check stops the sign-off, showing the failure and keeping the whole output in a log', () => {
  // Given a nuxt lint that fails, ahead of its tests
  const dir = project({ 'web/app/utils/cart.ts': 'export const total = 1\n' }, { web: [checkThat('web-lint', 2, 'cart.ts: 1 problem'), checkThat('web-test')] })

  // When the check runs
  const { status, out } = runScript(SCRIPT, dir, ['check'])

  // Then it stops before the stack's later commands, quoting the failure and naming the log
  assert.equal(status, 1)
  assert.ok(!existsSync(join(dir, 'web/web-test.ran')), 'the tests should not run after a failed lint')
  assert.match(out, /^nuxt \(web\): FAILED, exit 2: node -e /m)
  assert.match(out, /^ {4}cart\.ts: 1 problem$/m)
  const log = /log: (\S+)/.exec(out)?.[1]
  assert.match(readFileSync(log, 'utf8'), /cart\.ts: 1 problem/)
  assert.match(out, /^STOP: the build fails for nuxt \(web\)\. Fix it before the sign-off spawns any agent\.$/m)
})

test('a config with errors stops the plan, naming each error', () => {
  // Given a config selecting a gate core has no such name for
  const dir = project(KOTLIN_CHANGE, { signOff: `{ gates: ['lint'] }` })

  // When the plan runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then it stops with the config's error naming the valid gates
  assert.equal(status, 1)
  assert.match(out, /^ {2}signOff\.gates: there is no gate "lint"\. Gates: simplify, mutation, code-review, check-adrs, verify\.$/m)
})

test('an engine gate no enabled pack provides stops the plan, naming the fix', () => {
  // Given a config selecting verify while enabling only kotlin-spring, which brings no verify engine
  const dir = gitProject(
    {
      '.claude/skrymer-ai.config.mjs': configOf(`{ stacks: { 'kotlin-spring': { roots: ['api'] } }, signOff: { gates: ['mutation', 'verify'] } }`),
      'api/build.gradle.kts': '',
      'api/src/main/kotlin/acme/Order.kt': 'package acme\n\nclass Order\n',
    },
    KOTLIN_CHANGE
  )

  // When the plan runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then it stops with the error saying no enabled pack provides verify, and how to fix that
  assert.equal(status, 1)
  assert.match(out, /^STOP: the project config has errors:$/m)
  assert.match(out, /^ {2}signOff\.gates: no enabled pack provides a verify engine\. Enable a stack whose pack has one, or drop "verify" from the gates\.$/m)
})

test('a branch with no change stops the plan, since nothing is there to sign off', () => {
  // Given a feature branch with nothing changed since its base
  const dir = project({})

  // When the plan runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then it stops and says so
  assert.equal(status, 1)
  assert.match(out, /^STOP: the branch holds no change since [0-9a-f]{7}, so there is nothing to sign off\.$/m)
})
