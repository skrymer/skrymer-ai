import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { tempDir } from './temp-dir.mjs'

let shared

before(() => {
  shared = tempDir('temp-dir-before-')
})

test("a test's own teardown still finds the dirs the test made", (t) => {
  // Given a dir made in the test, then a teardown registered after it, as a stack's `down` is
  const dir = tempDir('temp-dir-teardown-')
  let seen
  t.after(() => (seen = existsSync(dir)))

  // When the test ends, its teardown runs
  t.after(() => {
    // Then the dir was still there for it
    assert.equal(seen, true)
  })
})

test('a dir made in a before hook is still there for the tests', () => {
  // Given a dir made in the file's before hook

  // When a test runs

  // Then the dir is there
  assert.equal(existsSync(shared), true)
})
