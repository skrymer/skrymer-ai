/**
 * Temp dirs for tests that remove themselves when the test file ends. Removing them only then,
 * rather than as each test ends, keeps them there for the test's own teardown (a stack's `down`
 * reads its state from the project) and for dirs a `before` hook makes for the tests to share.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'

const dirs = new Set()

// Registered when the first test module imports this one, so it runs after the file's last test.
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** A new dir in `tmpdir()` named [prefix] plus a random suffix, removed when the test file ends. */
export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.add(dir)
  return dir
}
