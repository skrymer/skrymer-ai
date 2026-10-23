#!/usr/bin/env node
/**
 * PreToolUse hook (Bash): refuses a shell command that writes a TDD-gated file. Probity judges
 * RED and GREEN on Write and Edit only, so a `sed -i`, a redirect, a `tee`, a `cp` or `mv`
 * onto the file, or an inline script that writes it would land unjudged. Which files are
 * gated comes from the merged project config, the same list the TDD gate reads.
 *
 * Fails open on any error: a gate that cannot read its input never blocks.
 */

import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const PATH_TOKEN = /[\w./~@+-]+\.\w+\b/g

const CD = /\bcd\s+(['"]?)([^\s;&|'"]+)\1/g

/**
 * Whether [token], a path as the command names it, is a gated file of the project, read
 * from the shell's directory or from any directory the command changes into.
 */
function isGated(token, command, { projectDir, cwd, globs }) {
  const dirs = [cwd, ...[...command.matchAll(CD)].map(([, , dir]) => resolve(cwd, dir))]
  return dirs.some((dir) => {
    const inProject = relative(projectDir, resolve(dir, token))
    if (inProject.startsWith('..') || isAbsolute(inProject)) return false
    return globs.some((glob) => matchesGlob(inProject, glob))
  })
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A redirect, `tee`, or `sed -i` aimed at [path]. */
const writesWithShell = (segment, path) =>
  new RegExp(`(?:>>?|\\btee\\b(?:\\s+-a)?)\\s*['"]?${escape(path)}`).test(segment) ||
  (/\bsed\b[^|]*\s-i/.test(segment) && segment.includes(path))

/** `cp`, `mv` or `install` whose destination is [path]. */
const copiesOnto = (segment, path) =>
  /\b(?:cp|mv|install)\b/.test(segment) && segment.trim().split(/\s+/).at(-1)?.replace(/['"]/g, '') === path

const SCRIPT_WRITE = /open\(([^)]*)['"][wa]\+?['"]|\.write_text\(|writeFile(?:Sync)?\(([^,)]*)/g

/**
 * An inline Python or Node script that names [path] and writes a file it does not name as a
 * literal ungated path. A variable, an expression or a `Path(...).write_text` target is
 * taken as possibly the gated file.
 */
function scriptWrites(command, path, scope) {
  if (!/\b(?:python3?|node)\b/.test(command) || !command.includes(path)) return false
  return [...command.matchAll(SCRIPT_WRITE)].some(([, openArgs, writeFileTarget]) => {
    const literal = (openArgs ?? writeFileTarget ?? '').match(/^\s*['"]([^'"]+)['"]/)
    return literal === null || isGated(literal[1], command, scope)
  })
}

/** Quoted strings, or the operators that separate commands outside them. */
const SEPARATOR_OR_QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"|;|&&|\|\||\|/g

/**
 * The commands a line holds. A `;` inside a quoted `sed` script is not a separator; every
 * line still is, so a stray quote cannot run past it.
 */
const segmentsOf = (command) =>
  command.split('\n').flatMap((line) => {
    const segments = []
    let start = 0
    for (const match of line.matchAll(SEPARATOR_OR_QUOTED)) {
      if (/^['"]/.test(match[0])) continue
      segments.push(line.slice(start, match.index))
      start = match.index + match[0].length
    }
    return [...segments, line.slice(start)]
  })

function offendingPaths(command, scope) {
  const offending = new Set()
  for (const segment of segmentsOf(command)) {
    for (const path of segment.match(PATH_TOKEN) ?? []) {
      if (isGated(path, command, scope) && (writesWithShell(segment, path) || copiesOnto(segment, path))) offending.add(path)
    }
  }
  for (const path of command.match(PATH_TOKEN) ?? []) {
    if (isGated(path, command, scope) && scriptWrites(command, path, scope)) offending.add(path)
  }
  return [...offending]
}

async function main() {
  const payload = JSON.parse(readFileSync(0, 'utf8'))
  const command = payload?.tool_input?.command
  if (typeof command !== 'string') return
  const projectDir = process.env.CLAUDE_PROJECT_DIR
  const { config, errors } = await loadConfig(projectDir, PLUGIN_ROOT)
  if (errors) {
    const message = `skrymer-ai: the gated-write guard is off until the project config is fixed:\n${errors.join('\n')}`
    process.stdout.write(JSON.stringify({ systemMessage: message }))
    return
  }
  if (!config) return
  const offending = offendingPaths(command, { projectDir, cwd: payload.cwd ?? projectDir, globs: config.tdd.files })
  if (offending.length === 0) return
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Project convention: ${offending.join(', ')} is TDD-gated, and Probity judges only Write ` +
          'and Edit, so write it with Edit/Write, not a shell command. To change a copy, write it ' +
          'outside the gated trees, such as an absolute /tmp/ path named as a literal. An inline ' +
          'script that only reads the file can run from a script file instead.',
      },
    })
  )
}

try {
  await main()
} catch {
  // Fail open: a gate that cannot read its input must not block a command.
}
