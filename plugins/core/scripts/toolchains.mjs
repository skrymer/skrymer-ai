/**
 * The toolchains a pack names with `toolchain`, keyed by name as the mutation engines are. A
 * toolchain gives the test commands of its package managers, and for each root a `command` that
 * turns a pack's default command into the one the root runs, a `lint` for the pre-commit hook,
 * and the GitHub Actions steps a CI job takes before its `check`.
 *
 * `node`: a pack writes its commands for pnpm, and they run through the package manager the root
 * uses: the one its package.json pins, else the one its lockfile is for, else the same read at the
 * project top (the workspace of a package inside one), else pnpm. Its pre-commit lint is
 * lint-staged when the root configures it. Nothing is read until a command, lint or step is asked
 * for, and then only what decides it: files are checked to exist, not read.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]

const LINT_STAGED_CONFIGS = ['.lintstagedrc', '.lintstagedrc.json', '.lintstagedrc.yaml', '.lintstagedrc.yml', '.lintstagedrc.mjs', '.lintstagedrc.cjs', '.lintstagedrc.js', 'lint-staged.config.js', 'lint-staged.config.mjs', 'lint-staged.config.cjs', 'lint-staged.config.ts']

/** A test run through a package manager, flags and a workspace allowed before the script: `pnpm --filter web test`, `npm t`. */
/** A packageManager pin this toolchain can run: its manager and major version. */
const PIN = /^(pnpm|npm|yarn|bun)@(\d+)/

const PACKAGE_MANAGER_TEST = /\b(?:pnpm|npm|yarn|bun)\b[^;&|]*?\s(?:run\s+)?t(?:est)?(?=\s|$)/

export const TOOLCHAINS = {
  node: { testCommands: [PACKAGE_MANAGER_TEST], at: nodeToolchain },
}

/**
 * The Node toolchain of the root at [rootDir], [root] its path from the project top at [topDir]
 * ('' for the top itself).
 */
export function nodeToolchain(root, rootDir, topDir) {
  const at = (file) => (root ? `${root}/${file}` : file)
  let found
  /**
   * The package manager and where its pin, lockfile and Node version come from, read once,
   * nearest first: the root, each folder above it, then the project top.
   */
  const facts = () => {
    if (found) return found
    const segments = root ? root.split('/') : []
    const levels = segments
      .map((_, i) => segments.slice(0, segments.length - i).join('/'))
      .concat('')
      .map((path, i) => {
        const dir = i === 0 ? rootDir : join(topDir, path)
        return {
          dir,
          path: (file) => (path ? `${path}/${file}` : file),
          pin: PIN.exec(packageJson(dir)?.packageManager ?? ''),
          lock: LOCKFILES.find(([file]) => existsSync(join(dir, file))),
        }
      })
    const manager = levels.map(({ pin, lock }) => pin?.[1] ?? lock?.[1]).find(Boolean) ?? 'pnpm'
    const pinned = levels.find(({ pin }) => pin?.[1] === manager)
    const locked = levels.find(({ lock }) => lock?.[1] === manager)
    const nvmrc = levels.find(({ dir }) => existsSync(join(dir, '.nvmrc')))
    found = {
      manager,
      major: Number(pinned?.pin[2] ?? 0),
      // pnpm/action-setup and setup-bun read a pin from the package.json they're given, or the repo top's when given none.
      pinFile: pinned && (pinned === levels.at(-1) ? null : pinned.path('package.json')),
      lockfile: locked && locked.path(locked.lock[0]),
      nvmrc: nvmrc && nvmrc.path('.nvmrc'),
    }
    return found
  }
  const command = (pnpm) => translate(pnpm, facts())

  return {
    get manager() {
      return facts().manager
    },
    /** [pnpm], a command written for pnpm, as the root's package manager runs it. */
    command,
    /** The pre-commit lint: lint-staged when the root configures it, else [lint] as the root runs it. */
    lint: (lint) => (usesLintStaged(rootDir) ? [command(['pnpm', 'exec', 'lint-staged'])] : lint.map(command)),
    /** The GitHub Actions steps that install the package manager, Node and the dependencies. */
    ci: () => {
      const { manager, major, pinFile, lockfile, nvmrc } = facts()
      const node = nvmrc ? { 'node-version-file': nvmrc } : { 'node-version': 'lts/*' }
      // setup-node refuses to cache without the lockfile, so a root without one gets no cache.
      const setupNode = (cache) => ({ uses: 'actions/setup-node@v4', with: { ...node, ...(lockfile ? { cache, 'cache-dependency-path': lockfile } : {}) } })
      const pin = (key) => (pinFile ? { with: { [key]: pinFile } } : {})
      if (manager === 'npm') return [setupNode('npm'), { run: lockfile ? 'npm ci' : 'npm install' }]
      if (manager === 'yarn') return [{ run: 'corepack enable' }, setupNode('yarn'), { run: major >= 2 ? 'yarn install --immutable' : 'yarn install --frozen-lockfile' }]
      if (manager === 'bun') return [{ uses: 'oven-sh/setup-bun@v2', ...pin('bun-version-file') }, { uses: 'actions/setup-node@v4', with: node }, { run: 'bun install --frozen-lockfile' }]
      // pnpm/action-setup refuses a version beside a pin, so a pin wins.
      const setup = pinFile !== undefined ? pin('package_json_file') : { with: { version: 10 } }
      return [{ uses: 'pnpm/action-setup@v4', ...setup }, setupNode('pnpm'), { run: 'pnpm install --frozen-lockfile' }]
    },
  }
}

/**
 * A pnpm command for the root's [manager]. `pnpm exec x` runs a local binary and fails when there
 * is none, so it becomes `npm exec --no` (Yarn 2+'s `yarn exec`), which never fetches one; `pnpm
 * dlx x` fetches one; and `pnpm [run] x` runs a script.
 */
function translate([program, ...args], { manager, major }) {
  if (program !== 'pnpm' || manager === 'pnpm') return [program, ...args]
  const [verb, ...rest] = args
  if (verb === 'exec') return manager === 'yarn' && major >= 2 ? ['yarn', 'exec', ...rest] : ['npm', 'exec', '--no', '--', ...rest]
  if (verb === 'dlx') return { npm: ['npx', '--yes', ...rest], yarn: ['yarn', 'dlx', ...rest], bun: ['bun', 'x', ...rest] }[manager]
  const script = verb === 'run' ? rest : args
  return { npm: ['npm', 'run', ...script], yarn: ['yarn', 'run', ...script], bun: ['bun', 'run', ...script] }[manager]
}

/** Whether the root at [dir] configures lint-staged, in its package.json or a config file of its own. */
function usesLintStaged(dir) {
  return LINT_STAGED_CONFIGS.some((file) => existsSync(join(dir, file))) || packageJson(dir)?.['lint-staged'] !== undefined
}

/** The package.json in [dir], parsed, or null when there is none or it doesn't parse. */
function packageJson(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}
