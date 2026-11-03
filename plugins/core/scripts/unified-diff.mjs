/**
 * A unified diff of two texts, from git so a person reads the format they know. It runs with
 * the developer's config but never their external diff tool, so the format is always git's own.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** [after] at [to] against [before] at [from], from the file header on; a `null` side is /dev/null. */
export function unifiedDiff({ from, before, to, after }) {
  const dir = mkdtempSync(join(tmpdir(), 'unified-diff-'))
  try {
    const side = (path, content) => {
      if (content === null) return '/dev/null'
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content)
      return path
    }
    const args = ['-c', 'core.quotepath=off', 'diff', '--no-index', '--no-color', '--no-ext-diff', '--no-prefix', '--', side(from, before), side(to, after)]
    const { stdout } = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    return stdout.slice(stdout.indexOf('\n--- ') + 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
