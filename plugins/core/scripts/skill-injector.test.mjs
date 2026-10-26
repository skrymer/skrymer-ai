import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'skill-injector.mjs')

/** A temp project holding [config] as its project config and an empty directory per root. */
function fixtureProject(config, roots = []) {
  const dir = mkdtempSync(join(tmpdir(), 'skill-injector-project-'))
  for (const root of roots) mkdirSync(join(dir, root), { recursive: true })
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

const invoicingRule = `{ id: 'invoicing', pattern: /\\binvoic\\w*/i, skills: ['invoicing-rules'], why: 'money rounds half up.' }`

/** Runs the hook on [input] in [project], returning its exit status and stdout. */
function runHook(project, input) {
  const result = spawnSync('node', [HOOK], {
    input,
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout }
}

const submit = (prompt) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt })

/** The context the hook injected for [prompt], or '' when it stayed silent. */
function injected(project, prompt) {
  const { stdout } = runHook(project, submit(prompt))
  return stdout ? JSON.parse(stdout).hookSpecificOutput.additionalContext : ''
}

test('a prompt matching a project rule injects its skill with the rule’s reason', () => {
  // Given
  const project = fixtureProject(configOf(`{ skills: { prompts: [${invoicingRule}] } }`))

  // When
  const { status, stdout } = runHook(project, submit('Round the Acme invoice totals'))

  // Then
  assert.equal(status, 0)
  const output = JSON.parse(stdout)
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
  assert.match(output.hookSpecificOutput.additionalContext, /^- \/invoicing-rules — money rounds half up\.$/m)
})

test('rules naming one skill merge into one reminder keeping every reason, and no prompt gets more than three', () => {
  // Given
  const rules = [
    `{ id: 'a', pattern: /acme/i, skills: ['invoicing-rules'], why: 'first reason.' }`,
    `{ id: 'b', pattern: /acme/i, skills: ['invoicing-rules', 'tax-rules'], why: 'second reason.' }`,
    `{ id: 'c', pattern: /acme/i, skills: ['ledger-rules'], why: 'x.' }`,
    `{ id: 'd', pattern: /acme/i, skills: ['payroll-rules'], why: 'x.' }`,
  ]
  const project = fixtureProject(configOf(`{ skills: { prompts: [${rules.join(', ')}] } }`))

  // When
  const context = injected(project, 'Tidy up the Acme module')

  // Then
  const lines = context.split('\n').filter((line) => line.startsWith('- '))
  assert.deepEqual(lines, [
    '- /invoicing-rules — first reason. Also second reason.',
    '- /tax-rules — second reason.',
    '- /ledger-rules — x.',
  ])
})

test('a skill the prompt already invokes is not reminded of', () => {
  // Given
  const rules = `{ id: 'a', pattern: /acme/i, skills: ['invoicing-rules', 'core:tdd'], why: 'x.' }`
  const project = fixtureProject(configOf(`{ skills: { prompts: [${rules}] } }`))

  // When
  const context = injected(project, '/core:tdd fix the Acme rounding')

  // Then
  assert.doesNotMatch(context, /\/core:tdd/)
  assert.match(context, /^- \/invoicing-rules — x\.$/m)
})

test('a plugin skill typed by its short name counts as invoked', () => {
  // Given
  const project = fixtureProject(configOf(`{}`))

  // When
  const context = injected(project, '/tdd add a failing test for the Acme refund')

  // Then
  assert.doesNotMatch(context, /\/core:tdd/)
})

test('a worktree-scoped project rule says once to invoke the worktree’s scoped copy, however many of its rules matched', () => {
  // Given
  const rules = [
    `{ id: 'a', pattern: /acme/i, skills: ['acme-dev'], why: 'first.', worktreeScoped: true }`,
    `{ id: 'b', pattern: /acme/i, skills: ['acme-dev'], why: 'second.', worktreeScoped: true }`,
    `{ id: 'c', pattern: /acme/i, skills: ['invoicing-rules'], why: 'x.' }`,
  ]
  const project = fixtureProject(configOf(`{ skills: { prompts: [${rules.join(', ')}] } }`))

  // When
  const context = injected(project, 'Start on the Acme slice')

  // Then
  assert.match(context, /^- \/acme-dev — first\. Also second\. In a worktree, invoke its scoped copy\.$/m)
  assert.match(context, /^- \/invoicing-rules — x\.$/m)
})

test('an invalid config lets the prompt through and tells the user why no skills were injected', () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'acme-stack': { roots: ['.'] } } }`))

  // When
  const { status, stdout } = runHook(project, submit('Fix the Acme tests'))

  // Then
  assert.equal(status, 0)
  assert.deepEqual(JSON.parse(stdout), {
    systemMessage:
      'skrymer-ai: the skill injector is off until the project config is fixed:\nstacks: there is no pack "acme-stack". Packs available: kotlin-spring, nuxt, web-e2e.',
  })
})

test('a bad tracker block leaves the reminders on', () => {
  // Given
  const project = fixtureProject(configOf(`{ tracker: { kind: 'jira' }, skills: { prompts: [${invoicingRule}] } }`))

  // When
  const context = injected(project, 'Round the Acme invoice totals')

  // Then
  assert.match(context, /^- \/invoicing-rules — /m)
})

test('a backend test prompt in a kotlin-spring project reaches both the playbook and core:tdd', () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api'] } } }`), ['acme-api'])

  // When
  const context = injected(project, 'Add a MockMvc case for the Acme refund endpoint')

  // Then
  assert.match(context, /^- \/kotlin-spring:backend-dev — /m)
  assert.match(context, /^- \/core:tdd — /m)
})

test('core’s own rules apply in any configured project: a planning prompt is sent to grill-with-docs, not plan mode', () => {
  // Given
  const project = fixtureProject(configOf(`{}`))

  // When
  const context = injected(project, 'How should we split the Globex importer?')

  // Then
  assert.match(context, /^- \/core:grill-with-docs — .*never with EnterPlanMode\/ExitPlanMode\.$/m)
})

test('an ordinary prompt, a project without a config, and an empty prompt inject nothing', () => {
  // Given
  const configured = fixtureProject(configOf(`{ skills: { prompts: [${invoicingRule}] } }`))
  const unconfigured = fixtureProject(undefined)

  // When
  const outputs = [
    runHook(configured, submit('What does the Initech README say?')).stdout,
    runHook(unconfigured, submit('Fix the failing invoice test')).stdout,
    runHook(configured, submit('   ')).stdout,
  ]

  // Then
  assert.deepEqual(outputs, ['', '', ''])
})

test('unreadable input fails open instead of blocking the prompt', () => {
  // Given
  const project = fixtureProject(configOf(`{}`))

  // When
  const { status, stdout } = runHook(project, 'not json')

  // Then
  assert.equal(status, 0)
  assert.equal(stdout, '')
})

test('an e2e prompt in a web-e2e project is reminded of the Playwright practices', () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'web-e2e': { roots: ['acme-web'] } } }`), ['acme-web'])

  // When
  const context = injected(project, 'Write a Playwright check that the Acme invoice list loads')

  // Then
  assert.match(context, /^- \/web-e2e:playwright-best-practices — /m)
})
