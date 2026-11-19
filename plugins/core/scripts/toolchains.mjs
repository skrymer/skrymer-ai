/**
 * The Node toolchain a pack names with `toolchain: 'node'`. The pack writes its default commands
 * for pnpm, and core turns each into the package manager the root uses: the one its package.json
 * pins, else the one its lockfile is for, else the same read at the project top (the workspace
 * of a package inside one), else pnpm. It also gives the GitHub Actions steps a CI job takes
 * before its `check`, and runs lint-staged at pre-commit when the root configures it.
 */

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]

const LINT_STAGED_CONFIGS = ['.lintstagedrc', '.lintstagedrc.json', '.lintstagedrc.yaml', '.lintstagedrc.yml', '.lintstagedrc.mjs', '.lintstagedrc.cjs', '.lintstagedrc.js', 'lint-staged.config.js', 'lint-staged.config.mjs', 'lint-staged.config.cjs', 'lint-staged.config.ts']

/**
 * The root's Node toolchain, from [readRoot] and [readTop], each reading a file relative to the
 * root or the project top and returning null when there is none. [root] is the root's path from
 * the top, '' for the top itself.
 */
export function nodeToolchain(root, readRoot, readTop) {
  const at = (file) => (root ? `${root}/${file}` : file)
  const where = [
    { read: readRoot, path: at },
    { read: readTop, path: (file) => file },
  ]
  const pinned = where.map(({ read }) => /^(\w+)@(\d+)/.exec(json(read('package.json'))?.packageManager ?? ''))
  const locked = where.map(({ read }) => LOCKFILES.find(([file]) => read(file) !== null))
  const manager = pinned[0]?.[1] ?? locked[0]?.[1] ?? pinned[1]?.[1] ?? locked[1]?.[1] ?? 'pnpm'
  const lockfile = where.map(({ path }, i) => locked[i] && locked[i][1] === manager && path(locked[i][0])).find(Boolean)
  const nvmrc = where.map(({ read, path }) => read('.nvmrc') !== null && path('.nvmrc')).find(Boolean)
  const major = Number(pinned.find((pin) => pin?.[1] === manager)?.[2] ?? 0)

  return {
    manager,
    /** [command], written for pnpm, as the root's package manager runs it. */
    command: (command) => translate(command, manager),
    /** The pre-commit lint: lint-staged when the root configures it, else [lint] as the root runs it. */
    lint: (lint) => (usesLintStaged(readRoot) ? [translate(['pnpm', 'exec', 'lint-staged'], manager)] : lint.map((command) => translate(command, manager))),
    /** The GitHub Actions steps that install the package manager, Node and the dependencies. */
    ci: () => {
      const node = nvmrc ? { 'node-version-file': nvmrc } : { 'node-version': 'lts/*' }
      const cache = (name) => ({ ...node, cache: name, ...(lockfile ? { 'cache-dependency-path': lockfile } : {}) })
      if (manager === 'npm') return [{ uses: 'actions/setup-node@v4', with: cache('npm') }, { run: lockfile ? 'npm ci' : 'npm install' }]
      if (manager === 'yarn') {
        const install = major >= 2 ? 'yarn install --immutable' : 'yarn install --frozen-lockfile'
        return [{ run: 'corepack enable' }, { uses: 'actions/setup-node@v4', with: cache('yarn') }, { run: install }]
      }
      if (manager === 'bun') return [{ uses: 'oven-sh/setup-bun@v2' }, { run: 'bun install --frozen-lockfile' }]
      // pnpm/action-setup refuses a version beside a pin in the workspace's package.json, so a pin wins.
      const setup = pinned[0]?.[1] === 'pnpm' ? { with: { package_json_file: at('package.json') } } : pinned[1]?.[1] === 'pnpm' ? {} : { with: { version: 10 } }
      return [{ uses: 'pnpm/action-setup@v4', ...setup }, { uses: 'actions/setup-node@v4', with: cache('pnpm') }, { run: 'pnpm install --frozen-lockfile' }]
    },
  }
}

/** A pnpm [command] for [manager]: `pnpm exec x` runs a local binary, and `pnpm x` a script. */
function translate([program, ...args], manager) {
  if (program !== 'pnpm' || manager === 'pnpm') return [program, ...args]
  if (args[0] === 'exec') {
    const rest = args.slice(1)
    return { npm: ['npm', 'exec', '--', ...rest], yarn: ['yarn', ...rest], bun: ['bun', 'x', ...rest] }[manager]
  }
  return { npm: ['npm', 'run', ...args], yarn: ['yarn', ...args], bun: ['bun', 'run', ...args] }[manager]
}

/** Whether the root [read] reads from configures lint-staged, in its package.json or a config file of its own. */
function usesLintStaged(read) {
  if (LINT_STAGED_CONFIGS.some((file) => read(file) !== null)) return true
  return json(read('package.json'))?.['lint-staged'] !== undefined
}

/** [text] parsed as JSON, or null when there is none or it doesn't parse. */
function json(text) {
  try {
    return text === null ? null : JSON.parse(text)
  } catch {
    return null
  }
}
