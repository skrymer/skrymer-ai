import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A temp project holding [config] as its project config and an empty directory per root. */
function fixtureProject(config, roots = []) {
  const dir = mkdtempSync(join(tmpdir(), 'config-project-'))
  for (const root of roots) mkdirSync(join(dir, root), { recursive: true })
  mkdirSync(join(dir, '.claude'))
  writeFileSync(join(dir, '.claude', 'skrymer-ai.config.mjs'), config)
  return dir
}

const configOf = (body) => `
import { defineConfig } from 'skrymer-ai'

export default defineConfig(${body})
`

test('a stack with no such pack is an error naming the pack and the packs there are', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'acme-stack': { roots: ['acme-api'] } } }`), ['acme-api'])

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: ['stacks: there is no pack "acme-stack". Packs available: kotlin-spring.'],
  })
})

test('a root that does not exist is an error naming the root and its stack', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { roots: ['globex-api'] } } }`))

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: ['stacks.kotlin-spring.roots: "globex-api" does not exist in the project.'],
  })
})

test('a project rule whose path is not a valid regex is an error naming the rule', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      stacks: { 'kotlin-spring': { roots: ['acme-api'] } },
      skills: { files: [{ id: 'invoicing', path: 'acme-api/(invoicing', skills: ['invoicing-rules'], why: 'x' }] },
    }`),
    ['acme-api']
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: [
      'skills.files "invoicing": path "acme-api/(invoicing" is not a valid regex (Unterminated group).',
    ],
  })
})

test('a config that does not load, such as one with a bad regex literal, is an error saying why', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{ skills: { files: [{ id: 'invoicing', path: /acme-api\\/(invoicing/, skills: ['x'], why: 'x' }] } }`)
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /^\.claude\/skrymer-ai\.config\.mjs does not load: .*Invalid regular expression/)
})
