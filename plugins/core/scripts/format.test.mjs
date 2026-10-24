import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'format.mjs')

/** A temp project holding [config] as its project config and the [files] it names, each empty. */
function fixtureProject(config, files = []) {
  const dir = mkdtempSync(join(tmpdir(), 'format-project-'))
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), '')
  }
  if (config !== undefined) {
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude', 'skrymer-ai.config.mjs'), config)
  }
  return dir
}

const configOf = (body) => `
import { defineConfig } from 'skrymer-ai'

export default defineConfig(${body})
`

const nuxtConfig = configOf(`{ stacks: { nuxt: { roots: ['acme-web'] } } }`)

/**
 * A directory of stand-in commands, one per name in [commands], each appending its working
 * directory and arguments to a log, and exiting with [exitCode]. The log reads back as one
 * `{ cwd, args }` per run.
 */
function fakeCommands(commands, exitCode = 0) {
  const bin = mkdtempSync(join(tmpdir(), 'format-bin-'))
  const log = join(bin, 'runs.jsonl')
  for (const command of commands) {
    const script = join(bin, command)
    writeFileSync(
      script,
      `#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cwd: process.cwd(), args: [${JSON.stringify(command)}, ...process.argv.slice(2)] }) + '\\n')
process.exit(${exitCode})
`
    )
    chmodSync(script, 0o755)
  }
  const runs = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : []
  return { bin, runs }
}

/** Runs the hook after a [tool] of [file] in [project], with [bin] first on the PATH. */
function runHook(project, file, bin, tool = 'Write') {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: tool,
      tool_input: { file_path: join(project, file) },
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, PATH: `${bin}${delimiter}${process.env.PATH}` },
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout }
}

const prettier = ['pnpm', 'exec', 'prettier', '--write', '--log-level', 'warn']

test('writing a .vue file under a nuxt root runs prettier then eslint on it, in the root', () => {
  // Given
  const project = fixtureProject(nuxtConfig, ['acme-web/app/components/InvoiceList.vue'])
  const { bin, runs } = fakeCommands(['pnpm'])

  // When
  const { status, stdout } = runHook(project, 'acme-web/app/components/InvoiceList.vue', bin)

  // Then
  assert.equal(status, 0)
  assert.equal(stdout, '')
  const file = join(project, 'acme-web/app/components/InvoiceList.vue')
  assert.deepEqual(runs(), [
    { cwd: join(project, 'acme-web'), args: [...prettier, file] },
    { cwd: join(project, 'acme-web'), args: ['pnpm', 'exec', 'eslint', '--fix', file] },
  ])
})

test('editing a JSON file under a nuxt root runs prettier alone', () => {
  // Given
  const project = fixtureProject(nuxtConfig, ['acme-web/i18n/en.json'])
  const { bin, runs } = fakeCommands(['pnpm'])

  // When
  runHook(project, 'acme-web/i18n/en.json', bin, 'Edit')

  // Then
  assert.deepEqual(runs(), [{ cwd: join(project, 'acme-web'), args: [...prettier, join(project, 'acme-web/i18n/en.json')] }])
})

test('a file outside every root is untouched', () => {
  // Given
  const project = fixtureProject(nuxtConfig, ['acme-web/app/app.vue', 'acme-docs/Overview.vue'])
  const { bin, runs } = fakeCommands(['pnpm'])

  // When
  const { status } = runHook(project, 'acme-docs/Overview.vue', bin)

  // Then
  assert.equal(status, 0)
  assert.deepEqual(runs(), [])
})

test('a file under a root that no format group covers is untouched', () => {
  // Given
  const project = fixtureProject(nuxtConfig, ['acme-web/public/logo.svg'])
  const { bin, runs } = fakeCommands(['pnpm'])

  // When
  runHook(project, 'acme-web/public/logo.svg', bin)

  // Then
  assert.deepEqual(runs(), [])
})

test('a stack’s own format runs in place of its pack’s', () => {
  // Given
  const project = fixtureProject(
    configOf(`{ stacks: { nuxt: { roots: ['acme-web'], format: [{ files: ['**/*.vue'], run: [['biome', 'format', '--write']] }] } } }`),
    ['acme-web/app/app.vue']
  )
  const { bin, runs } = fakeCommands(['pnpm', 'biome'])

  // When
  runHook(project, 'acme-web/app/app.vue', bin)

  // Then
  assert.deepEqual(runs(), [
    { cwd: join(project, 'acme-web'), args: ['biome', 'format', '--write', join(project, 'acme-web/app/app.vue')] },
  ])
})

test('a formatter that fails still lets the next one run, and the hook stays quiet', () => {
  // Given
  const project = fixtureProject(nuxtConfig, ['acme-web/app/app.vue'])
  const { bin, runs } = fakeCommands(['pnpm'], 2)

  // When
  const { status, stdout } = runHook(project, 'acme-web/app/app.vue', bin)

  // Then
  assert.equal(status, 0)
  assert.equal(stdout, '')
  assert.equal(runs().length, 2)
})

test('a formatter that is not installed is skipped without an error', () => {
  // Given
  const project = fixtureProject(
    configOf(`{ stacks: { nuxt: { roots: ['acme-web'], format: [{ files: ['**/*.vue'], run: [['acme-no-such-formatter']] }] } } }`),
    ['acme-web/app/app.vue']
  )
  const { bin } = fakeCommands([])

  // When
  const { status, stdout } = runHook(project, 'acme-web/app/app.vue', bin)

  // Then
  assert.equal(status, 0)
  assert.equal(stdout, '')
})

test('a project without a config, or with one that does not validate, formats nothing', () => {
  // Given
  const bare = fixtureProject(undefined, ['acme-web/app/app.vue'])
  const broken = fixtureProject(configOf(`{ stacks: { nuxt: { roots: ['acme-web'], format: 'prettier' } } }`), [
    'acme-web/app/app.vue',
  ])
  const { bin, runs } = fakeCommands(['pnpm'])

  // When
  const results = [runHook(bare, 'acme-web/app/app.vue', bin), runHook(broken, 'acme-web/app/app.vue', bin)]

  // Then
  assert.deepEqual(
    results.map(({ status }) => status),
    [0, 0]
  )
  assert.deepEqual(runs(), [])
})

test('a file that is gone by the time the hook runs is not formatted', () => {
  // Given
  const project = fixtureProject(nuxtConfig, ['acme-web/app/app.vue'])
  const { bin, runs } = fakeCommands(['pnpm'])

  // When
  runHook(project, 'acme-web/app/Gone.vue', bin)

  // Then
  assert.deepEqual(runs(), [])
})
