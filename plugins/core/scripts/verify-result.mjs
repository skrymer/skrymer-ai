#!/usr/bin/env node
/**
 * The verify results file, written one row at a time and checked for completeness by code, so
 * a walk-through that leaves an acceptance criterion out cannot pass it over in its prose
 * (ADR 0011). A pack's verify skill drives its own platform and records what it found here.
 *
 *   node verify-result.mjs head <issue>
 *       stamps the code the walk-through runs on: HEAD's commit and a hash of the uncommitted
 *       diff, untracked files included. Stamped again on changed code, it drops the rows walked
 *       on the old code, since a result stands for the code that ships.
 *   node verify-result.mjs record <AC> <target> <status> [--screenshot <file>] [--note <text>]
 *       one row, `AC-<issue>.<n><TAB>target<TAB>status<TAB>screenshot<TAB>note`. The status is
 *       pass, fail, blocked or not-visible; a pass or fail needs a screenshot, which is copied
 *       beside the results, and anything but a pass needs a note. A not-visible AC has `-` for
 *       its target and screenshot. A row replaces the AC's earlier row at that target, and a
 *       not-visible row and a walked one replace each other.
 *   node verify-result.mjs charter <issue> "explore <area> with <attack> to discover <risk>"
 *       registers an exploratory charter, which the break-it tester derives from the diff, and
 *       prints its key, `EX-<issue>.<n>`. A charter's row is recorded like an AC's, at the target
 *       it was driven at, with a screenshot as an AC's is, never not-visible, and always with a
 *       note naming what was tried.
 *   node verify-result.mjs check <issue> [--explore]
 *       reads the issue's ACs through gh and fails unless every one has a row at every target
 *       the config names, or a not-visible row, all on the code head stamped. With --explore it
 *       also fails unless at least one charter was registered and each has a row.
 *
 * The rows, screenshots and head sit in the repo's git dir under `skrymer-ai/verify/<issue>/`.
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { git, runAsScript, Stop, verifyConfig, verifyDir } from './verify-common.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
const STATUSES = ['pass', 'fail', 'blocked', 'not-visible']
const RESULTS = 'results.tsv'
const CHARTERS = 'charters.tsv'
const CHARTER_FORM = /^explore\s+\S.*\swith\s+\S.*\sto discover\s+\S.*$/i
const HEAD = 'head'

async function main(argv, projectDir) {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { screenshot: { type: 'string' }, note: { type: 'string' }, explore: { type: 'boolean' } } })
  const [command, ...args] = positionals
  const config = await verifyConfig(projectDir)
  const targets = [...new Set(config.verify.flatMap((stack) => Object.keys(stack.targets)))]
  if (command === 'head' && args.length === 1) return head(projectDir, issueOf(args[0]))
  if (command === 'charter' && args.length === 2) return charter(projectDir, issueOf(args[0]), args[1])
  if (command === 'record' && args.length === 3) return record(projectDir, targets, args, values)
  if (command === 'check' && args.length === 1) return check(projectDir, targets, issueOf(args[0]), config.tracker, values)
  throw new Stop('usage: verify-result.mjs head <issue> | charter <issue> <charter> | record <AC|EX> <target> <status> [--screenshot <file>] [--note <text>] | check <issue> [--explore]')
}

function issueOf(arg) {
  if (!/^\d+$/.test(arg)) throw new Stop(`"${arg}" is not an issue number.`)
  return arg
}

function head(projectDir, issue) {
  const dir = verifyDir(projectDir, issue)
  const stamp = stampOf(projectDir)
  const previous = existsSync(join(dir, HEAD)) && readFileSync(join(dir, HEAD), 'utf8')
  const lines = []
  if (previous && previous !== stamp) {
    const dropped = rowsOf(dir).length
    for (const file of readdirSync(dir)) rmSync(join(dir, file), { force: true })
    if (dropped) lines.push(`dropped ${count(dropped, 'row')} walked on the old code`)
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, HEAD), stamp)
  lines.push(`head for issue ${issue}: ${stamp.trim().replace('\n', ', ')}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

/**
 * `commit <sha>\ndiff <sha256>\n`: HEAD and a hash of everything uncommitted, untracked files
 * included, staged through a scratch index so the real one is left alone. `diff clean` when
 * nothing is. The scratch index is read from HEAD's tree rather than copied from the real one:
 * a copy carries the real index's cached file stats under a newer mtime, which defeats git's
 * racy-clean check, so an edit that keeps a file's size within the same timestamp went unseen.
 */
function stampOf(projectDir) {
  const top = git(projectDir, ['rev-parse', '--show-toplevel']).trim()
  const commit = git(top, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).trim()
  const scratch = mkdtempSync(join(tmpdir(), 'verify-index-'))
  try {
    const index = join(scratch, 'index')
    if (commit) git(top, ['read-tree', 'HEAD'], { GIT_INDEX_FILE: index })
    git(top, ['add', '-A'], { GIT_INDEX_FILE: index })
    const diff = git(top, ['diff', '--cached', '--binary', '--no-color', 'HEAD'], { GIT_INDEX_FILE: index })
    return `commit ${commit}\ndiff ${diff ? createHash('sha256').update(diff).digest('hex') : 'clean'}\n`
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Stops unless head is stamped for [issue] on the code as it stands. */
function requireHead(projectDir, dir, issue) {
  if (!existsSync(join(dir, HEAD))) throw new Stop(`no head for issue ${issue}. Stamp the code the walk-through runs on first: node ${SCRIPT} head ${issue}`)
  if (readFileSync(join(dir, HEAD), 'utf8') !== stampOf(projectDir)) {
    throw new Stop(`the code changed since head was stamped for issue ${issue}, so a result would stand for other code. Stamp it again (dropping the rows walked on the old code): node ${SCRIPT} head ${issue}`)
  }
}

function charter(projectDir, issue, text) {
  if (!CHARTER_FORM.test(text) || /[\t\r\n]/.test(text)) throw new Stop('a charter reads "explore <area> with <attack> to discover <risk>", on one line.')
  const dir = verifyDir(projectDir, issue)
  requireHead(projectDir, dir, issue)
  const key = `EX-${issue}.${chartersOf(dir).length + 1}`
  appendFileSync(join(dir, CHARTERS), `${key}\t${text.trim()}\n`)
  process.stdout.write(`${key}  ${text.trim()}\n`)
}

function record(projectDir, targets, [ac, target, status], { screenshot, note = '' }) {
  const [, kind, issue] = /^(AC|EX)-(\d+)\.[1-9]\d*$/.exec(ac) ?? []
  if (!issue) throw new Stop(`"${ac}" is not an AC key such as AC-8.1, or a charter key such as EX-8.1.`)
  if (!STATUSES.includes(status)) throw new Stop(`"${status}" is not a status. Statuses: ${STATUSES.join(', ')}.`)
  if (/[\t\r\n]/.test(note)) throw new Stop('a note is one line without tabs.')
  if (kind === 'EX') {
    if (status === 'not-visible') throw new Stop('a charter is driven at a target, so it is never not-visible.')
    if (!note.trim()) throw new Stop('a charter row needs a --note naming what was tried, the values included.')
    if (!chartersOf(verifyDir(projectDir, issue)).some((c) => c.key === ac)) {
      throw new Stop(`there is no charter ${ac} for issue ${issue}. Register it first: charter ${issue} "explore <area> with <attack> to discover <risk>".`)
    }
  }
  if (status !== 'pass' && !note.trim()) throw new Stop(`a ${status} needs a --note saying why.`)
  if (status === 'not-visible') {
    if (target !== '-') throw new Stop('a not-visible AC has - for its target: it is not walked at any.')
    if (screenshot !== undefined) throw new Stop('a not-visible AC has no screenshot.')
  } else {
    if (!targets.includes(target)) throw new Stop(`there is no target "${target}". Targets: ${targets.join(', ')}.`)
    if (screenshot === undefined && status !== 'blocked') throw new Stop(`a ${status} needs a --screenshot of what the walk-through saw.`)
    if (screenshot !== undefined && !existsSync(resolve(projectDir, screenshot))) throw new Stop(`no screenshot at ${screenshot}.`)
  }
  const dir = verifyDir(projectDir, issue)
  requireHead(projectDir, dir, issue)

  const shot = screenshot === undefined ? '-' : `${ac}-${target}${extname(screenshot)}`
  if (shot !== '-' && resolve(projectDir, screenshot) !== join(dir, shot)) copyFileSync(resolve(projectDir, screenshot), join(dir, shot))
  const replaced = (row) => row.ac === ac && (row.target === target || row.status === 'not-visible' || status === 'not-visible')
  const kept = rowsOf(dir).filter((row) => !replaced(row))
  for (const row of rowsOf(dir).filter(replaced)) {
    if (row.screenshot !== '-' && row.screenshot !== shot) rmSync(join(dir, row.screenshot), { force: true })
  }
  const rows = [...kept, { ac, target, status, screenshot: shot, note: note.trim() }]
  writeFileSync(join(dir, RESULTS), rows.map((row) => `${[row.ac, row.target, row.status, row.screenshot, row.note].join('\t')}\n`).join(''))
  process.stdout.write(`recorded ${ac} ${target} ${status}\n`)
}

function check(projectDir, targets, issue, tracker, { explore }) {
  if (tracker.kind !== 'github') throw new Stop(`check reads an issue's ACs through gh, and this project's tracker is ${tracker.kind}.`)
  const acs = acsOf(issue, projectDir)
  const dir = verifyDir(projectDir, issue)
  requireHead(projectDir, dir, issue)
  const all = rowsOf(dir)
  const rows = all.filter((row) => row.ac.startsWith('AC-'))
  const lines = []
  let missing = 0
  acs.forEach((_, i) => {
    const key = `AC-${issue}.${i + 1}`
    const mine = rows.filter((row) => row.ac === key)
    const hidden = mine.find((row) => row.status === 'not-visible')
    if (hidden) return lines.push(`${key}  not visible: ${hidden.note}`)
    const results = targets.map((target) => {
      const row = mine.find((r) => r.target === target)
      return row ? `${target} ${row.status}${row.note ? `: ${row.note}` : ''}` : `${target} MISSING`
    })
    if (!mine.length) results.splice(0, results.length, 'MISSING')
    if (results.some((result) => result.endsWith('MISSING'))) missing++
    lines.push(`${key}  ${results.join(', ')}`)
  })
  const strays = rows.flatMap((row) => {
    const n = Number(row.ac.split('.')[1])
    if (!row.ac.startsWith(`AC-${issue}.`) || n > acs.length) return [`${row.ac}: issue ${issue} has ${count(acs.length, 'AC')}`]
    if (row.status !== 'not-visible' && !targets.includes(row.target)) return [`${row.ac} ${row.target}: there is no target "${row.target}". Targets: ${targets.join(', ')}.`]
    return []
  })
  if (missing) lines.push(`INCOMPLETE: ${missing} of ${count(acs.length, 'AC')} lack a result.`)
  if (strays.length) lines.push('rows that match no AC and target:', ...strays.map((stray) => `  ${stray}`))
  if (!missing && !strays.length) lines.push(`${count(acs.length, 'AC')}, every one with a result.`)
  const unexplored = explore ? checkCharters(issue, chartersOf(dir), all, lines) : false
  process.stdout.write(`${lines.join('\n')}\n`)
  if (missing || strays.length || unexplored) process.exitCode = 1
}

/** Adds a line per charter to [lines], and whether the exploration falls short: no charter at all, or one with no row. */
function checkCharters(issue, charters, rows, lines) {
  if (!charters.length) {
    lines.push(`INCOMPLETE: no charter was explored. Each is registered with charter ${issue} "<charter>" and driven to a row.`)
    return true
  }
  let missing = 0
  for (const { key, text } of charters) {
    const mine = rows.filter((row) => row.ac === key)
    if (!mine.length) missing++
    const results = mine.length ? mine.map((row) => `${row.target} ${row.status}: ${row.note}`).join(', ') : 'MISSING'
    lines.push(`${key}  ${text}: ${results}`)
  }
  const verb = missing === 1 ? 'lacks' : 'lack'
  lines.push(missing ? `INCOMPLETE: ${missing} of ${count(charters.length, 'charter')} ${verb} a result.` : `${count(charters.length, 'charter')}, every one with a result.`)
  return missing > 0
}

/** The charters registered in [dir], each `{ key, text }`, in order. */
function chartersOf(dir) {
  if (!existsSync(join(dir, CHARTERS))) return []
  return readFileSync(join(dir, CHARTERS), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [key, text] = line.split('\t')
      return { key, text }
    })
}

/**
 * The checklist items of [issue]'s acceptance criteria section, or of its whole body when it has
 * no such heading, in order. The nth is `AC-<issue>.<n>`.
 */
function acsOf(issue, projectDir) {
  const gh = spawnSync('gh', ['issue', 'view', issue, '--json', 'body', '--jq', '.body'], { cwd: projectDir, encoding: 'utf8' })
  if (gh.error || gh.status !== 0) throw new Stop(`gh could not read issue ${issue}: ${gh.error?.message ?? gh.stderr.trim().split('\n').at(-1)}`)
  const lines = gh.stdout.split('\n')
  const start = lines.findIndex((line) => /^#{1,6}\s+acceptance criteria\b/i.test(line))
  let section = lines
  if (start >= 0) {
    const level = lines[start].match(/^#+/)[0].length
    const end = lines.findIndex((line, i) => i > start && /^(#+)\s/.test(line) && line.match(/^#+/)[0].length <= level)
    section = lines.slice(start + 1, end < 0 ? undefined : end)
  }
  const acs = section.filter((line) => /^\s*[-*+]\s+\[[ xX]\]\s/.test(line))
  if (!acs.length) throw new Stop(`issue ${issue} has no acceptance criteria checklist, so there is nothing to check results against.`)
  return acs
}

function rowsOf(dir) {
  if (!existsSync(join(dir, RESULTS))) return []
  return readFileSync(join(dir, RESULTS), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ac, target, status, screenshot, note = ''] = line.split('\t')
      return { ac, target, status, screenshot, note }
    })
}

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

runAsScript(SCRIPT, 'verify-result', main)
