#!/usr/bin/env node
/**
 * The sign-off's bookkeeping, scripted so the conductor reads its plan rather than working it out.
 *
 *   node sign-off.mjs          the plan: the selected gates in core's order, the stacks each
 *                              engine gate runs over, and the check each touched stack runs
 *   node sign-off.mjs check    each touched stack's check commands, run in its root
 *
 * Core fixes the order of the gates; the project config's `signOff.gates` selects among them
 * and cannot reorder them. The fixed core runs whatever is selected. An engine gate runs once
 * per stack root whose pack provides the engine. A stack is touched when the branch changed a
 * file under its root since its merge base with origin's default branch, committed or not.
 *
 * The check runs before any agent is spawned, so a branch that doesn't build stops before it
 * costs anything. Each stack's commands run in turn and stop at the first that fails; every
 * touched stack is checked, so one run names every broken build. The full output of each stack
 * goes to a log in the repo's git dir, under `skrymer-ai/sign-off/`.
 */

import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changedOnBranch } from './branch.mjs'
import { GATES, loadConfig } from './config.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
const PLUGIN_ROOT = join(dirname(SCRIPT), '..')
const FIXED_CORE = ['adversary', 'acceptance ledger', 'resolutions pass', 'retro']
const TAIL_LINES = 20

class Stop extends Error {}

async function main([command], projectDir) {
  const { config, errors } = await loadConfig(projectDir, PLUGIN_ROOT)
  if (errors) throw new Stop(`the project config has errors:\n${errors.map((error) => `  ${error}`).join('\n')}`)
  if (!config) throw new Stop('the project has no skrymer-ai config. /core:setup writes one.')
  const branch = measure(projectDir)
  if (command === undefined) return plan(config, branch)
  if (command === 'check') return check(config.check, branch, projectDir)
  throw new Stop(`unknown command "${command}". Usage: sign-off.mjs [check]`)
}

/** The branch as `changedOnBranch` measures it, plus whether it touched a stack root. */
function measure(projectDir) {
  let branch
  try {
    branch = changedOnBranch(projectDir, (warning) => process.stdout.write(`warning: ${warning}\n`))
  } catch (error) {
    throw new Stop(`the base is unresolved: ${error.message}`)
  }
  const { base, changed } = branch
  if (!changed.length) throw new Stop(`the branch holds no change since ${base.slice(0, 7)}, so there is nothing to sign off.`)
  const touches = ({ root }) => changed.some((file) => !root || file.startsWith(`${root}/`))
  return { ...branch, touches }
}

function plan({ signOff, mutation, verify, check: stacks }, { base, changed, touches }) {
  const engines = { mutation, verify }
  const lines = [`base ${base.slice(0, 7)}: ${changed.length} file${changed.length === 1 ? '' : 's'} changed on the branch`, "gates, in core's order:"]
  signOff.gates.forEach((gate, i) => {
    const over = engines[gate]?.map(label).join(', ')
    lines.push(`  ${i + 1}. ${over ? `${gate.padEnd(14)}${over}` : gate}`)
  })
  const unselected = GATES.filter((gate) => !signOff.gates.includes(gate))
  if (unselected.length) lines.push(`  not selected: ${unselected.join(', ')}`)
  lines.push(`fixed core, in every sign-off: ${FIXED_CORE.join(', ')}`, 'check, before any agent:')
  if (!stacks.length) lines.push('  no enabled stack has a check command')
  for (const stack of stacks) {
    lines.push(`  ${label(stack)}: ${touches(stack) ? stack.run.map((words) => words.join(' ')).join(' && ') : `SKIP — the branch changed nothing under ${stack.root}`}`)
  }
  if (stacks.some(touches)) lines.push(`  run: node ${SCRIPT} check`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

function check(stacks, { top, git, touches }, projectDir) {
  const touched = stacks.filter(touches)
  if (!touched.length) {
    process.stdout.write('no touched stack has a check command, so there is nothing to build.\n')
    return
  }
  const out = resolve(top, git('rev-parse', '--git-path', 'skrymer-ai/sign-off'))
  mkdirSync(out, { recursive: true })
  const failed = touched.filter((stack) => !build(stack, out, git, projectDir))
  if (failed.length) throw new Stop(`the build fails for ${failed.map(label).join(', ')}. Fix it before the sign-off spawns any agent.`)
}

/** Runs [stack]'s check commands in its root until one fails, logging to [out]. Whether all passed. */
function build(stack, out, git, projectDir) {
  const logPath = join(out, `check-${[stack.pack, stack.root.replaceAll('/', '-')].filter(Boolean).join('-')}.log`)
  const log = openSync(logPath, 'w')
  writeSync(log, `${label(stack)} check, ${new Date().toISOString()}\nHEAD: ${git('rev-parse', 'HEAD')}\ngit status:\n${git('status', '--short', '--branch')}\n\n`)
  let failure
  for (const words of stack.run) {
    writeSync(log, `$ ${words.join(' ')}\n`)
    const start = readFileSync(logPath).length
    const run = spawnSync(words[0], words.slice(1), { cwd: join(projectDir, stack.root), stdio: ['ignore', log, log] })
    const exit = run.error?.message ?? run.status ?? run.signal
    writeSync(log, `exit: ${exit}\n\n`)
    if (run.status !== 0) {
      failure = { words, exit, output: readFileSync(logPath, 'utf8').slice(start) }
      break
    }
  }
  closeSync(log)
  if (!failure) {
    process.stdout.write(`${label(stack)}: passed\n  log: ${logPath}\n`)
    return true
  }
  const tail = failure.output.split('\n').filter((line) => line && !line.startsWith('exit: ')).slice(-TAIL_LINES)
  process.stdout.write(`${label(stack)}: FAILED, exit ${failure.exit}: ${failure.words.join(' ')}\n${tail.map((line) => `    ${line}`).join('\n')}\n  log: ${logPath}\n`)
  return false
}

const label = (stack) => `${stack.pack} (${stack.root || '.'})`

if (process.argv[1] === SCRIPT) {
  main(process.argv.slice(2), process.cwd()).catch((error) => {
    process.stdout.write(error instanceof Stop ? `STOP: ${error.message}\n` : `sign-off failed: ${error.stack}\n`)
    process.exitCode = 1
  })
}
