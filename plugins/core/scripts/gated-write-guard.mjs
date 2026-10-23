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
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { escapeRegex, isTddGated, loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const PATH_TOKEN = /[\w./~@+-]+\.\w+\b/g

const CD = /\bcd\s+(['"]?)([^\s;&|'"]+)\1/g

/**
 * Whether [token], a path as the command names it, is a gated file of the project, read
 * from the shell's directory or from any directory the command changes into.
 */
function isGated(token, command, { projectDir, cwd, globs }) {
  const dirs = [cwd, ...[...command.matchAll(CD)].map(([, , dir]) => resolve(cwd, dir))]
  return dirs.some((dir) => isTddGated(projectDir, resolve(dir, token), globs))
}

/** A `sed` or `perl` in-place edit, its flag spelled `-i`, `-Ei`, `-i.bak`, `-pi` or `--in-place`. */
const IN_PLACE = /\b(?:sed|perl)\b[^|]*\s(?:-[a-zA-Z]*i|--in-place)/

/** A redirect, `tee`, or an in-place edit aimed at [path]. */
const writesWithShell = (segment, path) =>
  new RegExp(`(?:>>|>\\|?|\\btee\\b(?:\\s+(?:-a|--append))?)\\s*['"]?${escapeRegex(path)}(?![\\w./-])`).test(segment) ||
  (IN_PLACE.test(segment) && segment.includes(path))

const COPY = /\b(?:cp|mv|install)\s+(.*)$/

/** A redirection token such as `2>/dev/null` or `&>log`, or a bare one whose target is the next token. */
const REDIRECT = /^(?:\d*|&)>>?/

/**
 * The files a `cp`, `mv` or `install` writes: its destination, or each source's name inside
 * it when the destination is a directory (`-t dir`, a trailing `/`, or a name without an
 * extension).
 */
function copyTargets(segment) {
  const args = segment.match(COPY)?.[1].trim().split(/\s+/).map((arg) => arg.replace(/['"]/g, ''))
  if (!args) return []
  const operands = []
  let directory = null
  for (let i = 0; i < args.length; i++) {
    if (REDIRECT.test(args[i])) {
      if (args[i].replace(REDIRECT, '') === '') i++
    } else if (args[i] === '-t' || args[i] === '--target-directory') directory = args[++i]
    else if (args[i].startsWith('--target-directory=')) directory = args[i].split('=')[1]
    else if (!args[i].startsWith('-')) operands.push(args[i])
  }
  if (directory === null) {
    const destination = operands.pop()
    if (destination === undefined) return []
    if (!destination.endsWith('/') && /\.\w+$/.test(basename(destination))) return [destination]
    directory = destination
  }
  return operands.map((source) => join(directory, basename(source)))
}

/**
 * A write call in an inline script: `open` in a writing mode or `appendFile`, `writeFile` or
 * `createWriteStream` with its target captured, or a call whose target is not its first argument.
 */
const SCRIPT_WRITE =
  /open\(([^)]*)['"](?:[wax]|r\+)[bt+]*['"]|(?:writeFile|appendFile)(?:Sync)?\(([^,)]*)|createWriteStream\(([^,)]*)|\.write_(?:text|bytes)\(|shutil\.(?:copy\w*|move)\(|os\.(?:rename|replace)\(|(?:copyFile|rename)(?:Sync)?\(/g

/**
 * An inline Python or Node script that names [path] and writes a file it does not name as a
 * literal ungated path. A variable, an expression, or a call whose target is not captured is
 * taken as possibly the gated file.
 */
function scriptWrites(command, path, scope) {
  if (!/\b(?:python3?|node)\b/.test(command) || !command.includes(path)) return false
  return [...command.matchAll(SCRIPT_WRITE)].some(([, openArgs, writeFileTarget, streamTarget]) => {
    const literal = (openArgs ?? writeFileTarget ?? streamTarget ?? '').match(/^\s*['"]([^'"]+)['"]/)
    return literal === null || isGated(literal[1], command, scope)
  })
}

/** Quoted strings, or the operators that separate commands outside them. */
const SEPARATOR_OR_QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"|;|&&|\|\||(?<!>)\|/g

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
      if (isGated(path, command, scope) && writesWithShell(segment, path)) offending.add(path)
    }
    for (const target of copyTargets(segment)) {
      if (isGated(target, command, scope)) offending.add(target)
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
