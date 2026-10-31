#!/usr/bin/env node
/**
 * Renders a sign-off agent's brief from its template, so the brief an agent is sent can be
 * checked against what it should have been by exact diff, never by a hand comparison.
 *
 *   node brief.mjs <agent> [--label <name>] [--commit <sha>] --slot <name>=<value> … --slot-file <name>=<file> …
 *
 * A template, `skills/feature-sign-off/briefs/<agent>.txt`, is only its slots: the agent's
 * contract lives in its definition. `{opening}` stands for the opening every diff-reading brief
 * shares. The script fills what the branch says (`repo`, `checkout`, `base`, `commit`, and
 * `diff`, the gate's diff saved without lockfiles, which no judge reads as the change) and takes
 * every other slot from `--slot`, taken literally, or `--slot-file`, read from a file. A slot left
 * unfilled stops the render: "none" is a value, an absent slot is not.
 *
 * It prints the brief, exactly as it is to be sent, and saves it in the repo's git dir under
 * `skrymer-ai/sign-off/briefs/<agent>[-<label>].txt`, where the transcript report checks it. A
 * blind arbiter always takes a label: each settles its own split.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { branchOf } from './branch.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
const TEMPLATES = join(dirname(SCRIPT), '..', 'skills', 'feature-sign-off', 'briefs')
const OPENING = '_opening'
const FROM_BRANCH = ['repo', 'checkout', 'base', 'commit', 'diff']
const LABELLED = ['blind-arbiter']

/** The lockfiles a gate's diff leaves out: they change with every dependency and judge nothing. */
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'gradle.lockfile', 'Cargo.lock', 'poetry.lock']

class Stop extends Error {}

function main(argv, projectDir) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { slot: { type: 'string', multiple: true }, 'slot-file': { type: 'string', multiple: true }, label: { type: 'string' }, commit: { type: 'string' } },
  })
  if (positionals.length !== 1) throw new Stop('usage: brief.mjs <agent> [--label <name>] [--commit <sha>] --slot <name>=<value> … --slot-file <name>=<file> …')
  const [agent] = positionals
  const name = values.label ? `${agent}-${values.label}` : agent
  const template = templateOf(agent)
  if (LABELLED.includes(agent) && !values.label) throw new Stop(`each ${agent.replace('-', ' ')} settles one split, so its brief takes a --label naming it (the pack row id).`)
  const given = { ...slotsGiven(values.slot ?? [], '--slot', (value) => value), ...slotsGiven(values['slot-file'] ?? [], '--slot-file', (value, slot) => readSlot(projectDir, slot, value)) }
  const wanted = [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))]
  const asked = wanted.filter((slot) => !FROM_BRANCH.includes(slot))
  const extra = Object.keys(given).filter((slot) => !asked.includes(slot))
  if (extra.length) throw new Stop(`the ${agent} brief has no slot "${extra[0]}". Its slots: ${asked.join(', ')}.`)
  const missing = asked.filter((slot) => !(slot in given))
  if (missing.length) throw new Stop(`the ${agent} brief needs every slot filled ("none" when it has nothing): ${missing.join(', ')}.`)

  const branch = branchOf(projectDir)
  const out = resolve(branch.top, branch.git('rev-parse', '--git-path', 'skrymer-ai/sign-off'))
  const commit = values.commit ? branch.git('rev-parse', '--verify', `${values.commit}^{commit}`) : branch.git('rev-parse', 'HEAD')
  const filled = {
    ...given,
    repo: branch.top,
    checkout: resolve(branch.top, branch.git('rev-parse', '--git-dir')) === resolve(branch.top, branch.git('rev-parse', '--git-common-dir')) ? 'the main checkout' : 'a git worktree',
    base: branch.base,
    commit,
  }
  mkdirSync(join(out, 'briefs'), { recursive: true })
  if (wanted.includes('diff')) {
    filled.diff = join(out, `diff-${name}.patch`)
    const excluded = LOCKFILES.map((file) => `:(exclude,glob)**/${file}`)
    writeFileSync(filled.diff, rawDiff(branch.top, branch.base, commit, excluded))
  }
  const brief = template.replace(/\{(\w+)\}/g, (_, slot) => filled[slot])
  const saved = join(out, 'briefs', `${name}.txt`)
  writeFileSync(saved, brief)
  process.stdout.write(brief)
  process.stderr.write(`saved: ${saved}\n`)
}

/** [agent]'s template with the shared opening in place of `{opening}`, or a Stop naming the templates there are. */
function templateOf(agent) {
  const names = readdirSync(TEMPLATES).filter((file) => file.endsWith('.txt') && !file.startsWith('_')).map((file) => file.slice(0, -4)).sort()
  if (!names.includes(agent)) throw new Stop(`there is no brief template for "${agent}". Templates: ${names.join(', ')}.`)
  const opening = readFileSync(join(TEMPLATES, `${OPENING}.txt`), 'utf8').replace(/\n$/, '')
  return readFileSync(join(TEMPLATES, `${agent}.txt`), 'utf8').replaceAll('{opening}', opening)
}

/** Each `name=value` of [pairs], given with [option], as an object, each value passed through [read]. */
function slotsGiven(pairs, option, read) {
  return Object.fromEntries(
    pairs.map((pair) => {
      const match = /^(\w+)=([\s\S]*)$/.exec(pair)
      if (!match) throw new Stop(`${option} "${pair}": expected <name>=<value>.`)
      const [, slot, value] = match
      return [slot, read(value, slot)]
    })
  )
}

/** The text of [file] in [projectDir], less its final newline, for [slot]. */
function readSlot(projectDir, slot, file) {
  try {
    return readFileSync(resolve(projectDir, file), 'utf8').replace(/\n$/, '')
  } catch (error) {
    throw new Stop(`--slot-file ${slot}: cannot read ${file} (${error.code}).`)
  }
}

/**
 * Git's own patch of [base]..[commit] in [top] without the [excluded] paths, untrimmed so it
 * still applies, and never a user's external diff tool's rendering of it.
 */
function rawDiff(top, base, commit, excluded) {
  const run = spawnSync('git', ['diff', '--no-ext-diff', '--no-color', base, commit, '--', '.', ...excluded], { cwd: top, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (run.error) throw run.error
  if (run.status !== 0) throw new Stop(`git diff: ${run.stderr.trim().split('\n').at(-1)}`)
  return run.stdout
}

if (process.argv[1] === SCRIPT) {
  try {
    main(process.argv.slice(2), process.cwd())
  } catch (error) {
    process.stdout.write(error instanceof Stop ? `STOP: ${error.message}\n` : `brief failed: ${error.stack}\n`)
    process.exitCode = 1
  }
}
