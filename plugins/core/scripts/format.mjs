#!/usr/bin/env node
/**
 * PostToolUse hook: formats a file Claude has just written or edited with the formatter of the
 * stack whose root holds it, so the output matches the project's own style config. Which files
 * get which commands comes from the merged project config: each format group whose globs match
 * the file, relative to the root, runs its commands in turn, in the root, with the file's path
 * appended.
 *
 * Best-effort and silent: a formatter that fails or is missing is skipped, and the hook never
 * blocks. The enforced gates are the project's own pre-commit hook and CI.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, matchesGlob, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COMMAND_TIMEOUT_MS = 25_000

/** [file] relative to [dir], or null when it lies outside it. */
function inside(dir, file) {
  const path = relative(dir, file)
  return path.startsWith('..') || isAbsolute(path) ? null : path
}

async function main() {
  const payload = JSON.parse(readFileSync(0, 'utf8'))
  const filePath = payload?.tool_input?.file_path
  if (typeof filePath !== 'string' || !existsSync(filePath)) return
  const projectDir = process.env.CLAUDE_PROJECT_DIR
  const { config } = await loadConfig(projectDir, PLUGIN_ROOT)
  if (!config) return
  for (const { root, groups } of config.format) {
    const rootDir = join(projectDir, root)
    const inRoot = inside(rootDir, filePath)
    if (inRoot === null) continue
    for (const group of groups) {
      if (!group.files.some((glob) => matchesGlob(inRoot, glob))) continue
      for (const [command, ...args] of group.run) {
        spawnSync(command, [...args, filePath], { cwd: rootDir, stdio: 'ignore', timeout: COMMAND_TIMEOUT_MS })
      }
    }
  }
}

try {
  await main()
} catch {
  // Best-effort: a formatter hook that cannot read its input leaves the file as written.
}
