/**
 * Runs `node --test` on the given globs with `TMPDIR` pointed at a fresh dir of its own, then
 * fails the run if anything is left in it: a test, a fixture or a script that made a temp dir
 * and never removed it. The dir is removed either way, so a leak can't pile up in `/tmp`.
 * A run of its own also keeps the check clear of other runs on the same machine.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'skrymer-ai-test-run-'))
// Unset `NODE_TEST_CONTEXT`, which a run under another `node --test` inherits and which would turn
// this run into that one's reporting child, exiting 0 whatever its tests do. npm turns on Node's
// compile cache, which would otherwise land in the run's dir.
const { NODE_TEST_CONTEXT, ...env } = process.env
const run = spawn(process.execPath, ['--test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...env, TMPDIR: tmp, NODE_DISABLE_COMPILE_CACHE: '1' },
})
// Pass a stop on to the run, and clean up once it has ended. Ctrl-C reaches both already.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => run.kill(signal))

run.on('error', (error) => finish(`run-tests: could not start node --test: ${error.message}`))
run.on('close', (status, signal) => finish(signal && `run-tests: node --test was killed by ${signal}`, status))

let finished = false
function finish(failure, status = 1) {
  // A spawn that fails can report both an error and a close.
  if (finished) return
  finished = true
  if (failure) {
    console.error(failure)
  } else {
    const leftovers = readdirSync(tmp)
    for (const name of leftovers) console.error(`run-tests: left behind in the tmpdir: ${name}`)
    if (leftovers.length) {
      console.error(`run-tests: ${leftovers.length} temp dir(s) left behind. Make them with tempDir() from plugins/core/scripts/temp-dir.mjs, or remove them when done.`)
      status = 1
    }
  }
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5 })
  } catch (error) {
    console.error(`run-tests: could not remove ${tmp}: ${error.message}`)
    status ||= 1
  }
  process.exitCode = status ?? 1
}
