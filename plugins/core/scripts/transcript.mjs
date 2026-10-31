#!/usr/bin/env node
/**
 * Reads a sign-off agent's transcript, the session JSONL Claude Code writes for a subagent, so
 * no one retypes a filter to see what an agent was sent and what it said.
 *
 *   node transcript.mjs <transcript>
 *       prints the type the agent ran as, the brief it was sent and its hand-back. The report
 *       an agent returns goes through the SubagentHandback tool, not its text blocks, so a
 *       closing text line is never mistaken for it.
 *   node transcript.mjs check <transcript> <agent> [--label <name>]
 *       fails unless the transcript exists, the agent ran as `core:<agent>` (not a fork, not a
 *       general-purpose subagent), it handed back, and the brief it was sent is, byte for byte,
 *       the one `brief.mjs` rendered and saved for it in the repo's git dir.
 *
 * The agent's type is in the `.meta.json` file Claude Code writes beside each transcript.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const SCRIPT = fileURLToPath(import.meta.url)
const HANDBACK = 'SubagentHandback'

class Stop extends Error {}
class Rejected extends Error {}

function main(argv, projectDir) {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { label: { type: 'string' } } })
  if (positionals.length === 1) return report(readTranscript(positionals[0]))
  if (positionals[0] === 'check' && positionals.length === 3) return check(projectDir, positionals[1], positionals[2], values.label)
  throw new Stop('usage: transcript.mjs <transcript> | check <transcript> <agent> [--label <name>]')
}

function report({ agentType, brief, handback }) {
  process.stdout.write(`agent: ${agentType ?? 'unknown (no meta file)'}\n--- brief\n${brief.endsWith('\n') ? brief : `${brief}\n`}--- hand-back\n${handback ?? '(none: the agent never handed back)'}\n`)
}

function check(projectDir, path, agent, label) {
  if (!existsSync(path)) throw new Rejected(`no transcript at ${path}. Every judging agent leaves one; re-run it.`)
  const { agentType, brief, handback } = readTranscript(path)
  const want = `core:${agent}`
  if (agentType === 'fork') throw new Rejected(`${path}: launched as a fork, not as ${want}. A fork carries the author's conversation; re-run it as ${want}.`)
  if (agentType !== want) throw new Rejected(`${path}: launched as ${agentType ?? 'an unknown type (no meta file)'}, not as ${want}. Re-run it as ${want}.`)
  if (handback === null) throw new Rejected(`${path}: it never handed back through ${HANDBACK}, so there is no report to judge.`)
  const name = label ? `${agent}-${label}` : agent
  const top = git(projectDir, 'rev-parse', '--show-toplevel')
  const saved = join(resolve(top, git(projectDir, 'rev-parse', '--git-path', 'skrymer-ai/sign-off')), 'briefs', `${name}.txt`)
  if (!existsSync(saved)) throw new Rejected(`${path}: no brief was rendered for ${name}, so the one it was sent can't be checked. Render it with brief.mjs ${agent}.`)
  const rendered = readFileSync(saved, 'utf8')
  if (brief !== rendered) throw new Rejected(`${path}: the brief it was sent differs from the one rendered for ${name}.\n${diff(rendered, brief)}`)
  process.stdout.write(`ok: ${path} ran as ${want} with its rendered brief.\n`)
}

/** The agent type, the brief and the last hand-back of the transcript at [path]. */
function readTranscript(path) {
  if (!existsSync(path)) throw new Stop(`no transcript at ${path}.`)
  const real = realpathSync(path)
  const entries = readFileSync(real, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((text) => {
      try {
        return [JSON.parse(text)]
      } catch {
        return []
      }
    })
  const first = entries.find((entry) => entry.type === 'user')
  const content = first?.message?.content
  const brief = typeof content === 'string' ? content : (content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('')
  const handbacks = entries
    .filter((entry) => entry.type === 'assistant' && Array.isArray(entry.message?.content))
    .flatMap((entry) => entry.message.content.filter((block) => block.type === 'tool_use' && block.name === HANDBACK))
  const meta = real.replace(/\.jsonl$/, '.meta.json')
  const agentType = existsSync(meta) ? (JSON.parse(readFileSync(meta, 'utf8')).agentType ?? null) : null
  return { agentType, brief, handback: handbacks.at(-1)?.input?.message ?? null }
}

/** [after] against [before] as a unified diff of the two briefs. */
function diff(before, after) {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-diff-'))
  try {
    writeFileSync(join(dir, 'rendered'), before)
    writeFileSync(join(dir, 'sent'), after)
    const { stdout } = spawnSync('git', ['diff', '--no-index', '--no-color', '--', 'rendered', 'sent'], { cwd: dir, encoding: 'utf8' })
    return stdout.slice(stdout.indexOf('\n--- ') + 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (run.status !== 0) throw new Stop(`git ${args[0]}: ${run.stderr.trim().split('\n').at(-1)}`)
  return run.stdout.trim()
}

if (process.argv[1] === SCRIPT) {
  try {
    main(process.argv.slice(2), process.cwd())
  } catch (error) {
    if (error instanceof Rejected) process.stdout.write(`REJECTED: ${error.message}\n`)
    else process.stdout.write(error instanceof Stop ? `STOP: ${error.message}\n` : `transcript failed: ${error.stack}\n`)
    process.exitCode = 1
  }
}
