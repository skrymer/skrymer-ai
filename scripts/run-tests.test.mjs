import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

test("ignores npm's compile cache, which npm keeps in the tmpdir under one fixed name", () => {
  // Given a suite whose test leaves only a node-compile-cache dir, as an npx call does
  const { dir, tmp } = suite(`import { test } from 'node:test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('runs npx', () => { mkdirSync(join(tmpdir(), 'node-compile-cache')) })
`)

  // When the suite runs through the runner
  const run = runScript(script, dir, ['x.test.mjs'], { TMPDIR: tmp })

  // Then the run passes
  assert.equal(run.status, 0, run.out)
})
