import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'session-context.mjs')
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A temp project holding [config] as its project config and an empty directory per path in [dirs]. */
function fixtureProject(config, dirs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'session-context-project-'))
  for (const path of dirs) mkdirSync(join(dir, path), { recursive: true })
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

/** Runs the hook on [input] in [project], returning its exit status and stdout. */
function runHook(project, input = JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' })) {
  const result = spawnSync('node', [HOOK], { input, env: { ...process.env, CLAUDE_PROJECT_DIR: project }, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout }
}

test('a valid config starts the session with its tracker, label mapping and domain contexts', () => {
  // Given
  const project = fixtureProject(
    configOf(`{ tracker: { kind: 'local', labels: { 'needs-triage': 'triage' } }, domain: { contexts: ['acme-api', 'acme-web'] } }`),
    ['acme-api', 'acme-web']
  )

  // When
  const { status, stdout } = runHook(project)

  // Then
  assert.equal(status, 0)
  const output = JSON.parse(stdout).hookSpecificOutput
  assert.equal(output.hookEventName, 'SessionStart')
  assert.equal(
    output.additionalContext,
    [
      '## skrymer-ai project context',
      '',
      `- Issue tracker: local markdown files under .scratch/. How to use it: ${join(PLUGIN_ROOT, 'reference', 'issue-tracker-local.md')}`,
      '- Triage labels (role → label): bug → bug, enhancement → enhancement, needs-triage → triage, needs-info → needs-info, ready-for-agent → ready-for-agent, ready-for-human → ready-for-human, wontfix → wontfix',
      `- Domain contexts: \`acme-api\`, \`acme-web\`. Each holds a CONTEXT.md glossary and a docs/adr/. How to read them: ${join(PLUGIN_ROOT, 'reference', 'domain-docs.md')}`,
    ].join('\n')
  )
})

test('an invalid tracker or domain block starts the session with the config errors, and no context block', () => {
  // Given
  const project = fixtureProject(configOf(`{ tracker: { labels: { 'needs-review': 'review' } }, domain: { contexts: ['globex-web'] } }`))

  // When
  const { status, stdout } = runHook(project)

  // Then
  assert.equal(status, 0)
  assert.deepEqual(JSON.parse(stdout), {
    systemMessage: [
      'skrymer-ai: the project config has errors, so skills get no tracker or domain context until it is fixed:',
      'tracker.labels: there is no role "needs-review". Roles: bug, enhancement, needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix.',
      'domain.contexts: "globex-web" does not exist in the project.',
    ].join('\n'),
  })
})

test('a project without a config, or unreadable input, starts the session silently', () => {
  // Given
  const unconfigured = fixtureProject(undefined)
  const configured = fixtureProject(configOf(`{}`))

  // When
  const results = [runHook(unconfigured), runHook(configured, 'not json')]

  // Then
  assert.deepEqual(results, [
    { status: 0, stdout: '' },
    { status: 0, stdout: '' },
  ])
})
