/**
 * What the verify scripts share: the project config's verify stacks, the directory in the
 * repo's git dir where a walk-through's state lives, and a way to stop with a reason.
 */

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A reason to stop that the person running the script can act on, printed without a stack trace. */
export class Stop extends Error {}

/** The merged project config of [projectDir], with at least one stack that verifies. */
export async function verifyConfig(projectDir) {
  const { config, errors } = await loadConfig(projectDir, PLUGIN_ROOT)
  if (errors) throw new Stop(`the project config has errors:\n${errors.map((error) => `  ${error}`).join('\n')}`)
  if (!config) throw new Stop('the project has no skrymer-ai config. /core:setup writes one.')
  if (!config.verify.length) throw new Stop('no stack in the project config verifies. The web-e2e pack does.')
  return config
}

/** `git [args]` run in [cwd], or a Stop carrying git's own last word. */
export function git(cwd, args, env) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: env && { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Stop(`git ${args[0]}: ${result.stderr.trim().split('\n').at(-1)}`)
  return result.stdout
}

/** `skrymer-ai/verify/[parts]` in the git dir of the repo [projectDir] is in, which keeps it out of commits and apart per worktree. */
export function verifyDir(projectDir, ...parts) {
  const top = git(projectDir, ['rev-parse', '--show-toplevel']).trim()
  return join(resolve(top, git(projectDir, ['rev-parse', '--git-path', 'skrymer-ai/verify']).trim()), ...parts)
}

/** [n] emails no earlier run has used, `verify-<run>-<i>@example.invalid`, so each mint is a fresh user. */
export function freshEmails(n) {
  const run = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
  return Array.from({ length: n }, (_, i) => `verify-${run}-${i + 1}@example.invalid`)
}

/**
 * The token [stack]'s `user.mint` prints for [email], its last line of output, run in the stack
 * root of [projectDir] with [env] over this process's; its output is appended to [log].
 */
export function mint(stack, projectDir, email, { env = {}, log } = {}) {
  const [command, ...args] = stack.user.mint.map((word) => word.replaceAll('{email}', email))
  const run = spawnSync(command, args, { cwd: join(projectDir, stack.root), encoding: 'utf8', env: { ...process.env, ...env } })
  if (log) appendFileSync(log, `$ ${[command, ...args].join(' ')}\n${run.stdout ?? ''}${run.stderr ?? ''}`)
  if (run.error || run.status !== 0) {
    throw new Stop(`minting a user failed (${run.error?.message ?? `exit ${run.status}`}): ${(run.stderr || run.stdout || '').trim().split('\n').at(-1)}`)
  }
  const token = run.stdout.trim().split('\n').at(-1)?.trim()
  if (!token) throw new Stop(`minting a user printed no token: \`${stack.user.mint.join(' ')}\` has to print it on its last line.`)
  return token
}

/** Runs [main] with the arguments of this process if [script] is the one Node was started on. */
export function runAsScript(script, name, main) {
  if (process.argv[1] !== script) return
  main(process.argv.slice(2), process.cwd()).catch((error) => {
    process.stdout.write(error instanceof Stop ? `STOP: ${error.message}\n` : `${name} failed: ${error.stack}\n`)
    process.exitCode = 1
  })
}
