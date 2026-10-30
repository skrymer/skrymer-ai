import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const SCRIPTS = dirname(fileURLToPath(import.meta.url))
const CORE = join(SCRIPTS, '..', '..', 'core')

/** Runs the entrypoint at [script] in a fresh directory with [args]. */
function verify(script, ...args) {
  const run = spawnSync('node', [script, ...args], { cwd: mkdtempSync(join(tmpdir(), 'verify-cwd-')), encoding: 'utf8' })
  return { status: run.status, out: run.stdout + run.stderr }
}

/**
 * A plugin cache: `<marketplace>/web-e2e/<pack>/` holding this pack's scripts, and core at each
 * of [cores], oldest first, as `<marketplace>/core/<version>/`.
 */
function cache(pack, cores) {
  const marketplace = mkdtempSync(join(tmpdir(), 'verify-cache-'))
  cpSync(SCRIPTS, join(marketplace, 'web-e2e', pack, 'scripts'), { recursive: true })
  mkdirSync(join(marketplace, 'core'))
  cores.forEach((version, i) => {
    cpSync(join(CORE, 'scripts'), join(marketplace, 'core', version, 'scripts'), { recursive: true })
    const when = new Date(Date.now() - (cores.length - i) * 60_000)
    utimesSync(join(marketplace, 'core', version), when, when)
  })
  return join(marketplace, 'web-e2e', pack, 'scripts', 'verify.mjs')
}

test("in place, each command runs core's verify script of that name with its arguments", () => {
  // Given this repo, where core sits beside the pack
  const script = join(SCRIPTS, 'verify.mjs')

  // When the results script is asked for something it doesn't take
  const { status, out } = verify(script, 'result', 'nonsense')

  // Then core's own script answered, outside a git repo, with its exit status
  assert.equal(status, 1)
  assert.match(out, /^STOP: git rev-parse|^STOP: the project has no skrymer-ai config/m)
})

test('the browser command runs the pack’s own browser script', () => {
  // Given this repo
  const script = join(SCRIPTS, 'verify.mjs')

  // When the browser is asked for something it doesn't take
  const { out } = verify(script, 'browser', 'nonsense')

  // Then the browser script's usage answers
  assert.match(out, /usage: verify-browser\.mjs open/)
})

test("in the plugin cache, it runs core's scripts at the pack's version", () => {
  // Given a cache holding core at the pack's version and, without a stack script, at a newer one
  const script = cache('abc123', ['abc123', 'def456'])
  rmSync(join(dirname(script), '..', '..', '..', 'core', 'def456', 'scripts', 'verify-stack.mjs'))

  // When the stack script is run with no command
  const { out } = verify(script, 'stack')

  // Then core answered, from the matching version
  assert.match(out, /usage: verify-stack\.mjs up/)
})

test('in the plugin cache without core at its version, it runs the newest core installed', () => {
  // Given a cache holding two cores at other versions, the older one without a stack script
  const script = cache('abc123', ['old111', 'new222'])
  rmSync(join(dirname(script), '..', '..', '..', 'core', 'old111', 'scripts', 'verify-stack.mjs'))

  // When the stack script is run with no command
  const { out } = verify(script, 'stack')

  // Then the newer core answered
  assert.match(out, /usage: verify-stack\.mjs up/)
})

test('with no core installed it stops and says so', () => {
  // Given a cache holding the pack alone
  const script = cache('abc123', [])

  // When the results script is run
  const { status, out } = verify(script, 'result', 'check', '8')

  // Then it stops, naming what is missing
  assert.equal(status, 1)
  assert.match(out, /^STOP: core is not installed beside web-e2e/m)
})

test('an unknown command stops with the usage', () => {
  // Given this repo
  const script = join(SCRIPTS, 'verify.mjs')

  // When it is run with a command it has not got
  const { status, out } = verify(script, 'deploy')

  // Then it names the commands it has
  assert.equal(status, 1)
  assert.match(out, /^STOP: usage: verify\.mjs stack\|api\|result\|browser <arguments…>/m)
})
