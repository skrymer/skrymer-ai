#!/usr/bin/env node
/**
 * Brings a project's stack up for a verify walk-through and takes it down again, from the
 * commands its config names, so that no step is a prose recipe a session retypes.
 *
 *   node verify-stack.mjs up [--disposable-db] [--env NAME=value …] [--root <root>]
 *   node verify-stack.mjs down
 *
 * `up` runs, in order: the stack's `up` command and, with --disposable-db, the database's (both
 * in the project root); `user.mint` for a fresh verify user, whose token replaces `user.env.key`
 * in `user.env.file`; then the dev server, in the stack root, until a line of its log matches
 * `dev.ready`. Each --env override reaches every command. The dev server is driven at the URL
 * its log reports, never at the port it was asked for, since a dev server moves to another
 * port when its own is taken. `up` then checks that the listener on that port is a process it
 * started, and fails closed when it isn't: the answer would come from another worktree's
 * server, running other code. A `dev.port` that is already held stops `up` before it starts
 * anything. When any step fails, `up` undoes the ones before it.
 *
 * Every process it starts (with its start time, so a reused PID is never mistaken for it),
 * every command to undo and every file it changed (with what was there before) is recorded in
 * `skrymer-ai/verify/stack.json` in the repo's git dir. `down` stops only those processes,
 * runs only those commands, newest first, and restores only those files. Commands' output goes
 * to `stack.log` and the dev server's to `dev.log` beside it. Bringing the stack up or down
 * also forgets the users and cookies the API probe (`verify-api.mjs`) kept for the last one.
 *
 * `SKRYMER_AI_VERIFY_READY_TIMEOUT` is how many seconds `up` waits for the dev log (120).
 */

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { freshEmails, mint, runAsScript, Stop, verifyConfig, verifyDir } from './verify-common.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
const STOP_GRACE_MS = 10_000
/** Where the API probe keeps the users it minted and their cookies, which last as long as the stack. */
const PROBE = 'probe'

async function main(argv, projectDir) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { 'disposable-db': { type: 'boolean' }, env: { type: 'string', multiple: true }, root: { type: 'string' } },
  })
  const [command, ...rest] = positionals
  if (command === 'down' && !rest.length) return down(projectDir)
  if (command === 'up' && !rest.length) return up(projectDir, values)
  throw new Stop('usage: verify-stack.mjs up [--disposable-db] [--env NAME=value …] [--root <root>] | down')
}

async function up(projectDir, options) {
  const env = Object.fromEntries(
    (options.env ?? []).map((pair) => {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(pair)
      if (!match) throw new Stop(`--env "${pair}": expected NAME=value.`)
      return [match[1], match[2]]
    })
  )
  const stack = stackOf((await verifyConfig(projectDir)).verify, options.root)
  const label = `stacks.${stack.pack}.verify`
  if (options['disposable-db'] && !stack.stack?.disposableDb) throw new Stop(`--disposable-db: ${label}.stack.disposableDb names no database to bring up.`)
  const dir = verifyDir(projectDir)
  const statePath = join(dir, 'stack.json')
  if (existsSync(statePath)) throw new Stop(`a verify stack is already up at ${JSON.parse(readFileSync(statePath, 'utf8')).url ?? '(no URL yet)'}. Take it down first: node ${SCRIPT} down`)
  if (stack.dev.port) {
    const holder = listeners(stack.dev.port)[0]
    if (holder !== undefined) throw new Stop(`port ${stack.dev.port} is already held by ${processName(holder)}. Stop that server, or free the port, before the walk-through starts its own.`)
  }

  mkdirSync(dir, { recursive: true })
  rmSync(join(dir, PROBE), { recursive: true, force: true })
  const log = join(dir, 'stack.log')
  writeFileSync(log, '')
  const state = { root: stack.root, env, started: [], undo: [], files: [] }
  const save = () => writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  save()
  try {
    const run = (command, cwd, undo) => {
      exec(command, cwd, env, log)
      if (undo) state.undo.push({ command: undo, cwd })
      save()
    }
    if (stack.stack) run(stack.stack.up, projectDir, stack.stack.down)
    if (options['disposable-db']) run(stack.stack.disposableDb.up, projectDir, stack.stack.disposableDb.down)
    const rootDir = join(projectDir, stack.root)
    if (stack.user?.env) {
      const [email] = freshEmails(1)
      const token = mint(stack, projectDir, email, { env, log })
      const file = join(rootDir, stack.user.env.file)
      const before = existsSync(file) ? readFileSync(file, 'utf8') : null
      state.files.push({ path: file, before })
      save()
      writeFileSync(file, withEnv(before ?? '', stack.user.env.key, token))
      state.user = email
      save()
    }
    const devLog = join(dir, 'dev.log')
    const server = await startDev(stack.dev, rootDir, env, devLog, state, save)
    state.url = server.url
    save()
    const port = Number(new URL(server.url).port || (new URL(server.url).protocol === 'https:' ? 443 : 80))
    const owners = listeners(port)
    if (!owners.length) throw new Stop(`nothing on this machine listens on port ${port}, which the dev log reports (${server.url}).`)
    const stranger = owners.find((pid) => !descendsFrom(pid, server.pid))
    if (stranger !== undefined) {
      throw new Stop(`${server.url} is answered by ${processName(stranger)}, not a process verify-stack started: most likely another worktree's server, running other code. Stop it or free the port, then bring the stack up again.`)
    }
    const lines = [`dev server: ${server.url}`, `  pid ${server.pid}, log ${devLog}`]
    if (state.user) lines.push(`  signed in as ${state.user} through ${stack.user.env.key} in ${stack.user.env.file}`)
    lines.push(`  take it down with: node ${SCRIPT} down`)
    process.stdout.write(`${lines.join('\n')}\n`)
  } catch (error) {
    const undone = await undo(state)
    rmSync(statePath, { force: true })
    if (error instanceof Stop) throw new Stop(`${error.message}\nup undid what it had done:\n${undone.map((line) => `  ${line}`).join('\n') || '  nothing'}\nCommand output: ${log}`)
    throw error
  }
}

/** The verify stack that names a dev server, the one under [root] when several do. */
function stackOf(stacks, root) {
  const runnable = stacks.filter((stack) => stack.dev && (root === undefined || stack.root === root.replace(/^\.\/+/, '').replace(/\/+$/, '').replace(/^\.$/, '')))
  if (runnable.length === 1) return runnable[0]
  const roots = stacks.filter((stack) => stack.dev).map((stack) => stack.root || '.')
  if (!runnable.length && root !== undefined) throw new Stop(`no verify stack with a dev server is under "${root}". Roots: ${roots.join(', ') || 'none'}.`)
  if (!runnable.length) throw new Stop(`no verify stack names a dev server. Add verify.dev, such as { run: ['pnpm', 'dev'], ready: /Local:\\s+(http\\S+)/ }, under stacks.${stacks[0].pack}.`)
  throw new Stop(`several verify stacks name a dev server; pick one with --root. Roots: ${roots.join(', ')}.`)
}

/** Runs [command] in [cwd] to completion with [env], its output appended to [log]; a Stop if it fails. */
function exec(command, cwd, env, log) {
  appendFileSync(log, `$ ${command.join(' ')}\n`)
  const out = openSync(log, 'a')
  const run = spawnSync(command[0], command.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ['ignore', out, out] })
  closeSync(out)
  if (run.error || run.status !== 0) throw new Stop(`\`${command.join(' ')}\` failed (${run.error?.message ?? `exit ${run.status ?? run.signal}`}).`)
}

/**
 * Starts [dev] in its own process group with its output in [log], records it in [state], and
 * waits for a log line [dev.ready] matches. `{ pid, url }`, the URL being the pattern's group.
 */
async function startDev(dev, cwd, env, log, state, save) {
  const out = openSync(log, 'w')
  const child = spawn(dev.run[0], dev.run.slice(1), {
    cwd,
    env: { ...process.env, ...env, NO_COLOR: '1', FORCE_COLOR: '0' },
    stdio: ['ignore', out, out],
    detached: true,
  })
  closeSync(out)
  const failed = new Promise((resolve) => {
    child.once('error', (error) => resolve(error.message))
    child.once('exit', (code, signal) => resolve(code ?? signal))
  })
  await new Promise((resolve) => child.once('spawn', resolve).once('error', resolve))
  if (child.pid) {
    state.started.push({ pid: child.pid, startTime: startTimeOf(child.pid), command: dev.run, cwd })
    save()
  }
  const seconds = Number(process.env.SKRYMER_AI_VERIFY_READY_TIMEOUT ?? 120)
  const deadline = Date.now() + seconds * 1000
  const tail = () => readFileSync(log, 'utf8').trim().split('\n').slice(-10).map((line) => `  | ${line}`).join('\n')
  let exit
  failed.then((why) => (exit = why))
  while (Date.now() < deadline) {
    const url = dev.ready.exec(stripAnsi(readFileSync(log, 'utf8')))?.[1]
    if (url) {
      child.unref()
      return { pid: child.pid, url }
    }
    if (exit !== undefined) throw new Stop(`the dev server exited (${exit}) before its log matched ${dev.ready}:\n${tail()}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Stop(`the dev log matched ${dev.ready} in no line within ${seconds}s:\n${tail()}`)
}

async function down(projectDir) {
  const statePath = verifyDir(projectDir, 'stack.json')
  if (!existsSync(statePath)) {
    process.stdout.write('no verify stack is up.\n')
    return
  }
  const lines = await undo(JSON.parse(readFileSync(statePath, 'utf8')))
  rmSync(statePath)
  rmSync(verifyDir(projectDir, PROBE), { recursive: true, force: true })
  process.stdout.write(`verify stack down:\n${lines.map((line) => `  ${line}`).join('\n') || '  nothing was up'}\n`)
}

/**
 * Undoes what [state] records, newest first: stops each process it started that is still the
 * same process, runs each undo command, and puts back each file. One line per step, saying
 * what happened.
 */
async function undo(state) {
  const lines = []
  for (const { pid, startTime, command } of [...state.started].reverse()) {
    const now = startTimeOf(pid)
    if (now && now !== startTime) {
      lines.push(`pid ${pid} is no longer the process verify-stack started; left running`)
      continue
    }
    if (!now && !groupAlive(pid)) {
      lines.push(`${command.join(' ')} (pid ${pid}) had already exited`)
      continue
    }
    await stopGroup(pid)
    lines.push(`stopped ${command.join(' ')} (pid ${pid})`)
  }
  for (const { command, cwd } of [...state.undo].reverse()) {
    const run = spawnSync(command[0], command.slice(1), { cwd, env: { ...process.env, ...state.env }, encoding: 'utf8' })
    const ok = !run.error && run.status === 0
    lines.push(ok ? `ran ${command.join(' ')}` : `\`${command.join(' ')}\` failed (${run.error?.message ?? `exit ${run.status}`}): ${(run.stderr || run.stdout || '').trim().split('\n').at(-1)}`)
  }
  for (const { path, before } of [...state.files].reverse()) {
    if (before === null) rmSync(path, { force: true })
    else writeFileSync(path, before)
    lines.push(before === null ? `removed ${path}` : `restored ${path}`)
  }
  return lines
}

/**
 * Stops the process group led by [pid]: TERM, then KILL after a grace period. A group's ID is
 * never handed to a new process while the group lives, so the group is still the one started.
 * It waits without blocking, so a dev server this process started is reaped as it exits.
 */
async function stopGroup(pid) {
  const signal = (name) => {
    try {
      process.kill(-pid, name)
    } catch {}
  }
  signal('SIGTERM')
  const deadline = Date.now() + STOP_GRACE_MS
  while (groupAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  if (groupAlive(pid)) signal('SIGKILL')
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * When [pid] started, or null when there is no such process: in clock ticks since boot on
 * Linux, else as `ps` reports it, to the second. With the command line, so that a PID reused
 * within that second by another program still doesn't match.
 */
function startTimeOf(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim()
      return `${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]} ${args}`
    } catch {
      return null
    }
  }
  const started = ps(pid, 'lstart')
  return started ? `${started} ${ps(pid, 'args')}` : null
}

/** Whether [pid] is [ancestor] or one of its descendants, or in the process group [ancestor] leads. */
function descendsFrom(pid, ancestor) {
  if (Number(ps(pid, 'pgid')) === ancestor) return true
  for (let current = pid, hops = 0; current > 1 && hops < 64; hops++) {
    if (current === ancestor) return true
    current = Number(ps(current, 'ppid'))
  }
  return false
}

function ps(pid, field) {
  const run = spawnSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' })
  return run.status === 0 ? run.stdout.trim() : ''
}

/** The PIDs listening on TCP [port], from /proc on Linux and lsof elsewhere. */
function listeners(port) {
  if (process.platform !== 'linux') {
    const run = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
    return [...new Set(run.stdout?.split('\n').filter(Boolean).map(Number) ?? [])]
  }
  const hex = port.toString(16).toUpperCase().padStart(4, '0')
  const inodes = new Set()
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    if (!existsSync(table)) continue
    for (const line of readFileSync(table, 'utf8').split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/)
      if (fields[1]?.endsWith(`:${hex}`) && fields[3] === '0A') inodes.add(fields[9])
    }
  }
  if (!inodes.size) return []
  const pids = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    let fds
    try {
      fds = readdirSync(`/proc/${entry}/fd`)
    } catch {
      continue
    }
    const holds = fds.some((fd) => {
      try {
        return inodes.has(/^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${entry}/fd/${fd}`))?.[1])
      } catch {
        return false
      }
    })
    if (holds) pids.push(Number(entry))
  }
  // A listening socket no readable process holds belongs to a process this user can't inspect.
  return pids.length ? pids : [0]
}

/** `pid <n> (in <dir>)` for a process, its directory where it can be read; 0 is one this user can't inspect. */
function processName(pid) {
  if (!pid) return 'a process this user cannot inspect'
  try {
    return `pid ${pid} (in ${readlinkSync(`/proc/${pid}/cwd`)})`
  } catch {
    return `pid ${pid}`
  }
}

/** [text] with [key] set to [value]: its line replaced where there is one, else appended. */
function withEnv(text, key, value) {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  if (pattern.test(text)) return text.replace(pattern, line)
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`
}

const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

runAsScript(SCRIPT, 'verify-stack', main)
