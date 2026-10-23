import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'test-output-guard.mjs')

/** A temp project whose config enables kotlin-spring under `acme-api`. */
function kotlinProject() {
  const dir = mkdtempSync(join(tmpdir(), 'test-output-guard-project-'))
  mkdirSync(join(dir, 'acme-api'))
  mkdirSync(join(dir, '.claude'))
  writeFileSync(
    join(dir, '.claude', 'skrymer-ai.config.mjs'),
    `import { defineConfig } from 'skrymer-ai'
export default defineConfig({ stacks: { 'kotlin-spring': { roots: ['acme-api'] } } })
`
  )
  return dir
}

/** Runs the hook on a Bash call of [command] in [project]. */
function runHook(project, command) {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: project }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout }
}

test('a Gradle test run piped through tail is denied', () => {
  // Given
  const project = kotlinProject()

  // When
  const { status, stdout } = runHook(project, 'cd acme-api && ./gradlew test | tail')

  // Then
  assert.equal(status, 0)
  const out = JSON.parse(stdout).hookSpecificOutput
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /full output/)
})

for (const command of [
  './gradlew test',
  './gradlew test 2>&1 | tee acme-test.log',
  './gradlew test > acme-test.log; grep -n FAILED acme-test.log',
  'git log --oneline | grep test',
]) {
  test(`\`${command}\` is allowed`, () => {
    // Given
    const project = kotlinProject()

    // When
    const { status, stdout } = runHook(project, command)

    // Then
    assert.equal(status, 0)
    assert.equal(stdout, '')
  })
}

test('a project without a config is left alone', () => {
  // Given
  const project = mkdtempSync(join(tmpdir(), 'test-output-guard-bare-'))

  // When
  const { stdout } = runHook(project, './gradlew test | tail')

  // Then
  assert.equal(stdout, '')
})

test('an invalid config lets the run through and says the guard is off', () => {
  // Given
  const project = kotlinProject()
  writeFileSync(
    join(project, '.claude', 'skrymer-ai.config.mjs'),
    `export default { stacks: { 'initech-stack': { roots: ['acme-api'] } } }`
  )

  // When
  const { stdout } = runHook(project, './gradlew test | tail')

  // Then
  const out = JSON.parse(stdout)
  assert.equal(out.hookSpecificOutput, undefined)
  assert.match(out.systemMessage, /test-output guard is off[\s\S]*initech-stack/)
})

for (const command of [
  './gradlew check 2>&1 | tail -20',
  './gradlew build | head -50',
  './gradlew :acme:test | grep -A5 FAILED',
  './gradlew test |& tail',
  './gradlew test | rg FAIL',
  "./gradlew test | awk '/FAILED/'",
  './gradlew test 2>&1 | tee acme-test.log | tail -5',
]) {
  test(`\`${command}\` is denied`, () => {
    // Given
    const project = kotlinProject()

    // When
    const { stdout } = runHook(project, command)

    // Then
    assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'deny')
  })
}
