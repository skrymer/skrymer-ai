#!/usr/bin/env node
/**
 * Lints a sign-off's resolutions pack before the resolutions pass reads it, so a pack that lost a
 * finding, miscounted, or cites a red that was never recorded goes back before any judging starts.
 *
 *   node pack-lint.mjs <pack.md>
 *
 * The pack holds two tables. **Sources**, `| agent | transcript | findings |`, has one row per
 * agent whose findings the pack carries, with its transcript and either the count of findings it
 * returned or, for a mutant triager, `survivors <path>`, its survivors file. **Resolutions**,
 * `| id | agent | finding | remedy | resolution |`, has one row per finding and remedy; a finding
 * split into several remedies shares its id up to a dot (`CR-2.a`, `CR-2.b`).
 *
 * It fails when a transcript is missing, an agent's finding count or a survivors file's line
 * count doesn't match its rows, a row cites an agent no source lists, a row names two remedies, a
 * row has no resolution, or a FIXED cell doesn't read `FIXED: <test> — red <log path>` with a log
 * that exists, as the red-proof recorder prints it. Paths are relative to where it runs.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(import.meta.url)
const FIXED = /^FIXED: (.+?) — red (\S+)$/
/** A remedy cell that names a second remedy: a semicolon, a plus, or "and" or "or" before a second verb. */
const TWO_REMEDIES = /;|\s\+\s|\b(?:and|or)\s+(?:also\s+)?(?:add|fix|rename|remove|write|extract|change|move|delete|update|test|split|drop|call)\b/i

class Stop extends Error {}

function main([path], projectDir) {
  if (!path) throw new Stop('usage: pack-lint.mjs <pack.md>')
  if (!existsSync(resolve(projectDir, path))) throw new Stop(`no pack at ${path}.`)
  const markdown = readFileSync(resolve(projectDir, path), 'utf8')
  const sources = tableUnder(markdown, 'Sources', ['agent', 'transcript', 'findings'])
  const rows = tableUnder(markdown, 'Resolutions', ['id', 'agent', 'finding', 'remedy', 'resolution'])
  const exists = (file) => existsSync(resolve(projectDir, file))
  const problems = []

  for (const { agent, transcript, findings } of sources) {
    if (!exists(transcript)) problems.push(`${agent}: no transcript at ${transcript}.`)
    const mine = rows.filter((row) => row.agent === agent)
    const survivors = /^survivors\s+(\S+)$/.exec(findings)?.[1]
    if (survivors) {
      if (!exists(survivors)) problems.push(`${agent}: no survivors file at ${survivors}.`)
      else {
        const lines = readFileSync(resolve(projectDir, survivors), 'utf8').split('\n').filter(Boolean).length
        if (lines !== mine.length) problems.push(`${agent}: ${survivors} has ${count(lines, 'survivor')}, and the pack rows ${mine.length}.`)
      }
    } else if (/^\d+$/.test(findings)) {
      const ids = [...new Set(mine.map((row) => row.id.split('.')[0]))]
      if (ids.length !== Number(findings)) problems.push(`${agent}: returned ${count(Number(findings), 'finding')}, and the pack rows ${ids.length}${ids.length ? ` (${ids.join(', ')})` : ''}.`)
    } else problems.push(`${agent}: findings reads "${findings}"; it is a count, or survivors <path> for a mutant triager.`)
  }
  const agents = new Set(sources.map(({ agent }) => agent))
  const seen = new Set()
  for (const { id, agent, remedy, resolution } of rows) {
    if (seen.has(id)) problems.push(`${id}: two rows share this id.`)
    seen.add(id)
    if (!agents.has(agent)) problems.push(`${id}: cites ${agent}, which no source lists.`)
    if (TWO_REMEDIES.test(remedy)) problems.push(`${id}: the remedy names two remedies ("${remedy}"). Split it into one row per remedy.`)
    if (!resolution) problems.push(`${id}: no resolution. Every finding is fixed or carries a reason it isn't.`)
    else if (/^FIXED\b/.test(resolution)) {
      const fixed = FIXED.exec(resolution)
      if (!fixed) problems.push(`${id}: a FIXED cell reads "FIXED: <test> — red <log path>", not "${resolution}".`)
      else if (!exists(fixed[2])) problems.push(`${id}: the FIXED cell cites ${fixed[2]}, which does not exist.`)
    }
  }
  if (!problems.length) {
    process.stdout.write(`pack lint: ${count(rows.length, 'row')} from ${count(sources.length, 'source')}, clean.\n`)
    return
  }
  process.stdout.write(`pack lint: ${count(problems.length, 'problem')}. Fix the pack before the resolutions pass reads it.\n${problems.map((problem) => `- ${problem}`).join('\n')}\n`)
  process.exitCode = 1
}

/** The rows of the first table under the [heading], as objects keyed by [columns], or a Stop when it isn't there. */
function tableUnder(markdown, heading, columns) {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => new RegExp(`^#{1,6}\\s+${heading}\\s*$`, 'i').test(line))
  if (start === -1) throw new Stop(`the pack has no "${heading}" section with its table: | ${columns.join(' | ')} |.`)
  const table = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break
    if (line.trim().startsWith('|')) table.push(line)
  }
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
  if (table.length < 2 || cells(table[0]).join('|').toLowerCase() !== columns.join('|')) {
    throw new Stop(`the pack's "${heading}" table has the columns | ${columns.join(' | ')} |.`)
  }
  return table.slice(2).map((line) => Object.fromEntries(columns.map((column, i) => [column, cells(line)[i] ?? ''])))
}

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

if (process.argv[1] === SCRIPT) {
  try {
    main(process.argv.slice(2), process.cwd())
  } catch (error) {
    process.stdout.write(error instanceof Stop ? `STOP: ${error.message}\n` : `pack-lint failed: ${error.stack}\n`)
    process.exitCode = 1
  }
}
