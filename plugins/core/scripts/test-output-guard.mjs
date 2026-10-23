#!/usr/bin/env node
/**
 * PreToolUse hook (Bash): refuses a test run whose output is piped through `grep`, `head` or
 * `tail`. Probity judges RED and GREEN from the output the session shows, and a clean red
 * (an assertion failed) differs from a compile error only in detail that a filter drops.
 * Which commands are test runs comes from the enabled packs.
 *
 * Fails open on any error: a gate that cannot read its input never blocks.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const FILTER = /\|\s*(?:grep|head|tail)\b/

/** Whether one command list (no `;`, `&&`, `||` or newline) pipes a test run into a filter. */
function filtersARun(segment, testCommands) {
  const filter = segment.search(FILTER)
  return filter >= 0 && testCommands.some((run) => run.test(segment.slice(0, filter)))
}

async function main() {
  const payload = JSON.parse(readFileSync(0, 'utf8'))
  const command = payload?.tool_input?.command
  if (typeof command !== 'string') return
  const { config, errors } = await loadConfig(process.env.CLAUDE_PROJECT_DIR, PLUGIN_ROOT)
  if (errors) {
    const message = `skrymer-ai: the test-output guard is off until the project config is fixed:\n${errors.join('\n')}`
    process.stdout.write(JSON.stringify({ systemMessage: message }))
    return
  }
  if (!config) return
  if (!command.split(/;|&&|\|\||\n/).some((segment) => filtersARun(segment, config.tdd.testCommands))) return
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Project convention: never filter a test run through grep, head or tail. Probity reads the ' +
          'full output to tell a failing assertion from a compile error. Run it unfiltered, or ' +
          'redirect it to a file and Read that, then retry.',
      },
    })
  )
}

try {
  await main()
} catch {
  // Fail open: a gate that cannot read its input must not block a command.
}
