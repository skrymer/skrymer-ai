/**
 * Runs `node --test` on the given globs with `TMPDIR` pointed at a fresh dir of its own, then
 * fails the run if anything is left in it: a test, a fixture or a script that made a temp dir
 * and never removed it. The dir is removed either way, so a leak can't pile up in `/tmp`.
 * A run of its own also keeps the check clear of other runs on the same machine. Every process
 * the run starts inherits that `TMPDIR`, so on Linux any still running once the tests end (a dev
 * server nobody stopped, a background download) is found by it, named, stopped, and fails the run.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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

/** The pids of the processes still running with the run's `TMPDIR`; none where there is no `/proc`. */
function stragglers() {
  if (!existsSync('/proc')) return []
  const entry = `TMPDIR=${tmp}`
  return readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)
    .filter((pid) => {
      try {
        return readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(entry)
      } catch {
        return false // gone, or another user's
      }
    })
}

/** Stops each process left running, once those stopping as the tests ended have had a second to exit. */
function stopStragglers() {
  let pids = stragglers()
  for (let waited = 0; pids.length && waited < 1000; waited += 50) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    pids = stragglers()
  }
  return pids.map((pid) => {
    let command = '?'
    try {
      command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ')
      process.kill(Number(pid), 'SIGKILL')
    } catch {
      // It exited after all.
    }
    return `${pid} ${command}`
  })
}

let finished = false
function finish(failure, status = 1) {
  // A spawn that fails can report both an error and a close.
  if (finished) return
  finished = true
  const running = stopStragglers()
  if (failure) {
    console.error(failure)
  } else {
    for (const line of running) console.error(`run-tests: left running: ${line}`)
    if (running.length) {
      console.error(`run-tests: ${running.length} process(es) left running, now stopped. Stop what a test starts before it ends.`)
      status = 1
    }
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
