#!/usr/bin/env node
/**
 * PreToolUse hook (Write, Edit): has Probity judge a write to a TDD-gated file, using the
 * config `core` ships, and answers with Probity's verdict. Which files are gated comes from
 * the merged project config, so Probity starts only for a gated write and the project needs
 * no Probity config or install of its own (ADR 0005).
 *
 * `SKRYMER_AI_PROBITY` names another command to run Probity with, such as a local install.
 *
 * Fails open on any error of its own: a gate that cannot read its input never blocks.
 * Probity's own verdicts, its fail-closed blocks included, pass through unchanged.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, matchesGlob, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROBITY_CONFIG = join(PLUGIN_ROOT, 'scripts', 'probity.config.mjs')
const PROBITY = 'npx -y @nizos/probity@1.10.1'

async function main() {
  const input = readFileSync(0, 'utf8')
  const filePath = JSON.parse(input)?.tool_input?.file_path
  if (typeof filePath !== 'string') return
  const { config, errors } = await loadConfig(process.env.CLAUDE_PROJECT_DIR, PLUGIN_ROOT)
  if (errors) {
    const message = `skrymer-ai: the TDD gate is off until the project config is fixed:\n${errors.join('\n')}`
    process.stdout.write(JSON.stringify({ systemMessage: message }))
    return
  }
  if (!config) return
  const inProject = relative(process.env.CLAUDE_PROJECT_DIR, filePath)
  if (inProject.startsWith('..') || isAbsolute(inProject)) return
  if (!config.tdd.files.some((glob) => matchesGlob(inProject, glob))) return
  const [command, ...args] = (process.env.SKRYMER_AI_PROBITY || PROBITY).split(/\s+/)
  const probity = spawnSync(command, [...args, '--agent', 'claude-code', '--config', PROBITY_CONFIG], {
    input,
    encoding: 'utf8',
  })
  if (probity.error || (probity.status !== 0 && !probity.stdout)) {
    const why = probity.error?.message ?? probity.stderr.trim().split('\n').at(-1)
    process.stdout.write(
      JSON.stringify({ systemMessage: `skrymer-ai: the TDD gate is off for this write: Probity did not run (${why}).` })
    )
    return
  }
  process.stdout.write(probity.stdout)
}

try {
  await main()
} catch {
  // Fail open: a gate that cannot read its input must not block a write.
}
