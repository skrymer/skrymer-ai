/**
 * The branch a change lives on, measured from where it left origin's default branch. The
 * duplication gate, the mutation sweep, the check-adrs scope and the sign-off all scope to it,
 * so a change is judged on what it added, committed or not, and never on what it merely sits
 * beside.
 */

import { spawnSync } from 'node:child_process'
import { isAbsolute, join, relative } from 'node:path'

const FETCH_TIMEOUT_MS = 60_000

/**
 * The repo [dir] is in, as `{ top, base, git, untracked }`: its top level, the merge base of
 * HEAD with origin's default branch, `git [args]` run at the top, and the files git doesn't
 * track yet. Each git call fails after [timeout] ms with git's own last word.
 */
export function branchOf(dir, { timeout } = {}) {
  const top = git(dir, timeout, 'rev-parse', '--show-toplevel')
  const base = git(top, timeout, 'merge-base', 'HEAD', baseline(top))
  return {
    top,
    base,
    git: (...args) => git(top, timeout, ...args),
    untracked: () => git(top, timeout, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean),
  }
}

/**
 * The branch [projectDir] is on, as `branchOf` gives it plus `changed`: every file the branch
 * changed since its merge base, committed or not, untracked and deleted ones included,
 * relative to [projectDir] and sorted. Fetches origin first, because an unfetched origin
 * anchors the merge base wherever this clone last looked; a fetch that fails is passed to
 * [warn] and the measure goes on. An unresolved base throws, with git's reason.
 */
export function changedOnBranch(projectDir, warn) {
  const fetch = spawnSync('git', ['fetch', '-q', 'origin'], { cwd: projectDir, encoding: 'utf8', timeout: FETCH_TIMEOUT_MS })
  if (fetch.status !== 0) warn(`could not fetch origin (${fetch.error?.message ?? fetch.stderr.trim().split('\n').at(-1)}); the base is where this clone last looked.`)
  const branch = branchOf(projectDir)
  const { top, base, git, untracked } = branch
  const changed = [...new Set([...git('-c', 'core.quotePath=false', 'diff', '--name-only', base).split('\n'), ...untracked()])]
    .filter(Boolean)
    .map((file) => relative(projectDir, join(top, file)))
    .filter((file) => !file.startsWith('..') && !isAbsolute(file))
    .sort()
  return { ...branch, changed }
}

/** origin's default branch, as `origin/HEAD` names it, else `origin/main`, whichever exists. */
function baseline(top) {
  const head = spawnSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: top, encoding: 'utf8' }).stdout?.trim()
  const ref = [head, 'origin/main'].find(
    (candidate) => candidate && spawnSync('git', ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], { cwd: top }).status === 0
  )
  if (ref) return ref
  throw new Error('no baseline to compare with: neither origin/HEAD nor origin/main exists. `git remote set-head origin -a` sets origin/HEAD.')
}

/** The output of `git [args]` run in [cwd], or an error carrying git's own last word. */
function git(cwd, timeout, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git: ${result.stderr.trim().split('\n').at(-1)}`)
  return result.stdout.trim()
}
