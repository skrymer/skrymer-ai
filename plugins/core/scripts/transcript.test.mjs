import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git, runScript } from './git-fixture.mjs'

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
  const dir = join(mkdtempSync(join(tmpdir(), 'transcript-session-')), 'subagents')
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
  const dir = mkdtempSync(join(tmpdir(), 'transcript-project-'))
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
  assert.equal(stdout, `agent: core:adversary\n--- brief\n${BRIEF}--- hand-back\n${REPORT}\n`)
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
