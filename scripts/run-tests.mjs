/**
 * Runs `node --test` on the given globs with `TMPDIR` pointed at a fresh dir of its own, then
 * fails the run if anything is left in it: a test, a fixture or a script that made a temp dir
 * and never removed it. The dir is removed either way, so a leak can't pile up in `/tmp`.
 * A run of its own also keeps the check clear of other runs on the same machine.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'skrymer-ai-test-run-'))
// Unset `NODE_TEST_CONTEXT`, which a run under another `node --test` inherits and which would turn
// this run into that one's reporting child, exiting 0 whatever its tests do.
const { NODE_TEST_CONTEXT, ...env } = process.env
const run = spawnSync('node', ['--test', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...env, TMPDIR: tmp } })
// npm turns on Node's compile cache, which lives at `tmpdir()/node-compile-cache` and is reused
// rather than piling up, so it isn't a leak.
const leftovers = readdirSync(tmp).filter((name) => name !== 'node-compile-cache')
rmSync(tmp, { recursive: true, force: true, maxRetries: 5 })

for (const name of leftovers) console.error(`run-tests: left behind in the tmpdir: ${name}`)
if (leftovers.length) {
  console.error(`run-tests: ${leftovers.length} temp dir(s) left behind. Make them with tempDir() from plugins/core/scripts/temp-dir.mjs, or remove them when done.`)
  process.exit(1)
}
process.exit(run.status ?? 1)
