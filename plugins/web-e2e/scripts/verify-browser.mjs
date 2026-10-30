#!/usr/bin/env node
/**
 * The browser a verify walk-through drives: one headless playwright-cli session per target in
 * the project's verify config, each emulating its target, so no window needs a person to fix
 * it (ADR 0012).
 *
 *   node verify-browser.mjs open [--headed] <url>
 *       opens a session per target at url, headless unless --headed, and prints the command
 *       that drives each one and where its screenshots go. A target narrower than 1024px is
 *       emulated as a touch device (scale 3 under 600px, else 2); a wider one as a desktop at
 *       scale 1. A session that can't start stops `open`, and the ones it opened are closed.
 *   node verify-browser.mjs layout <target>
 *       runs the layout checks (`layout-check.js`) on the target's current page and prints each
 *       finding: page overflow, overlapping controls, a control offscreen or covered, a tap
 *       target under 44px on a touch target, focus that can't be seen. Fails on any finding.
 *   node verify-browser.mjs close
 *       closes every session `open` opened.
 *
 * Each session's config, snapshots and screenshots sit in `skrymer-ai/verify/browser/` in the
 * repo's git dir, and its name carries the worktree, so two worktrees walk side by side.
 * playwright-cli runs through a pinned npx unless `SKRYMER_AI_PLAYWRIGHT_CLI` names another
 * command.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { verifyCommon } from './core.mjs'

const { runAsScript, Stop, verifyConfig, verifyDir } = await verifyCommon()
const SCRIPT = fileURLToPath(import.meta.url)
const LAYOUT_CHECK = join(dirname(SCRIPT), 'layout-check.js')
const CLI = ['npx', '-y', '@playwright/cli@0.1.22']
const SESSIONS = 'sessions.json'

async function main(argv, projectDir) {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { headed: { type: 'boolean' } } })
  const [command, ...args] = positionals
  if (values.headed && command !== 'open') throw new Stop('--headed is an option of open.')
  if (command === 'open' && args.length === 1) return open(projectDir, args[0], values)
  if (command === 'layout' && args.length === 1) return layout(projectDir, args[0])
  if (command === 'close' && !args.length) return close(projectDir)
  throw new Stop('usage: verify-browser.mjs open [--headed] <url> | layout <target> | close')
}

async function open(projectDir, url, { headed = false }) {
  const config = await verifyConfig(projectDir)
  const targets = Object.entries(Object.assign({}, ...config.verify.toReversed().map((stack) => stack.targets)))
  const dir = verifyDir(projectDir, 'browser')
  close(projectDir, { quiet: true })
  mkdirSync(dir, { recursive: true })
  const prefix = `verify-${createHash('sha256').update(dir).digest('hex').slice(0, 6)}`
  const opened = {}
  const lines = []
  for (const [target, [width, height]] of targets) {
    const session = `${prefix}-${target}`
    const touch = width < 1024
    const file = join(dir, `${target}.json`)
    const contextOptions = { viewport: { width, height }, deviceScaleFactor: touch ? (width < 600 ? 3 : 2) : 1, isMobile: touch, hasTouch: touch }
    writeFileSync(file, `${JSON.stringify({ outputDir: join(dir, target), browser: { contextOptions } }, null, 2)}\n`)
    const run = cli(projectDir, [`-s=${session}`, 'open', `--config=${file}`, ...(headed ? ['--headed'] : []), url])
    if (run.status !== 0) {
      save(dir, opened)
      close(projectDir, { quiet: true })
      throw new Stop(`the browser for "${target}" did not start: ${lastLine(run)}`)
    }
    opened[target] = session
    lines.push(`${target} ${width}x${height}: ${[...cliCommand(), `-s=${session}`].join(' ')} <command>`)
  }
  save(dir, opened)
  lines.push(`Save screenshots under ${dir}/<target>/: a relative --filename lands in the project.`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

function layout(projectDir, target) {
  const session = sessionsOf(verifyDir(projectDir, 'browser'))[target]
  if (!session) throw new Stop(`no browser is open for "${target}". Open one first: node ${SCRIPT} open <url>`)
  const run = cli(projectDir, [`-s=${session}`, '--raw', 'run-code', `--filename=${LAYOUT_CHECK}`])
  if (run.status !== 0) throw new Stop(`the layout checks did not run on "${target}": ${lastLine(run)}`)
  let findings
  try {
    findings = JSON.parse(run.stdout)
  } catch {
    throw new Stop(`the layout checks on "${target}" printed no findings list: ${lastLine(run)}`)
  }
  if (!findings.length) return process.stdout.write(`${target}: no layout findings\n`)
  const rows = findings.map(({ check, element, detail }) => `  ${check}  ${element}: ${detail}`)
  process.stdout.write(`${target}: ${findings.length} layout finding${findings.length === 1 ? '' : 's'}\n${rows.join('\n')}\n`)
  process.exitCode = 1
}

function close(projectDir, { quiet = false } = {}) {
  const dir = verifyDir(projectDir, 'browser')
  const sessions = Object.entries(sessionsOf(dir))
  for (const [, session] of sessions) cli(projectDir, [`-s=${session}`, 'close'])
  rmSync(join(dir, SESSIONS), { force: true })
  if (quiet) return
  process.stdout.write(sessions.length ? `closed ${sessions.map(([target]) => target).join(', ')}\n` : 'no browser is open\n')
}

const cliCommand = () => process.env.SKRYMER_AI_PLAYWRIGHT_CLI?.trim().split(/\s+/) ?? CLI

function cli(cwd, args) {
  const [command, ...prefix] = cliCommand()
  const run = spawnSync(command, [...prefix, ...args], { cwd, encoding: 'utf8', timeout: 120_000 })
  if (run.error) throw run.error
  return run
}

const sessionsOf = (dir) => (existsSync(join(dir, SESSIONS)) ? JSON.parse(readFileSync(join(dir, SESSIONS), 'utf8')) : {})

const save = (dir, sessions) => writeFileSync(join(dir, SESSIONS), `${JSON.stringify(sessions)}\n`)

const lastLine = (run) => (run.stderr || run.stdout || `exit ${run.status}`).trim().split('\n').at(-1)

runAsScript(SCRIPT, 'verify-browser', main)
