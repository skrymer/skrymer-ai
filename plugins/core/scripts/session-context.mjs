#!/usr/bin/env node
/**
 * SessionStart hook: tells the session which issue tracker the project uses, its label for
 * each triage role, and where its domain docs live. The process skills read this block; the
 * conventions for each tracker, and for reading domain docs, are core's reference files.
 *
 * Fails open on any error: a session always starts.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const TRACKERS = {
  github: 'GitHub Issues, through the gh CLI',
  local: 'local markdown files under .scratch/',
}

function render({ tracker, domain }) {
  const reference = (file) => join(PLUGIN_ROOT, 'reference', file)
  const labels = Object.entries(tracker.labels).map(([role, label]) => `${role} → ${label}`)
  return [
    '## skrymer-ai project context',
    '',
    `- Issue tracker: ${TRACKERS[tracker.kind]}. How to use it: ${reference(`issue-tracker-${tracker.kind}.md`)}`,
    `- Triage labels (role → label): ${labels.join(', ')}`,
    `- Domain contexts: ${domain.contexts.map((context) => `\`${context}\``).join(', ')}. Each holds a CONTEXT.md glossary and a docs/adr/. ` +
      `How to read them: ${reference('domain-docs.md')}`,
  ].join('\n')
}

async function main() {
  JSON.parse(readFileSync(0, 'utf8'))
  const { config, errors } = await loadConfig(process.env.CLAUDE_PROJECT_DIR, PLUGIN_ROOT)
  if (errors) {
    const message =
      'skrymer-ai: the project config has errors, so skills get no tracker or domain context until it is fixed:\n' +
      errors.join('\n')
    process.stdout.write(JSON.stringify({ systemMessage: message }))
    return
  }
  if (!config) return
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: render(config) } })
  )
}

try {
  await main()
} catch {
  // Fail open: a session must start even when this hook cannot.
}
