import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'skill-gate.mjs')

/** A temp project holding [config] as its project config and an empty directory per root. */
function fixtureProject(config, roots = []) {
  const dir = mkdtempSync(join(tmpdir(), 'skill-gate-project-'))
  for (const root of roots) mkdirSync(join(dir, root), { recursive: true })
  if (config !== undefined) {
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude', 'skrymer-ai.config.mjs'), config)
  }
  return dir
}

const kotlinConfig = (...roots) => `
import { defineConfig } from 'skrymer-ai'

export default defineConfig({
  stacks: { 'kotlin-spring': { roots: ${JSON.stringify(roots)} } },
})
`

/** One transcript line: an assistant turn invoking [skill] with the Skill tool. */
const skillCall = (skill) =>
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] },
  })

const transcript = (...lines) => lines.join('\n') + '\n'

/** Runs the hook on a Write of [file] in [project], in a session whose transcript is [text]. */
function runHook(project, file, text = transcript()) {
  const transcriptPath = join(mkdtempSync(join(tmpdir(), 'skill-gate-session-')), 'session.jsonl')
  writeFileSync(transcriptPath, text)
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: join(project, file), content: '' },
      transcript_path: transcriptPath,
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout }
}

test('a Kotlin test under a kotlin-spring root is denied until kotlin-spring:backend-dev is loaded', () => {
  // Given
  const project = fixtureProject(kotlinConfig('acme-api'), ['acme-api'])

  // When
  const { status, stdout } = runHook(project, 'acme-api/src/test/kotlin/com/acme/InvoiceTest.kt')

  // Then
  assert.equal(status, 0)
  const out = JSON.parse(stdout).hookSpecificOutput
  assert.equal(out.hookEventName, 'PreToolUse')
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /\/kotlin-spring:backend-dev/)
  assert.match(out.permissionDecisionReason, /InvoiceTest\.kt/)
})

test('a project rule adds its skills on top of the pack defaults', () => {
  // Given
  const project = fixtureProject(
    `
import { defineConfig } from 'skrymer-ai'

export default defineConfig({
  stacks: { 'kotlin-spring': { roots: ['acme-api'] } },
  skills: {
    files: [
      {
        id: 'invoicing',
        path: /acme-api\\/src\\/.*\\/invoicing\\//,
        skills: ['invoicing-rules'],
        why: 'Invoices round the way the ledger does.',
      },
    ],
  },
})
`,
    ['acme-api']
  )

  // When
  const { stdout } = runHook(
    project,
    'acme-api/src/test/kotlin/com/acme/invoicing/InvoiceTest.kt',
    transcript(skillCall('kotlin-spring:backend-dev'))
  )

  // Then
  const reason = JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason
  assert.match(reason, /\/invoicing-rules/)
  assert.doesNotMatch(reason, /backend-dev/)
})

test('Kotlin main source under a kotlin-spring root needs the playbook too, and the root anchors the path', () => {
  // Given
  const project = fixtureProject(kotlinConfig('acme-api', 'globex-worker'), ['acme-api', 'globex-worker'])

  // When
  const source = runHook(project, 'globex-worker/src/main/kotlin/com/globex/Scheduler.kt')
  const outsideRoots = runHook(project, 'initech-tools/src/main/kotlin/com/initech/Tool.kt')

  // Then
  assert.match(JSON.parse(source.stdout).hookSpecificOutput.permissionDecisionReason, /\/kotlin-spring:backend-dev/)
  assert.deepEqual(outsideRoots, { status: 0, stdout: '' })
})

test('a worktree-scoped copy satisfies a project skill, but a plugin skill needs its own namespace', () => {
  // Given
  const project = fixtureProject(
    `
import { defineConfig } from 'skrymer-ai'

export default defineConfig({
  stacks: { 'kotlin-spring': { roots: ['acme-api'] } },
  skills: { files: [{ id: 'invoicing', path: /invoicing\\//, skills: ['invoicing-rules'], why: 'x' }] },
})
`,
    ['acme-api']
  )

  // When
  const { stdout } = runHook(
    project,
    'acme-api/src/main/kotlin/com/acme/invoicing/Invoice.kt',
    transcript(skillCall('.claude/worktrees/acme-slice:invoicing-rules'), skillCall('backend-dev'))
  )

  // Then
  const reason = JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason
  assert.match(reason, /\/kotlin-spring:backend-dev/)
  assert.doesNotMatch(reason, /invoicing-rules/)
})

test('a write whose skills are all loaded passes silently', () => {
  // Given
  const project = fixtureProject(kotlinConfig('acme-api'), ['acme-api'])

  // When
  const result = runHook(
    project,
    'acme-api/src/test/kotlin/com/acme/InvoiceTest.kt',
    transcript(skillCall('kotlin-spring:backend-dev'))
  )

  // Then
  assert.deepEqual(result, { status: 0, stdout: '' })
})

test('a skill loaded before the last compaction no longer counts', () => {
  // Given
  const project = fixtureProject(kotlinConfig('acme-api'), ['acme-api'])
  const compaction = JSON.stringify({ type: 'system', subtype: 'compact_boundary' })

  // When
  const { stdout } = runHook(
    project,
    'acme-api/src/test/kotlin/com/acme/InvoiceTest.kt',
    transcript(skillCall('kotlin-spring:backend-dev'), compaction, '{not json')
  )

  // Then
  assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'deny')
})

test("a subagent's write is judged by the skills the subagent loaded, not its parent's", () => {
  // Given
  const project = fixtureProject(kotlinConfig('acme-api'), ['acme-api'])
  const session = mkdtempSync(join(tmpdir(), 'skill-gate-session-'))
  const parent = join(session, 'session.jsonl')
  writeFileSync(parent, transcript())
  mkdirSync(join(session, 'session', 'subagents'), { recursive: true })
  writeFileSync(join(session, 'session', 'subagents', 'agent-a1b2.jsonl'), transcript(skillCall('kotlin-spring:backend-dev')))
  const hook = (agentId) =>
    spawnSync('node', [HOOK], {
      input: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: join(project, 'acme-api/src/test/kotlin/com/acme/InvoiceTest.kt') },
        transcript_path: parent,
        agent_id: agentId,
      }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      encoding: 'utf8',
    }).stdout

  // When
  const subagent = hook('a1b2')
  const parentSession = hook(undefined)

  // Then
  assert.equal(subagent, '')
  assert.match(parentSession, /"permissionDecision":"deny"/)
})

test('a project with no config, or one that fails validation, is never blocked', () => {
  // Given
  const unadopted = fixtureProject(undefined, ['acme-api'])
  const misconfigured = fixtureProject(kotlinConfig('globex-api'), ['acme-api'])

  // When
  const results = [unadopted, misconfigured].map((project) =>
    runHook(project, 'acme-api/src/test/kotlin/com/acme/InvoiceTest.kt')
  )

  // Then
  assert.deepEqual(results, [
    { status: 0, stdout: '' },
    { status: 0, stdout: '' },
  ])
})

test('a transcript it cannot read lets the write through', () => {
  // Given
  const project = fixtureProject(kotlinConfig('acme-api'), ['acme-api'])

  // When
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: join(project, 'acme-api/src/test/kotlin/com/acme/InvoiceTest.kt') },
      transcript_path: '/nonexistent/session.jsonl',
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    encoding: 'utf8',
  })

  // Then
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})
