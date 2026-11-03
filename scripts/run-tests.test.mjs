import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { runScript } from '../plugins/core/scripts/git-fixture.mjs'
import { tempDir } from '../plugins/core/scripts/temp-dir.mjs'

const script = join(import.meta.dirname, 'run-tests.mjs')

const LEAKY = `import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('leaves its fixture behind', () => { mkdtempSync(join(tmpdir(), 'leaky-fixture-')) })
`

const TIDY = `import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('removes its fixture', () => { rmSync(mkdtempSync(join(tmpdir(), 'tidy-fixture-')), { recursive: true }) })
`

const FAILING = `import { test } from 'node:test'
test('fails', () => { throw new Error('boom') })
`

/** A dir holding [source] as `x.test.mjs`, and an empty dir to serve as the run's own tmpdir. */
function suite(source) {
  const dir = tempDir('run-tests-suite-')
  writeFileSync(join(dir, 'x.test.mjs'), source)
  return { dir, tmp: tempDir('run-tests-tmp-') }
}

test('fails the run and names the dir when a test leaves a temp dir behind', () => {
  // Given a suite whose one test makes a temp dir and never removes it
  const { dir, tmp } = suite(LEAKY)

  // When the suite runs through the runner
  const run = runScript(script, dir, ['x.test.mjs'], { TMPDIR: tmp })

  // Then the run fails, naming the leftover by its prefix
  assert.equal(run.status, 1, run.out)
  assert.match(run.out, /leaky-fixture-/)
})

test('passes a suite whose tests remove their temp dirs', () => {
  // Given a suite whose one test removes the temp dir it makes
  const { dir, tmp } = suite(TIDY)

  // When the suite runs through the runner
  const run = runScript(script, dir, ['x.test.mjs'], { TMPDIR: tmp })

  // Then the run passes
  assert.equal(run.status, 0, run.out)
})

test('fails the run when a test fails, even with nothing left behind', () => {
  // Given a suite whose one test throws
  const { dir, tmp } = suite(FAILING)

  // When the suite runs through the runner
  const run = runScript(script, dir, ['x.test.mjs'], { TMPDIR: tmp })

  // Then the run fails
  assert.notEqual(run.status, 0, run.out)
  assert.match(run.out, /boom/)
})

test("removes the run's own temp dir, leftovers and all", () => {
  // Given a suite that leaks a temp dir
  const { dir, tmp } = suite(LEAKY)

  // When the suite runs through the runner
  runScript(script, dir, ['x.test.mjs'], { TMPDIR: tmp })

  // Then nothing from the run is left in the tmpdir the runner was given
  assert.deepEqual(readdirSync(tmp), [])
})

test("leaves nothing for Node's compile cache, which npm turns on in the tmpdir", () => {
  // Given a suite whose test turns the compile cache on, as npm does
  const { dir, tmp } = suite(`import { test } from 'node:test'
import { enableCompileCache } from 'node:module'
test('runs npm', () => { enableCompileCache() })
`)

  // When the suite runs through the runner
  const run = runScript(script, dir, ['x.test.mjs'], { TMPDIR: tmp })

  // Then the run passes
  assert.equal(run.status, 0, run.out)
})

test('says so when the test run itself is killed, rather than blaming the dirs it had not removed yet', () => {
  // Given a suite whose test kills the node --test process running it
  const { dir, tmp } = suite(`import { test } from 'node:test'
test('dies', () => { process.kill(process.ppid, 'SIGKILL') })
`)

  // When the suite runs through the runner
  const run = runScript(script, dir, ['x.test.mjs'], { TMPDIR: tmp })

  // Then the run fails, naming the signal
  assert.notEqual(run.status, 0, run.out)
  assert.match(run.out, /killed by SIGKILL/)
  assert.doesNotMatch(run.out, /tempDir\(\)/)
})

test('on SIGTERM, stops the test run and still removes its temp dir', async () => {
  // Given a suite whose test makes a temp dir and then hangs
  const { dir, tmp } = suite(`import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('hangs', () => { mkdtempSync(join(tmpdir(), 'hung-')); return new Promise(() => setTimeout(() => {}, 60000)) })
`)
  const runner = spawn('node', [script, 'x.test.mjs'], { cwd: dir, env: { ...process.env, TMPDIR: tmp } })
  const closed = new Promise((resolve) => runner.on('close', resolve))
  const runDir = () => readdirSync(tmp).map((name) => join(tmp, name))[0]
  while (!runDir() || !readdirSync(runDir()).some((name) => name.startsWith('hung-'))) await new Promise((r) => setTimeout(r, 20))

  // When the runner is sent SIGTERM
  runner.kill('SIGTERM')
  const status = await closed

  // Then it fails, with nothing left in the tmpdir it was given
  assert.notEqual(status, 0)
  assert.deepEqual(readdirSync(tmp), [])
})

test('fails the run, naming the process, and stops it when a test leaves a process running', () => {
  // Given a suite whose test starts a detached process and never stops it
  const pidFile = join(tempDir('run-tests-pid-'), 'pid')
  const { dir, tmp } = suite(`import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
test('starts a server', () => {
  const server = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  server.unref()
  writeFileSync(${JSON.stringify(pidFile)}, String(server.pid))
})
`)

  // When the suite runs through the runner
  const run = runScript(script, dir, ['x.test.mjs'], { TMPDIR: tmp })

  // Then the run fails, naming the process, and the process is gone
  assert.equal(run.status, 1, run.out)
  assert.match(run.out, /left running: \d+ sleep 30/)
  assert.throws(() => process.kill(Number(readFileSync(pidFile, 'utf8')), 0), { code: 'ESRCH' })
})

test('lets a process the tests stop as they end finish exiting', () => {
  // Given a suite whose test stops its process as the file ends, without waiting for it to exit
  const { dir, tmp } = suite(`import { test, after } from 'node:test'
import { spawn } from 'node:child_process'
test('starts and stops a server', () => {
  const server = spawn('sh', ['-c', 'trap "sleep 0.3; exit 0" TERM; while :; do sleep 0.05; done'], { detached: true, stdio: 'ignore' })
  server.unref()
  after(() => process.kill(server.pid, 'SIGTERM'))
})
`)

  // When the suite runs through the runner
  const run = runScript(script, dir, ['x.test.mjs'], { TMPDIR: tmp })

  // Then the run passes
  assert.equal(run.status, 0, run.out)
})

test('with SKRYMER_AI_KEEP_TEST_DIRS set, keeps every test dir and says where', () => {
  // Given a suite whose test makes a dir with tempDir, and a run asked to keep the test dirs
  const { dir, tmp } = suite(`import { test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from ${JSON.stringify(join(import.meta.dirname, '..', 'plugins', 'core', 'scripts', 'temp-dir.mjs'))}
test('writes a log', () => { writeFileSync(join(tempDir('kept-'), 'stack.log'), 'up failed') })
`)

  // When the suite runs through the runner
  const run = runScript(script, dir, ['x.test.mjs'], { TMPDIR: tmp, SKRYMER_AI_KEEP_TEST_DIRS: '1' })

  // Then the run passes, names where it kept the dirs, and the test's log is still there
  assert.equal(run.status, 0, run.out)
  const kept = run.out.match(/kept the test dirs in (\S+)/)?.[1]
  assert.ok(kept, run.out)
  const [made] = readdirSync(kept)
  assert.equal(readFileSync(join(kept, made, 'stack.log'), 'utf8'), 'up failed')
})
