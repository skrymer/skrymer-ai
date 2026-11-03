/**
 * Temp dirs for tests that remove themselves: when the test that made one ends, or when the
 * file ends for a dir made at module scope.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'

/** A new dir in `tmpdir()` named [prefix] plus a random suffix, removed after the current test. */
export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
