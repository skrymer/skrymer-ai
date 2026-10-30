#!/usr/bin/env node
/**
 * PreToolUse hook (Write, Edit): refuses a new test while the branch holds duplicated source
 * code it added, so the refactor step of a TDD cycle happens before the next red rather than at
 * sign-off. Probity judges only the file being written, so duplication against another file is
 * invisible to it.
 *
 * A write is a new test when it lands on a file one pack's `duplication.tests` globs match and
 * leaves more test declarations than it replaces. jscpd then scans the directories that pack's
 * TDD-gated trees start from, under every root it is given, minus every pack's tests. A clone
 * counts as the branch's when either copy overlaps a line the branch added or changed since it
 * left origin's default branch, so a clone the branch only moved or left alone never blocks.
 * The deny words the way out in that pack's terms.
 *
 * `SKRYMER_AI_JSCPD` names another command to run jscpd with, such as a local install.
 *
 * Fails open, and says so: a scan that can't run lets the write through with
 * "duplication-gate skipped: …" to the user and the agent, so a skipped scan never reads as a
 * clean one (ADR 0008).
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, matchesGlob, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { branchOf } from './branch.mjs'
import { loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JSCPD = 'jscpd@5.4.0'
const MIN_TOKENS = 30
/** Inside the hook's 10-second timeout, so a slow scan ends in a skip that says so. */
const TIMEOUT_MS = Number(process.env.SKRYMER_AI_DUPLICATION_GATE_TIMEOUT_MS) || 8000
/** The style blocks of a Vue file, which no extraction in a pack's remedy applies to. */
const STYLE_FORMATS = new Set(['css', 'scss', 'sass', 'less', 'stylus'])

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'))?.tool_input ?? {}
  if (typeof input.file_path !== 'string') return
  const projectDir = process.env.CLAUDE_PROJECT_DIR
  const { config, errors } = await loadConfig(projectDir, PLUGIN_ROOT)
  if (errors) throw new Error('the project config has errors; the session start names them')
  if (!config) return
  const file = inside(projectDir, input.file_path)
  if (file === null) return
  const writing = config.duplication.filter(({ tests }) => tests.some((glob) => matchesGlob(file, glob)))
  if (!writing.length || !addsTest(input, writing)) return
  const packs = new Set(writing.map((stack) => stack.pack))
  const stacks = config.duplication.filter((stack) => packs.has(stack.pack))
  const dirs = scanDirs(projectDir, stacks, config.tdd.files)
  if (!dirs.length) return
  const changes = branchChanges(projectDir)
  const ignore = config.duplication.flatMap((stack) => stack.tests)
  const formats = [...new Set(stacks.flatMap((stack) => stack.formats))]
  const clones = (await findClones(projectDir, dirs, ignore, formats)).filter((pair) => pair.some((side) => changes.touches(side)))
  if (clones.length) process.stdout.write(JSON.stringify(refusal(clones, writing)))
}

/** [file] relative to [dir], or null when it lies outside it. */
function inside(dir, file) {
  const path = relative(dir, file)
  return path.startsWith('..') || isAbsolute(path) ? null : path
}

/**
 * Whether a pending Write or Edit leaves more test declarations, as [stacks] declare them,
 * than it replaces: an Edit's old string, or the whole file a Write overwrites.
 */
function addsTest(input, stacks) {
  const declaration = new RegExp(stacks.map((stack) => stack.declaration.source).join('|'), 'gm')
  const count = (text) => (text ?? '').match(declaration)?.length ?? 0
  const replaced = 'old_string' in input ? input.old_string : existsSync(input.file_path) ? readFileSync(input.file_path, 'utf8') : ''
  return count(input.new_string ?? input.content) > count(replaced)
}

/**
 * The project-relative directories [stacks]' source starts from: where each TDD glob in
 * [tddFiles] under one of their roots stops being literal (`acme-api/src` for
 * `acme-api/src/**\/*.kt`), keeping only those that exist and aren't inside another.
 */
function scanDirs(projectDir, stacks, tddFiles) {
  const dirs = tddFiles
    .filter((glob) => stacks.some(({ root }) => !root || glob.startsWith(`${root}/`)))
    .map((glob) => {
      const segments = glob.split('/')
      return segments.slice(0, segments.findIndex((segment) => /[*?[{]/.test(segment))).join('/')
    })
    .filter((dir) => existsSync(join(projectDir, dir)))
  return [...new Set(dirs)].filter((dir, _, all) => !all.some((other) => other !== dir && (!other || dir.startsWith(`${other}/`))))
}

/**
 * The lines the branch has added or changed since it left origin's default branch, committed
 * or not, as a `touches({ file, start, end })` test on a project-relative clone side. A file git
 * doesn't track yet is new throughout; a renamed file counts only its changed lines.
 */
function branchChanges(projectDir) {
  const { top, base, git, untracked } = branchOf(projectDir, { timeout: TIMEOUT_MS })
  const changed = new Map()
  let path = null
  for (const line of git('-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '-U0', base).split('\n')) {
    if (line.startsWith('+++ ')) path = line === '+++ /dev/null' ? null : line.slice(6)
    const hunk = path && /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!hunk || hunk[2] === '0') continue
    const from = Number(hunk[1])
    changed.set(path, [...(changed.get(path) ?? []), [from, from + Number(hunk[2] ?? 1) - 1]])
  }
  for (const file of untracked()) {
    changed.set(file, [[1, Infinity]])
  }
  return {
    touches: ({ file, start, end }) =>
      (changed.get(relative(top, join(projectDir, file))) ?? []).some(([from, to]) => from <= end && start <= to),
  }
}

/**
 * The clones jscpd finds in [dirs], leaving out files [ignore] matches, in [formats], each a
 * pair of project-relative `{ file, start, end }`. It runs with a config of core's own, so a
 * project's jscpd config can't change what is scanned or how jscpd exits. A clone of nothing
 * but preamble, or between style blocks, is left out.
 */
async function findClones(projectDir, dirs, ignore, formats) {
  const out = mkdtempSync(join(tmpdir(), 'duplication-gate-'))
  try {
    const config = join(out, 'jscpd.json')
    writeFileSync(config, '{}')
    await runJscpd(projectDir, ['-c', config, '-f', formats.join(','), '-k', String(MIN_TOKENS), ...(ignore.length ? ['-i', ignore.join(',')] : []), '-a', '-s', '-r', 'json', '-o', out, ...dirs.map((dir) => join(projectDir, dir))])
    const report = JSON.parse(readFileSync(join(out, 'jscpd-report.json'), 'utf8'))
    // A Vue file's halves are named `File.vue:html` and `File.vue:typescript`.
    const side = ({ name, start, end }) => ({ file: relative(projectDir, name.replace(/:\w+$/, '')), start, end })
    return report.duplicates
      .filter((clone) => !STYLE_FORMATS.has(clone.format) && !isPreamble(matched(clone)))
      .map((clone) => [side(clone.firstFile), side(clone.secondFile)])
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * Runs jscpd with [args] in [projectDir], through `npx` from its cache unless
 * `SKRYMER_AI_JSCPD` names another command. On a first run, with jscpd not yet in the cache, it
 * starts the download in the background and says so. A scan past the time limit is killed with
 * every process it started.
 */
async function runJscpd(projectDir, args) {
  const override = process.env.SKRYMER_AI_JSCPD?.trim()
  const [command, ...prefix] = override ? override.split(/\s+/) : ['npx', '--offline', '-y', JSCPD]
  const { status, stderr, timedOut } = await run(command, [...prefix, ...args], projectDir)
  if (timedOut) throw new Error(`jscpd took longer than ${TIMEOUT_MS / 1000} s`)
  if (status === 0) return
  if (!override && /ENOTCACHED/.test(stderr)) {
    spawn('npx', ['-y', JSCPD, '--version'], { detached: true, stdio: 'ignore' }).unref()
    throw new Error(`${JSCPD} is downloading for its first run; the next new test is checked`)
  }
  // npm ends its own errors with where its log is, which says nothing about the cause.
  const cause = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^npm error (?:A complete log|$)|--loglevel/.test(line))
    .at(-1)
  throw new Error(cause ?? `jscpd exited with code ${status}`)
}

/** Runs [command] in its own process group, killing the group if it outlasts the time limit. */
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let timedOut = false
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // The group has already gone.
      }
    }, TIMEOUT_MS)
    child.on('error', (error) => (clearTimeout(timer), reject(error)))
    child.on('close', (status) => (clearTimeout(timer), resolve({ status, stderr, timedOut })))
  })
}

/**
 * The lines of [clone] its copies share. jscpd's fragment runs on to the end of the line where
 * the copies part, as in `class InvoiceService` against `class OrderService`, so a last line
 * matched only up to its end column is left out.
 */
function matched(clone) {
  const lines = clone.fragment.split('\n')
  return lines.at(-1).length > clone.firstFile.endLoc.column ? lines.slice(0, -1).join('\n') : clone.fragment
}

/** What a file opens with and nothing extracts: comments, package lines, imports (wrapped ones too) and annotation lines. */
const PREAMBLE = [
  /\/\*[\s\S]*?(?:\*\/|$)/g,
  /\/\/.*$/gm,
  /^\s*package\s.*$/gm,
  /^\s*import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"][^'"]+['"];?/gm,
  /^\s*import\s+['"][^'"]+['"];?/gm,
  /^\s*import\s+[\w.*`]+(?:\s+as\s+\w+)?\s*$/gm,
  /^\s*@[\w.]+(?:\([^()]*\))?\s*$/gm,
]

/** Whether a cloned fragment is nothing but preamble. */
const isPreamble = (fragment) => !PREAMBLE.reduce((text, pattern) => text.replace(pattern, ''), fragment).trim()

/** The deny naming each clone, the refactorings out of it in [stacks]' terms, and the escape for a meant one. */
function refusal(clones, stacks) {
  const pairs = clones.map((pair) => pair.map(({ file, start }) => `${file}:${start}`).join(' ↔ '))
  const remedies = [...new Set(stacks.map((stack) => stack.remedy))]
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Refactor before the next test: ${pairs.join(', ')} duplicate each other. Remove the ` +
        'duplication with a refactoring from https://refactoring.com/catalog/, under the green tests ' +
        'that already cover both copies; the extracted code gets its own test once the duplication is gone. ' +
        `${remedies.join(' ')} If the duplication is meant, wrap the side you keep in ` +
        'jscpd:ignore-start / jscpd:ignore-end with a one-line reason.',
    },
  }
}

/**
 * Lets the write through but says the check did not run, to the user and to the agent. No
 * permission decision is given: `allow` would also skip the user's permission prompt.
 */
function skipped(error) {
  const message = `duplication-gate skipped: ${String(error?.message ?? error).trim().split('\n').at(-1)}`
  process.stdout.write(JSON.stringify({ systemMessage: message, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: message } }))
}

try {
  await main()
} catch (error) {
  skipped(error)
}
