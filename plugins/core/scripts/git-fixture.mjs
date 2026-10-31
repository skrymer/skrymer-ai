/**
 * Temp git projects for the process tests of the scripts that measure a branch. Git runs
 * without the developer's own config, so a global signing key or hook can't reach a fixture.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

export const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.email=dev@acme.test', '-c', 'user.name=dev', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim()

/** Writes [files] into [dir], each `path: content`; a `null` content deletes the file. */
export function writeFiles(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    if (content === null) {
      rmSync(join(dir, file))
      continue
    }
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), content)
  }
}

/**
 * A temp project in a git repo whose `origin` has [base] on `main`, checked out on a feature
 * branch with [branch] written on top and left uncommitted. A `null` in [branch] deletes the file.
 */
export function gitProject(base, branch = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'git-project-'))
  writeFiles(dir, base)
  const origin = mkdtempSync(join(tmpdir(), 'git-origin-'))
  git(origin, 'init', '-q', '--bare', '-b', 'main')
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'base')
  git(dir, 'remote', 'add', 'origin', origin)
  git(dir, 'push', '-q', 'origin', 'main')
  git(dir, 'remote', 'set-head', 'origin', 'main')
  git(dir, 'switch', '-qc', 'feature')
  writeFiles(dir, branch)
  return dir
}

/** Runs the Node [script] in [dir] with [args] and [env] on top of the fixture's git env. */
export function runScript(script, dir, args = [], env = {}) {
  const result = spawnSync('node', [script, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, ...env } })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, out: result.stdout + result.stderr }
}
