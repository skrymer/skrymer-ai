#!/usr/bin/env node
/**
 * The one entrypoint `/web-e2e:verify` runs, so the skill never has to know where `core` is
 * installed:
 *
 *   node verify.mjs stack  …   core's verify-stack.mjs
 *   node verify.mjs api    …   core's verify-api.mjs
 *   node verify.mjs result …   core's verify-result.mjs
 *   node verify.mjs browser …  this pack's verify-browser.mjs
 *
 * Each runs in the current directory with the remaining arguments, and its exit status is this
 * script's.
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { coreScript } from './core.mjs'

const CORE_SCRIPTS = { stack: 'verify-stack.mjs', api: 'verify-api.mjs', result: 'verify-result.mjs' }

const [command, ...args] = process.argv.slice(2)
let script
try {
  if (command === 'browser') script = join(dirname(fileURLToPath(import.meta.url)), 'verify-browser.mjs')
  else if (CORE_SCRIPTS[command]) script = coreScript(CORE_SCRIPTS[command])
  else throw new Error('usage: verify.mjs stack|api|result|browser <arguments…>')
} catch (error) {
  process.stdout.write(`STOP: ${error.message}\n`)
  process.exit(1)
}
const run = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' })
process.exitCode = run.status ?? 1
