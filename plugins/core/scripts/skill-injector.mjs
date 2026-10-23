#!/usr/bin/env node
/**
 * UserPromptSubmit hook: reminds Claude of the skills that cover what a prompt is about,
 * before it starts the work. The rules are the merged config's `skills.prompts`: the
 * packs', then the project's, then core's own.
 *
 * Advisory only. It never blocks a prompt and it fails open on any error.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { escapeRegex, loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** How many reminders one prompt may produce. Rules come packs first and core last, so the cap drops core's general ones first. */
const MAX_REMINDERS = 3

/** The skills [prompt] should be reminded of, each with the reasons of every rule naming it. */
function selectSkills(rules, prompt) {
  const bySkill = new Map()
  for (const rule of rules) {
    if (!rule.pattern.test(prompt)) continue
    for (const skill of rule.skills) {
      if (alreadyInvoked(prompt, skill)) continue
      const reminder = bySkill.get(skill) ?? { skill, whys: [], worktreeScoped: false }
      reminder.whys.push(rule.why)
      reminder.worktreeScoped ||= rule.worktreeScoped === true
      bySkill.set(skill, reminder)
    }
  }
  return [...bySkill.values()].slice(0, MAX_REMINDERS)
}

/** Whether [prompt] invokes [skill] itself, by its full name or a plugin skill's short one. */
function alreadyInvoked(prompt, skill) {
  const names = [skill, skill.split(':').pop()].map(escapeRegex).join('|')
  return new RegExp(`(^|\\s)/(?:${names})(?![\\w:-])`, 'i').test(prompt)
}

function render(reminders) {
  return [
    'Project convention: these skills cover what this prompt is about.',
    'Invoke each with the Skill tool BEFORE starting the work:',
    ...reminders.map(
      ({ skill, whys, worktreeScoped }) =>
        `- /${skill} — ${whys.join(' Also ')}${worktreeScoped ? ' In a worktree, invoke its scoped copy.' : ''}`
    ),
  ].join('\n')
}

async function main() {
  const payload = JSON.parse(readFileSync(0, 'utf8'))
  const prompt = payload?.prompt
  if (typeof prompt !== 'string' || !prompt.trim()) return
  const { config, errors } = await loadConfig(process.env.CLAUDE_PROJECT_DIR, PLUGIN_ROOT)
  if (errors) {
    const message = `skrymer-ai: the skill injector is off until the project config is fixed:\n${errors.join('\n')}`
    process.stdout.write(JSON.stringify({ systemMessage: message }))
    return
  }
  if (!config) return
  const reminders = selectSkills(config.skills.prompts, prompt)
  if (reminders.length === 0) return
  process.stdout.write(
    JSON.stringify({
      systemMessage: `skill-injector: ${reminders.map((r) => r.skill).join(', ')}`,
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: render(reminders) },
    })
  )
}

try {
  await main()
} catch {
  // Fail open: a hook that cannot read its input must not block a prompt.
}
