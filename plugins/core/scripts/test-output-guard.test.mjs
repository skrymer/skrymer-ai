import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tempDir } from './temp-dir.mjs'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'test-output-guard.mjs')

/** A temp project whose config enables kotlin-spring under `acme-api`. */
function kotlinProject() {
  const dir = tempDir('test-output-guard-project-')
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
  const project = tempDir('test-output-guard-bare-')

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

/** A temp project whose config enables [pack] under `acme-web`. */
function webProject(pack) {
  const dir = tempDir('test-output-guard-project-')
  mkdirSync(join(dir, 'acme-web'))
  mkdirSync(join(dir, '.claude'))
  writeFileSync(join(dir, '.claude', 'skrymer-ai.config.mjs'), `export default { stacks: { ${pack}: { roots: ['acme-web'] } } }\n`)
  return dir
}

for (const pack of ['react', 'nuxt']) {
  for (const command of [
    'pnpm --filter acme-web test | tail -30',
    'pnpm -C acme-web test 2>&1 | tail -30',
    'npm t | tail',
    'yarn workspace acme-web test | head',
    'npm run test -- --run | grep FAIL',
    'pnpm test:unit | tail -30',
    'npm run test:ci 2>&1 | grep FAIL',
    'npm run test-ci | tail',
    '(cd acme-web && pnpm test) | tail',
    "sh -c 'npm test' | tail",
  ]) {
    test(`\`${command}\` is denied under a ${pack} root`, () => {
      // Given a project with a ${pack} root
      const project = webProject(pack)

      // When a filtered, aliased or argument-carrying test run is piped through a truncating command
      const { stdout } = runHook(project, command)

      // Then it is denied
      assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'deny')
    })
  }

  for (const command of ['pnpm add -D @testing-library/react | tail', 'npm install test-utils | tail', 'pnpm typecheck | tail', 'pnpm build --mode test | tail']) {
    test(`\`${command}\` is allowed under a ${pack} root`, () => {
      // Given a project with a ${pack} root
      const project = webProject(pack)

      // When a package-manager command that runs no tests is piped through tail
      const { stdout } = runHook(project, command)

      // Then it passes
      assert.equal(stdout, '')
    })
  }
}
