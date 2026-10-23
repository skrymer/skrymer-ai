#!/usr/bin/env node
/**
 * PreToolUse hook: refuses a write to a file whose skills this session has not loaded. The
 * prompt-time skill injector only sees the words of a prompt, so a session started from a
 * pasted path or a handoff, or a test written an hour in, is never reminded; this sees the
 * file instead. Which files need which skills comes from the merged project config.
 *
 * Fails open on any error: a gate that cannot read its input never blocks.
 */

import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The skills the session has loaded since its last compaction, as the Skill tool named them. */
function loadedSkills(transcriptText) {
  const loaded = new Set()
  for (const line of transcriptText.split('\n')) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (isCompaction(entry)) loaded.clear()
    const content = entry?.message?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part?.type === 'tool_use' && part.name === 'Skill' && typeof part.input?.skill === 'string') {
        loaded.add(part.input.skill)
      }
    }
  }
  return loaded
}

/** A compaction clears the loaded skills, because its summary does not carry a skill's text forward. */
function isCompaction(entry) {
  return entry?.isCompactSummary === true || (entry?.type === 'system' && entry?.subtype === 'compact_boundary')
}

/**
 * A plugin skill (`plugin:name`) counts only under its own namespace; a project skill also
 * counts as a worktree-scoped copy (`<dir>:name`).
 */
function isLoaded(skill, loaded) {
  if (skill.includes(':')) return loaded.has(skill)
  return [...loaded].some((name) => name === skill || name.endsWith(`:${skill}`))
}

function requiredSkills(rules, filePath) {
  return [...new Set(rules.filter((rule) => rule.path.test(filePath)).flatMap((rule) => rule.skills))]
}

/**
 * The transcript of whoever is writing. A subagent's hook is handed its parent's
 * `transcript_path` plus its own `agent_id`, and keeps its own record beside the parent's,
 * under `<session>/subagents/agent-<id>.jsonl`.
 */
function transcriptOf(payload) {
  const parent = payload.transcript_path
  if (!payload.agent_id) return parent
  return join(parent.replace(/\.jsonl$/, ''), 'subagents', `agent-${payload.agent_id}.jsonl`)
}

async function main() {
  const payload = JSON.parse(readFileSync(0, 'utf8'))
  const filePath = payload?.tool_input?.file_path
  if (typeof filePath !== 'string') return
  const { config } = await loadConfig(process.env.CLAUDE_PROJECT_DIR, PLUGIN_ROOT)
  if (!config) return
  const required = requiredSkills(config.skills.files, filePath)
  if (required.length === 0) return
  const loaded = loadedSkills(readFileSync(transcriptOf(payload), 'utf8'))
  const missing = required.filter((skill) => !isLoaded(skill, loaded))
  if (missing.length === 0) return
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Project convention: load ${missing.map((s) => `/${s}`).join(' and ')} ` +
          `with the Skill tool before writing ${basename(filePath)}, then retry the edit.`,
      },
    })
  )
}

try {
  await main()
} catch {
  // Fail open: a gate that cannot read its input must not block a write.
}
