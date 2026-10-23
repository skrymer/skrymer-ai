import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'tdd-gate.mjs')

/** A temp project gating `acme-api/src/**\/*.kt` through kotlin-spring. */
function acmeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'tdd-gate-project-'))
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

/** A stand-in for Probity that denies, echoing the arguments and the file it was handed. */
function fakeProbity() {
  const script = join(mkdtempSync(join(tmpdir(), 'tdd-gate-probity-')), 'probity.mjs')
  writeFileSync(
    script,
    `import { readFileSync } from 'node:fs'
const payload = JSON.parse(readFileSync(0, 'utf8'))
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
  permissionDecisionReason: 'Probity: ' + process.argv.slice(2).join(' ') + ' ' + payload.tool_input.file_path } }))
`
  )
  return `node ${script}`
}

/** Runs the hook on a Write of [file] in [project], with [probity] as the command that runs Probity. */
function runHook(project, file, probity = fakeProbity()) {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: join(project, file), content: 'class Invoice' },
      transcript_path: join(project, 'session.jsonl'),
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, SKRYMER_AI_PROBITY: probity },
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout }
}

test('a write to a gated file is judged by Probity with core’s config, and its answer is the hook’s', () => {
  // Given
  const project = acmeProject()

  // When
  const { status, stdout } = runHook(project, 'acme-api/src/main/kotlin/Invoice.kt')

  // Then
  assert.equal(status, 0)
  const out = JSON.parse(stdout).hookSpecificOutput
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /--agent claude-code --config \S+\/core\/scripts\/probity\.config\.mjs/)
  assert.match(out.permissionDecisionReason, /acme-api\/src\/main\/kotlin\/Invoice\.kt$/)
})

test('when Probity cannot run, the write goes through and the user is told the gate is off', () => {
  // Given
  const project = acmeProject()

  // When
  const { status, stdout } = runHook(project, 'acme-api/src/main/kotlin/Invoice.kt', 'initech-no-such-probity')

  // Then
  assert.equal(status, 0)
  const out = JSON.parse(stdout)
  assert.equal(out.hookSpecificOutput, undefined)
  assert.match(out.systemMessage, /TDD gate is off for this write: Probity did not run/)
})

for (const file of ['acme-api/build/generated/InvoiceRecord.kt', 'docs/acme-notes.md']) {
  test(`a write outside the gated trees never starts Probity: ${file}`, () => {
    // Given
    const project = acmeProject()

    // When
    const { stdout } = runHook(project, file)

    // Then
    assert.equal(stdout, '')
  })
}

test('a project without a config is left alone', () => {
  // Given
  const project = mkdtempSync(join(tmpdir(), 'tdd-gate-bare-'))

  // When
  const { stdout } = runHook(project, 'src/main/kotlin/Invoice.kt')

  // Then
  assert.equal(stdout, '')
})

test('an invalid config lets the write through and says the TDD gate is off', () => {
  // Given
  const project = acmeProject()
  writeFileSync(join(project, '.claude', 'skrymer-ai.config.mjs'), `export default { tdd: { files: 'globex/**' } }`)

  // When
  const { stdout } = runHook(project, 'acme-api/src/main/kotlin/Invoice.kt')

  // Then
  const out = JSON.parse(stdout)
  assert.equal(out.hookSpecificOutput, undefined)
  assert.match(out.systemMessage, /TDD gate is off[\s\S]*tdd\.files/)
})
