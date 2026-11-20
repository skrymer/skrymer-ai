import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nodeToolchain } from './toolchains.mjs'
import { tempDir } from './temp-dir.mjs'

/** A temp directory holding [files], a map of file name to content. */
function dirOf(files = {}) {
  const dir = tempDir('toolchain-')
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content)
  return dir
}

const pin = (packageManager) => JSON.stringify({ packageManager })

test('a root pinning pnpm sets it up from its own package.json, with Node from its .nvmrc', () => {
  // Given a root at web/ that pins pnpm and holds an .nvmrc and a pnpm lockfile
  const toolchain = nodeToolchain('web', dirOf({ 'package.json': pin('pnpm@10.4.1'), '.nvmrc': '24\n', 'pnpm-lock.yaml': '' }), dirOf())

  // When its CI steps are computed
  const steps = toolchain.ci()

  // Then pnpm comes from web/package.json, and Node and the cache from web/
  assert.deepEqual(steps, [
    { uses: 'pnpm/action-setup@v4', with: { package_json_file: 'web/package.json' } },
    { uses: 'actions/setup-node@v4', with: { 'node-version-file': 'web/.nvmrc', cache: 'pnpm', 'cache-dependency-path': 'web/pnpm-lock.yaml' } },
    { run: 'pnpm install --frozen-lockfile' },
  ])
})

test('a package inside a pnpm workspace takes the workspace’s pin, lockfile and .nvmrc', () => {
  // Given a root at apps/web/ with a bare package.json, in a workspace whose top pins pnpm
  const toolchain = nodeToolchain('apps/web', dirOf({ 'package.json': '{}' }), dirOf({ 'package.json': pin('pnpm@9.15.0'), 'pnpm-lock.yaml': '', '.nvmrc': '22\n' }))

  // When its CI steps are computed
  const steps = toolchain.ci()

  // Then pnpm/action-setup gets no version of its own to clash with the pin, and the rest comes from the top
  assert.deepEqual(steps, [
    { uses: 'pnpm/action-setup@v4' },
    { uses: 'actions/setup-node@v4', with: { 'node-version-file': '.nvmrc', cache: 'pnpm', 'cache-dependency-path': 'pnpm-lock.yaml' } },
    { run: 'pnpm install --frozen-lockfile' },
  ])
})

test('a root with no pin and no lockfile anywhere gets pnpm 10 and the current Node LTS', () => {
  // Given a bare root
  const toolchain = nodeToolchain('web', dirOf({ 'package.json': '{}' }), dirOf())

  // When its CI steps are computed
  const steps = toolchain.ci()

  // Then pnpm is set up at 10 and Node at lts/*, uncached with no lockfile to key it
  assert.deepEqual(steps, [
    { uses: 'pnpm/action-setup@v4', with: { version: 10 } },
    { uses: 'actions/setup-node@v4', with: { 'node-version': 'lts/*' } },
    { run: 'pnpm install --frozen-lockfile' },
  ])
})

test('an npm root installs with npm ci and runs the pack’s commands through npm', () => {
  // Given a root holding a package-lock.json
  const toolchain = nodeToolchain('', dirOf({ 'package.json': '{}', 'package-lock.json': '{}' }), dirOf({ 'package.json': '{}', 'package-lock.json': '{}' }))

  // When its steps and commands are computed
  const steps = toolchain.ci()
  const commands = [['pnpm', 'lint'], ['pnpm', 'exec', 'vitest', 'run', '-t', '{test}'], ['./gradlew', 'build']].map(toolchain.command)

  // Then npm sets up and installs, a script runs through npm run, a binary through npm exec, and a non-pnpm command is left alone
  assert.deepEqual(steps, [{ uses: 'actions/setup-node@v4', with: { 'node-version': 'lts/*', cache: 'npm', 'cache-dependency-path': 'package-lock.json' } }, { run: 'npm ci' }])
  assert.deepEqual(commands, [['npm', 'run', 'lint'], ['npm', 'exec', '--no', '--', 'vitest', 'run', '-t', '{test}'], ['./gradlew', 'build']])
})

test('a yarn root enables corepack before Node caches it, and installs as its yarn major expects', () => {
  // Given one root on Yarn 4 and one on Yarn classic, each with a yarn.lock
  const berry = nodeToolchain('web', dirOf({ 'package.json': pin('yarn@4.5.0'), 'yarn.lock': '' }), dirOf())
  const classic = nodeToolchain('web', dirOf({ 'package.json': '{}', 'yarn.lock': '' }), dirOf())

  // When their steps and a command are computed
  const found = [berry.ci(), classic.ci().at(-1), berry.command(['pnpm', 'exec', 'eslint', '--fix'])]

  // Then corepack comes first, Yarn 4 installs immutably and classic with a frozen lockfile, and a binary runs through yarn exec, never a script of the same name
  assert.deepEqual(found, [
    [
      { run: 'corepack enable' },
      { uses: 'actions/setup-node@v4', with: { 'node-version': 'lts/*', cache: 'yarn', 'cache-dependency-path': 'web/yarn.lock' } },
      { run: 'yarn install --immutable' },
    ],
    { run: 'yarn install --frozen-lockfile' },
    ['yarn', 'exec', 'eslint', '--fix'],
  ])
})

test('a bun root sets up bun and Node, and runs a binary only if it is installed', () => {
  // Given a root holding a bun.lock
  const toolchain = nodeToolchain('web', dirOf({ 'package.json': '{}', 'bun.lock': '' }), dirOf())

  // When its steps and a command are computed
  const found = [toolchain.ci(), toolchain.command(['pnpm', 'exec', 'prettier', '--write']), toolchain.command(['pnpm', 'test'])]

  // Then bun and Node are set up and bun installs, a binary runs through npm exec --no, which never fetches one, and a script through bun run
  assert.deepEqual(found, [
    [{ uses: 'oven-sh/setup-bun@v2' }, { uses: 'actions/setup-node@v4', with: { 'node-version': 'lts/*' } }, { run: 'bun install --frozen-lockfile' }],
    ['npm', 'exec', '--no', '--', 'prettier', '--write'],
    ['bun', 'run', 'test'],
  ])
})

test('a root’s own pin beats a lockfile, and its own lockfile beats the workspace’s pin', () => {
  // Given a root pinning npm beside a pnpm lockfile, and one with an npm lockfile in a workspace pinning pnpm
  const pinnedRoot = nodeToolchain('web', dirOf({ 'package.json': pin('npm@10.9.0'), 'pnpm-lock.yaml': '' }), dirOf())
  const lockedRoot = nodeToolchain('web', dirOf({ 'package.json': '{}', 'package-lock.json': '{}' }), dirOf({ 'package.json': pin('pnpm@10.4.1') }))

  // When their package managers are read
  const found = [pinnedRoot.manager, lockedRoot.manager]

  // Then each is npm
  assert.deepEqual(found, ['npm', 'npm'])
})

test('the pre-commit lint is lint-staged when the root configures it, else the pack’s lint for the root’s manager', () => {
  // Given an npm root with a lint-staged config file, and one without
  const staged = nodeToolchain('web', dirOf({ 'package.json': '{}', 'package-lock.json': '{}', '.lintstagedrc.json': '{}' }), dirOf())
  const plain = nodeToolchain('web', dirOf({ 'package.json': '{}', 'package-lock.json': '{}' }), dirOf())
  const lint = [['pnpm', 'exec', 'eslint', '--no-warn-ignored', '{staged}']]

  // When their lints are computed
  const found = [staged.lint(lint), plain.lint(lint)]

  // Then the first runs lint-staged and the second the pack's ESLint, each through npm
  assert.deepEqual(found, [[['npm', 'exec', '--no', '--', 'lint-staged']], [['npm', 'exec', '--no', '--', 'eslint', '--no-warn-ignored', '{staged}']]])
})

test('a script named through pnpm run, and a binary fetched through pnpm dlx, translate to each manager’s own', () => {
  // Given an npm root and a yarn root
  const npm = nodeToolchain('web', dirOf({ 'package.json': '{}', 'package-lock.json': '{}' }), dirOf())
  const yarn = nodeToolchain('web', dirOf({ 'package.json': '{}', 'yarn.lock': '' }), dirOf())

  // When pnpm run and pnpm dlx commands are translated
  const found = [npm.command(['pnpm', 'run', 'build']), npm.command(['pnpm', 'dlx', 'jscpd']), yarn.command(['pnpm', 'run', 'build']), yarn.command(['pnpm', 'dlx', 'jscpd'])]

  // Then the script runs once, not as `run run`, and the fetched binary runs through npx or yarn dlx
  assert.deepEqual(found, [['npm', 'run', 'build'], ['npx', '--yes', 'jscpd'], ['yarn', 'run', 'build'], ['yarn', 'dlx', 'jscpd']])
})

test('a pin to a package manager the toolchain does not know is passed over for the lockfile', () => {
  // Given a root pinning deno beside an npm lockfile, and one pinning deno alone
  const locked = nodeToolchain('web', dirOf({ 'package.json': pin('deno@2.1.4'), 'package-lock.json': '{}' }), dirOf())
  const bare = nodeToolchain('web', dirOf({ 'package.json': pin('deno@2.1.4') }), dirOf())

  // When their managers and a command are read
  const found = [locked.manager, bare.manager, bare.command(['pnpm', 'lint'])]

  // Then the lockfile decides, and with none the default pnpm runs the command
  assert.deepEqual(found, ['npm', 'pnpm', ['pnpm', 'lint']])
})

test('an npm root without a lockfile gets no Node cache, since setup-node refuses to cache without one', () => {
  // Given a root pinning npm with no lockfile
  const toolchain = nodeToolchain('web', dirOf({ 'package.json': pin('npm@10.9.0') }), dirOf())

  // When its CI steps are computed
  const steps = toolchain.ci()

  // Then Node is set up without a cache and npm installs
  assert.deepEqual(steps, [{ uses: 'actions/setup-node@v4', with: { 'node-version': 'lts/*' } }, { run: 'npm install' }])
})

test('a bun root pinning bun sets bun up from its own package.json, with Node from its .nvmrc', () => {
  // Given a root at web/ pinning bun, with an .nvmrc and a bun.lock
  const toolchain = nodeToolchain('web', dirOf({ 'package.json': pin('bun@1.1.38'), '.nvmrc': '24\n', 'bun.lock': '' }), dirOf())

  // When its CI steps are computed
  const steps = toolchain.ci()

  // Then setup-bun reads the pin from web/package.json and setup-node the version from web/.nvmrc
  assert.deepEqual(steps, [
    { uses: 'oven-sh/setup-bun@v2', with: { 'bun-version-file': 'web/package.json' } },
    { uses: 'actions/setup-node@v4', with: { 'node-version-file': 'web/.nvmrc' } },
    { run: 'bun install --frozen-lockfile' },
  ])
})

test('a root inside a workspace below the project top takes that workspace’s manager, lockfile and .nvmrc', () => {
  // Given a project top with no package.json, an npm workspace at web/, and a root at web/apps/shop
  const top = dirOf()
  mkdirSync(join(top, 'web', 'apps', 'shop'), { recursive: true })
  writeFileSync(join(top, 'web', 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }))
  writeFileSync(join(top, 'web', 'package-lock.json'), '{}')
  writeFileSync(join(top, 'web', '.nvmrc'), '22\n')
  writeFileSync(join(top, 'web', 'apps', 'shop', 'package.json'), '{}')
  const toolchain = nodeToolchain('web/apps/shop', join(top, 'web', 'apps', 'shop'), top)

  // When its manager and CI steps are read
  const found = [toolchain.manager, toolchain.ci()]

  // Then it is npm, cached against web/package-lock.json with Node from web/.nvmrc
  assert.deepEqual(found, [
    'npm',
    [{ uses: 'actions/setup-node@v4', with: { 'node-version-file': 'web/.nvmrc', cache: 'npm', 'cache-dependency-path': 'web/package-lock.json' } }, { run: 'npm ci' }],
  ])
})
