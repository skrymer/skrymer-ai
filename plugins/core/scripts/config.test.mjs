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

test('a stack without a list of roots is an error, not a crash', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { root: 'acme-api' } } }`), ['acme-api'])

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, { errors: ['stacks.kotlin-spring.roots: expected a list of directories.'] })
})

test('a project rule without a path is an error, rather than a rule matching every file', async () => {
  // Given
  const project = fixtureProject(configOf(`{ skills: { files: [{ id: 'billing', paths: /billing\\//, skills: ['billing-rules'], why: 'x' }] } }`))

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, { errors: ['skills.files "billing": path must be a regex or a string.'] })
})

test('a config with no default export is an error saying what it must export', async () => {
  // Given
  const project = fixtureProject(`export const config = { stacks: {} }\n`)

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, { errors: ['.claude/skrymer-ai.config.mjs: expected `export default defineConfig({ … })`.'] })
})

test('the TDD-gated trees are each pack’s source globs under every one of its roots', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api', './'] } } }`), ['acme-api'])

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(config.tdd.files, ['acme-api/src/**/*.kt', 'src/**/*.kt'])
})

test('a project’s own TDD globs are gated after the packs’', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      stacks: { 'kotlin-spring': { roots: ['acme-api'] } },
      tdd: { files: ['acme-scripts/**/*.kts'] },
    }`),
    ['acme-api']
  )

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(config.tdd.files, ['acme-api/src/**/*.kt', 'acme-scripts/**/*.kts'])
})

test('TDD files that are not a list of globs are an error, not a gate that covers nothing', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api'] } }, tdd: { files: 'acme-scripts/**/*.kts' } }`),
    ['acme-api']
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, { errors: ['tdd.files: expected a list of globs.'] })
})

test('the test commands are each enabled pack’s, once however many roots it has', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api', 'globex-api'] } } }`), [
    'acme-api',
    'globex-api',
  ])

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.equal(config.tdd.testCommands.length, 1)
  assert.match('./gradlew :acme:test', config.tdd.testCommands[0])
})

test('a project TDD glob written from ./ is gated as if written from the project root', async () => {
  // Given
  const project = fixtureProject(configOf(`{ tdd: { files: ['./acme-scripts/**/*.kts'] } }`))

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(config.tdd.files, ['acme-scripts/**/*.kts'])
})

test('prompt rules merge pack first, then the project, then core’s own', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      stacks: { 'kotlin-spring': { roots: ['acme-api'] } },
      skills: { prompts: [{ id: 'invoicing', pattern: /\\binvoic\\w*/i, skills: ['invoicing-rules'], why: 'Money rounds one way.' }] },
    }`),
    ['acme-api']
  )

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(
    config.skills.prompts.map((rule) => rule.id),
    ['kotlin-test-layer', 'invoicing', 'tdd', 'grill-with-docs', 'write-a-skill', 'handoff']
  )
})

test('a project prompt rule whose pattern is not a regex, or not a valid one, is an error naming the rule', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      skills: {
        prompts: [
          { id: 'invoicing', pattern: '(invoic', skills: ['invoicing-rules'], why: 'x' },
          { id: 'tax', skills: ['tax-rules'], why: 'x' },
        ],
      },
    }`)
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: [
      'skills.prompts "invoicing": pattern "(invoic" is not a valid regex (Unterminated group).',
      'skills.prompts "tax": pattern must be a regex or a string.',
    ],
  })
})

test('a project prompt rule written as a string is matched case-insensitively', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{ skills: { prompts: [{ id: 'invoicing', pattern: '\\\\binvoic', skills: ['invoicing-rules'], why: 'x' }] } }`)
  )

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.ok(config.skills.prompts.find((rule) => rule.id === 'invoicing').pattern.test('Fix the Invoice total'))
})

test('a config without tracker or domain gets GitHub with every role as its own label, and one context at the root', async () => {
  // Given
  const project = fixtureProject(configOf(`{}`))

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(config.tracker, {
    kind: 'github',
    labels: {
      bug: 'bug',
      enhancement: 'enhancement',
      'needs-triage': 'needs-triage',
      'needs-info': 'needs-info',
      'ready-for-agent': 'ready-for-agent',
      'ready-for-human': 'ready-for-human',
      wontfix: 'wontfix',
    },
  })
  assert.deepEqual(config.domain, { contexts: ['.'] })
})

test('a project’s tracker labels replace only the roles it names', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{ tracker: { kind: 'local', labels: { 'needs-triage': 'triage', wontfix: 'declined' } } }`)
  )

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.equal(config.tracker.kind, 'local')
  assert.equal(config.tracker.labels['needs-triage'], 'triage')
  assert.equal(config.tracker.labels.wontfix, 'declined')
  assert.equal(config.tracker.labels['ready-for-agent'], 'ready-for-agent')
})

test('an unknown tracker kind, an unknown role and a label that is not a string are context errors that leave every rule in force', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      stacks: { 'kotlin-spring': { roots: ['acme-api'] } },
      tracker: { kind: 'jira', labels: { 'needs-review': 'review', wontfix: 7 } },
    }`),
    ['acme-api']
  )

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(config.contextErrors, [
    'tracker.kind: expected "github" or "local", not "jira".',
    'tracker.labels: there is no role "needs-review". Roles: bug, enhancement, needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix.',
    'tracker.labels.wontfix: expected a label name.',
  ])
  assert.deepEqual(config.tdd.files, ['acme-api/src/**/*.kt'])
})

test('domain contexts that are not a list, or name a directory the project lacks, are context errors', async () => {
  // Given
  const notAList = fixtureProject(configOf(`{ domain: { contexts: 'acme-api' } }`))
  const missing = fixtureProject(configOf(`{ domain: { contexts: ['acme-api', 'globex-web'] } }`), ['acme-api'])

  // When
  const results = [await loadConfig(notAList, PLUGIN_ROOT), await loadConfig(missing, PLUGIN_ROOT)]

  // Then
  assert.deepEqual(
    results.map(({ config }) => config.contextErrors),
    [['domain.contexts: expected a list of directories, such as [\'.\'].'], ['domain.contexts: "globex-web" does not exist in the project.']]
  )
})

test('a project prompt rule without a list of skills or a reason is an error naming the rule', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      skills: {
        prompts: [
          { id: 'invoicing', pattern: /invoic/i, skill: 'invoicing-rules', why: 'x' },
          { id: 'tax', pattern: /tax/i, skills: ['tax-rules'] },
        ],
      },
    }`)
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: [
      'skills.prompts "invoicing": skills must be a list of skill names.',
      'skills.prompts "tax": why must say in one line why the skills apply.',
    ],
  })
})
