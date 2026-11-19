import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nodeToolchain } from './toolchains.mjs'

/** A `read` over a directory holding [files], a map of relative path to content. */
const dirOf = (files = {}) => (file) => files[file] ?? null

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

  // Then pnpm is set up at 10 and Node at lts/*
  assert.deepEqual(steps, [
    { uses: 'pnpm/action-setup@v4', with: { version: 10 } },
    { uses: 'actions/setup-node@v4', with: { 'node-version': 'lts/*', cache: 'pnpm' } },
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
  assert.deepEqual(commands, [['npm', 'run', 'lint'], ['npm', 'exec', '--', 'vitest', 'run', '-t', '{test}'], ['./gradlew', 'build']])
})

test('a yarn root enables corepack before Node caches it, and installs as its yarn major expects', () => {
  // Given one root on Yarn 4 and one on Yarn classic, each with a yarn.lock
  const berry = nodeToolchain('web', dirOf({ 'package.json': pin('yarn@4.5.0'), 'yarn.lock': '' }), dirOf())
  const classic = nodeToolchain('web', dirOf({ 'package.json': '{}', 'yarn.lock': '' }), dirOf())

  // When their steps and a command are computed
  const found = [berry.ci(), classic.ci().at(-1), berry.command(['pnpm', 'exec', 'eslint', '--fix'])]

  // Then corepack comes first, Yarn 4 installs immutably and classic with a frozen lockfile, and a binary runs through yarn
  assert.deepEqual(found, [
    [
      { run: 'corepack enable' },
      { uses: 'actions/setup-node@v4', with: { 'node-version': 'lts/*', cache: 'yarn', 'cache-dependency-path': 'web/yarn.lock' } },
      { run: 'yarn install --immutable' },
    ],
    { run: 'yarn install --frozen-lockfile' },
    ['yarn', 'eslint', '--fix'],
  ])
})

test('a bun root sets up bun and runs a binary through bun x', () => {
  // Given a root holding a bun.lock
  const toolchain = nodeToolchain('web', dirOf({ 'package.json': '{}', 'bun.lock': '' }), dirOf())

  // When its steps and a command are computed
  const found = [toolchain.ci(), toolchain.command(['pnpm', 'exec', 'prettier', '--write']), toolchain.command(['pnpm', 'test'])]

  // Then bun is set up and installs, a binary runs through bun x and a script through bun run
  assert.deepEqual(found, [[{ uses: 'oven-sh/setup-bun@v2' }, { run: 'bun install --frozen-lockfile' }], ['bun', 'x', 'prettier', '--write'], ['bun', 'run', 'test']])
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
  assert.deepEqual(found, [[['npm', 'exec', '--', 'lint-staged']], [['npm', 'exec', '--', 'eslint', '--no-warn-ignored', '{staged}']]])
})
