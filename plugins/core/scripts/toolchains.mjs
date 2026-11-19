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
 * for, since the config loads on every hook call.
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
  /** The package manager and where its pin, lockfile and Node version come from, read once. */
  const facts = () => {
    if (found) return found
    const level = (dir, path) => ({
      dir,
      path,
      pin: /^(\w+)@(\d+)/.exec(packageJson(dir)?.packageManager ?? ''),
      lock: LOCKFILES.find(([file]) => existsSync(join(dir, file))),
    })
    const levels = [level(rootDir, at), level(topDir, (file) => file)]
    const [own, top] = levels
    const manager = own.pin?.[1] ?? own.lock?.[1] ?? top.pin?.[1] ?? top.lock?.[1] ?? 'pnpm'
    const locked = levels.find(({ lock }) => lock?.[1] === manager)
    const nvmrc = levels.find(({ dir }) => existsSync(join(dir, '.nvmrc')))
    found = {
      manager,
      own,
      top,
      lockfile: locked && locked.path(locked.lock[0]),
      nvmrc: nvmrc && nvmrc.path('.nvmrc'),
      major: Number(levels.find(({ pin }) => pin?.[1] === manager)?.pin[2] ?? 0),
    }
    return found
  }
  const command = (pnpm) => translate(pnpm, facts().manager)

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
      const { manager, own, top, lockfile, nvmrc, major } = facts()
      const node = nvmrc ? { 'node-version-file': nvmrc } : { 'node-version': 'lts/*' }
      const cache = (name) => ({ ...node, cache: name, ...(lockfile ? { 'cache-dependency-path': lockfile } : {}) })
      if (manager === 'npm') return [{ uses: 'actions/setup-node@v4', with: cache('npm') }, { run: lockfile ? 'npm ci' : 'npm install' }]
      if (manager === 'yarn') {
        const install = major >= 2 ? 'yarn install --immutable' : 'yarn install --frozen-lockfile'
        return [{ run: 'corepack enable' }, { uses: 'actions/setup-node@v4', with: cache('yarn') }, { run: install }]
      }
      if (manager === 'bun') return [{ uses: 'oven-sh/setup-bun@v2' }, { run: 'bun install --frozen-lockfile' }]
      // pnpm/action-setup refuses a version beside a pin in the workspace's package.json, so a pin wins.
      const setup = own.pin?.[1] === 'pnpm' ? { with: { package_json_file: at('package.json') } } : top.pin?.[1] === 'pnpm' ? {} : { with: { version: 10 } }
      return [{ uses: 'pnpm/action-setup@v4', ...setup }, { uses: 'actions/setup-node@v4', with: cache('pnpm') }, { run: 'pnpm install --frozen-lockfile' }]
    },
  }
}

/** A pnpm command for [manager]: `pnpm exec x` runs a local binary, `pnpm dlx x` a fetched one, and `pnpm [run] x` a script. */
function translate([program, ...args], manager) {
  if (program !== 'pnpm' || manager === 'pnpm') return [program, ...args]
  const [verb, ...rest] = args
  if (verb === 'exec') return { npm: ['npm', 'exec', '--', ...rest], yarn: ['yarn', ...rest], bun: ['bun', 'x', ...rest] }[manager]
  if (verb === 'dlx') return { npm: ['npx', '--yes', ...rest], yarn: ['yarn', 'dlx', ...rest], bun: ['bun', 'x', ...rest] }[manager]
  const script = verb === 'run' ? rest : args
  return { npm: ['npm', 'run', ...script], yarn: ['yarn', ...script], bun: ['bun', 'run', ...script] }[manager]
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
