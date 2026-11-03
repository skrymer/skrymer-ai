import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git, runScript } from './git-fixture.mjs'
import { tempDir } from './temp-dir.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'transcript.mjs')

const BRIEF = 'Repo: /work/acme (the main checkout; stay in it).\nWhat it does: The cart total starts at 1.\n'
const REPORT = '1. Strongest argument: none holds.\n3. Verdict: SHOULD MERGE'

/** A line of a session JSONL. */
const line = (entry) => `${JSON.stringify({ isSidechain: true, agentId: 'a1b2', ...entry })}\n`

/**
 * A subagent transcript as Claude Code writes it, with its meta file beside it: [brief] as the
 * first user message, a tool call, the hand-back through the SubagentHandback tool carrying
 * [report], and a closing text line. [agentType] goes in the meta, unless it is null.
 */
function transcript({ brief = BRIEF, report = REPORT, agentType = 'core:adversary', handback = true } = {}) {
  const dir = join(tempDir('transcript-session-'), 'subagents')
  mkdirSync(dir)
  const path = join(dir, 'agent-a1b2.jsonl')
  const assistant = (content) => line({ type: 'assistant', message: { role: 'assistant', content } })
  writeFileSync(
    path,
    line({ type: 'user', message: { role: 'user', content: brief } }) +
      assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git diff' } }]) +
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'diff' }] } }) +
      (handback ? assistant([{ type: 'tool_use', id: 't2', name: 'SubagentHandback', input: { message: report } }]) : '') +
      assistant([{ type: 'text', text: 'Report delivered.' }])
  )
  if (agentType !== null) writeFileSync(join(dir, 'agent-a1b2.meta.json'), JSON.stringify({ agentType, description: 'Attack the change' }))
  return path
}

/** A git project holding the adversary brief the renderer saved. */
function project(saved = BRIEF) {
  const dir = tempDir('transcript-project-')
  git(dir, 'init', '-q', '-b', 'main')
  mkdirSync(join(dir, '.git', 'skrymer-ai', 'sign-off', 'briefs'), { recursive: true })
  writeFileSync(join(dir, '.git', 'skrymer-ai', 'sign-off', 'briefs', 'adversary.txt'), saved)
  return dir
}

test('the report prints the agent type, the brief it was sent and its hand-back, not its closing text', () => {
  // Given an adversary's transcript
  const path = transcript()

  // When it is reported
  const { status, stdout } = runScript(SCRIPT, project(), [path])

  // Then the type, the brief and the hand-back are printed, and the closing text line is not
  assert.equal(status, 0)
  assert.equal(stdout, `agent: core:adversary\ntranscript: ${path}\n--- brief\n${BRIEF}--- hand-back\n${REPORT}\n--- tool calls\nBash: git diff\nSubagentHandback\n`)
})

test('check passes an agent launched as its definition with the brief rendered for it', () => {
  // Given a transcript whose brief is the one the renderer saved
  const path = transcript()

  // When it is checked as the adversary
  const result = runScript(SCRIPT, project(), ['check', path, 'adversary'])

  // Then it passes
  assert.deepEqual([result.status, result.stdout], [0, `ok: ${path} ran as core:adversary with its rendered brief.\n`])
})

test('check rejects a brief that differs from its template, showing the diff', () => {
  // Given a transcript whose brief gained a line of the author's defence
  const path = transcript({ brief: `${BRIEF}This is the correct fix for the rounding bug.\n` })

  // When it is checked
  const { status, stdout } = runScript(SCRIPT, project(), ['check', path, 'adversary'])

  // Then it is rejected with the line that differs
  assert.equal(status, 1)
  assert.match(stdout, /^REJECTED: .*agent-a1b2\.jsonl: the brief it was sent differs from the one rendered for adversary\.\n/)
  assert.match(stdout, /\n\+This is the correct fix for the rounding bug\.\n/)
})

test('check rejects a missing transcript, a fork, a general-purpose agent, and one with no hand-back', () => {
  // Given a transcript path that doesn't exist, a fork's, a general-purpose agent's, and one that never handed back
  const dir = project()
  const fork = transcript({ agentType: 'fork' })
  const general = transcript({ agentType: 'general-purpose' })
  const silent = transcript({ handback: false })

  // When each is checked as the adversary
  const results = [join(dir, 'gone.jsonl'), fork, general, silent].map((path) => runScript(SCRIPT, dir, ['check', path, 'adversary']))

  // Then each is rejected with why
  assert.deepEqual(
    results.map(({ status, stdout }) => [status, stdout]),
    [
      [1, `REJECTED: no transcript at ${join(dir, 'gone.jsonl')}. Every judging agent leaves one; re-run it.\n`],
      [1, `REJECTED: ${fork}: launched as a fork, not as core:adversary. A fork carries the author's conversation; re-run it as core:adversary.\n`],
      [1, `REJECTED: ${general}: launched as general-purpose, not as core:adversary. Re-run it as core:adversary.\n`],
      [1, `REJECTED: ${silent}: it never handed back through SubagentHandback, so there is no report to judge.\n`],
    ]
  )
})

test('check passes a brief sent without the rendered brief’s final newline, which the Bash tool strips', () => {
  // Given a transcript whose brief is the rendered one less its trailing newline, as the conductor saw it
  const path = transcript({ brief: BRIEF.replace(/\n$/, '') })

  // When it is checked as the adversary
  const result = runScript(SCRIPT, project(), ['check', path, 'adversary'])

  // Then it passes, since only the invisible final newline differs
  assert.deepEqual([result.status, result.stdout], [0, `ok: ${path} ran as core:adversary with its rendered brief.\n`])
})

test('check finds the rendered brief when the project sits below its repo’s top', () => {
  // Given a repo whose project lives in app/, the brief saved in the repo's git dir
  const repo = project()
  const app = join(repo, 'app')
  mkdirSync(app)
  const path = transcript()

  // When the check runs from the project
  const result = runScript(SCRIPT, app, ['check', path, 'adversary'])

  // Then it finds the brief the renderer saved at the repo top's git dir
  assert.deepEqual([result.status, result.stdout], [0, `ok: ${path} ran as core:adversary with its rendered brief.\n`])
})

test('the report keeps every hand-back of an agent continued with a follow-up', () => {
  // Given a transcript with a second hand-back after a follow-up message
  const path = transcript()
  writeFileSync(path, readFileSync(path, 'utf8') + line({ type: 'user', message: { role: 'user', content: 'Test the null id too.' } }) + line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'SubagentHandback', input: { message: '4. Null ids: refused.' } }] } }))

  // When it is reported
  const { status, stdout } = runScript(SCRIPT, project(), [path])

  // Then both hand-backs are printed, in order
  assert.equal(status, 0)
  assert.match(stdout, new RegExp(`\n--- hand-back\n${REPORT}\n--- hand-back\n4\\. Null ids: refused\.\n--- tool calls\n`))
})

test('the report names the raw transcript and lists every tool call, so a read-only breach shows', () => {
  // Given a transcript whose agent ran git diff and then edited a file
  const path = transcript()
  writeFileSync(path, readFileSync(path, 'utf8') + line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't4', name: 'Edit', input: { file_path: '/work/acme/web/app/cart.ts', old_string: '0', new_string: '1' } }] } }))

  // When it is reported
  const { status, stdout } = runScript(SCRIPT, project(), [path])

  // Then the raw transcript's path and each call, the edit among them, are printed
  assert.equal(status, 0)
  assert.match(stdout, new RegExp(`^agent: core:adversary\\ntranscript: ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`))
  assert.match(stdout, /\n--- tool calls\nBash: git diff\nSubagentHandback\nEdit: \/work\/acme\/web\/app\/cart\.ts\n/)
})
