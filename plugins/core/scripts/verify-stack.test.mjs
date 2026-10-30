import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { alive, runScript, stackProject, stackState, withVerify } from './verify-fixtures.mjs'

const stack = (dir, ...args) => runScript('verify-stack.mjs', dir, args)
const calls = (dir) => readFileSync(join(dir, 'calls.log'), 'utf8')
const fetchJson = async (url) => (await fetch(url)).json()

test('up brings the stack up with a fresh user in the env file and the dev server it reports; down undoes each step', async (t) => {
  // Given a stack root that already has an .env of the developer's
  const dir = stackProject({ files: { 'web/.env': 'ACME_DEV_TOKEN=the-developers-own\nOTHER=1\n' } })
  t.after(() => stack(dir, 'down'))

  // When the stack comes up with an env override
  const up = stack(dir, 'up', '--env', 'ACME_FLAG=on')

  // Then the stack command ran with the override, and the dev server reads a minted verify user's token from .env
  assert.equal(up.status, 0, up.out)
  const { url, started } = stackState(dir)
  assert.match(up.out, new RegExp(`dev server: ${url}`))
  assert.equal(calls(dir), 'stack-up on\n')
  const served = await fetchJson(new URL('/env', url))
  assert.match(served.env, /^ACME_DEV_TOKEN=token-verify-[a-z0-9]+-1@example\.invalid\nOTHER=1\n$/)
  assert.equal(served.flag, 'on')

  // And when it comes down, the dev server is stopped, the stack's down command ran and the developer's .env is back
  const down = stack(dir, 'down')
  assert.equal(down.status, 0, down.out)
  assert.equal(alive(started[0].pid), false)
  assert.equal(calls(dir), 'stack-up on\nstack-down on\n')
  assert.equal(readFileSync(join(dir, 'web', '.env'), 'utf8'), 'ACME_DEV_TOKEN=the-developers-own\nOTHER=1\n')
  assert.equal(existsSync(join(dir, '.git', 'skrymer-ai', 'verify', 'stack.json')), false)
})

test('an env file the stack created is removed on down', () => {
  // Given a stack root with no .env
  const dir = stackProject()

  // When the stack comes up and goes down
  assert.equal(stack(dir, 'up').status, 0)
  assert.equal(existsSync(join(dir, 'web', '.env')), true)
  stack(dir, 'down')

  // Then there is no .env, as before
  assert.equal(existsSync(join(dir, 'web', '.env')), false)
})

test('--disposable-db brings the disposable database up after the stack and down before it', () => {
  // Given the fixture stack
  const dir = stackProject()

  // When it comes up with a disposable database and goes down
  const up = stack(dir, 'up', '--disposable-db')
  stack(dir, 'down')

  // Then the database came up after the stack and went down first
  assert.equal(up.status, 0, up.out)
  assert.equal(calls(dir), 'stack-up -\ndb-up -\ndb-down -\nstack-down -\n')
})

test('--disposable-db without a configured database stops before starting anything', () => {
  // Given a verify block with only a dev server
  const dir = stackProject({ config: `{ dev: { run: ['node', 'dev-server.mjs'], ready: /Local:\\s+(http\\S+)/ } }` })

  // When the stack is asked for a disposable database
  const { status, out } = stack(dir, 'up', '--disposable-db')

  // Then it stops naming the missing field, and nothing was started
  assert.equal(status, 1)
  assert.match(out, /stacks\.web-e2e\.verify\.stack\.disposableDb/)
  assert.equal(existsSync(join(dir, '.git', 'skrymer-ai', 'verify', 'stack.json')), false)
})

test('down never stops a process it did not start, even one now holding a recorded PID', async (t) => {
  // Given a stack that is up, and a process of someone else's
  const dir = stackProject()
  assert.equal(stack(dir, 'up').status, 0)
  const other = spawn('node', ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  t.after(() => other.kill())
  await new Promise((resolve) => other.once('spawn', resolve))

  // When the state file is made to claim that process, as if its PID had been reused
  const state = stackState(dir)
  const ours = state.started[0].pid
  state.started.push({ ...state.started[0], pid: other.pid })
  writeFileSync(join(dir, '.git', 'skrymer-ai', 'verify', 'stack.json'), JSON.stringify(state))
  const { status, out } = stack(dir, 'down')

  // Then down stops its own dev server and leaves the other process running, saying why
  assert.equal(status, 0, out)
  assert.equal(alive(ours), false)
  assert.equal(alive(other.pid), true)
  assert.match(out, new RegExp(`pid ${other.pid} is no longer the process verify-stack started; left running`))
})

test('up fails closed when the URL the dev log reports is answered by a server it did not start, and undoes what it did', async (t) => {
  // Given another worktree's server, and a dev server that reports that server's URL instead of its own
  const elsewhere = createServer((_, res) => res.end('other code'))
  await new Promise((resolve) => elsewhere.listen(0, '127.0.0.1', resolve))
  t.after(() => elsewhere.close())
  const url = `http://127.0.0.1:${elsewhere.address().port}/`
  const dir = stackProject({ files: { 'web/.env': 'OTHER=1\n' } })

  // When the stack comes up
  const { status, out } = runScript('verify-stack.mjs', dir, ['up'], { ANSWER_URL: url })

  // Then it refuses to use that server, naming who answers, and has undone every step
  assert.equal(status, 1, out)
  assert.match(out, new RegExp(`${url.replace(/[/.]/g, '\\$&')} is answered by pid ${process.pid}`))
  assert.match(out, /not a process verify-stack started/)
  assert.equal(calls(dir), 'stack-up -\nstack-down -\n')
  assert.equal(readFileSync(join(dir, 'web', '.env'), 'utf8'), 'OTHER=1\n')
  assert.equal(existsSync(join(dir, '.git', 'skrymer-ai', 'verify', 'stack.json')), false)
})

test('up stops when the configured port is already held, before starting anything', async (t) => {
  // Given a server already on the port the verify block names
  const elsewhere = createServer((_, res) => res.end('other code'))
  await new Promise((resolve) => elsewhere.listen(0, '127.0.0.1', resolve))
  t.after(() => elsewhere.close())
  const port = elsewhere.address().port
  const dir = stackProject({ config: withVerify('').replace("ready:", `port: ${port}, ready:`) })

  // When the stack comes up
  const { status, out } = stack(dir, 'up')

  // Then it stops naming the process on the port, and nothing ran
  assert.equal(status, 1, out)
  assert.match(out, new RegExp(`port ${port} is already held by pid ${process.pid}`))
  assert.equal(existsSync(join(dir, 'calls.log')), false)
})

test('a dev server that exits before it is ready stops up with the end of its log', () => {
  // Given a dev server that dies at start
  const dir = stackProject()

  // When the stack comes up
  const { status, out } = runScript('verify-stack.mjs', dir, ['up'], { DIE_EARLY: '1' })

  // Then up stops quoting the log, after taking the stack down again
  assert.equal(status, 1, out)
  assert.match(out, /the dev server exited \(1\) before its log matched/)
  assert.match(out, /EADDRINUSE/)
  assert.equal(calls(dir), 'stack-up -\nstack-down -\n')
})

test('a mint command that fails stops up with its own word', () => {
  // Given a mint command that refuses the email it is given
  const dir = stackProject({ config: withVerify('').replace("'{email}'", "'refuse-{email}'") })

  // When the stack comes up
  const { status, out } = stack(dir, 'up')

  // Then up stops with the mint command's error
  assert.equal(status, 1, out)
  assert.match(out, /minting a user failed \(exit 3\): acme: no such tenant/)
})

test('up refuses to start a second stack over one that is up', (t) => {
  // Given a stack that is up
  const dir = stackProject()
  t.after(() => stack(dir, 'down'))
  assert.equal(stack(dir, 'up').status, 0)

  // When it is brought up again
  const { status, out } = stack(dir, 'up')

  // Then it refuses, pointing at down
  assert.equal(status, 1)
  assert.match(out, /a verify stack is already up at http/)
})

test('down with nothing up says so and succeeds', () => {
  // Given a project with no stack up
  const dir = stackProject()

  // When down runs
  const { status, out } = stack(dir, 'down')

  // Then it reports nothing to stop
  assert.equal(status, 0)
  assert.match(out, /no verify stack is up/)
})

test('a bad --env stops up before starting anything', () => {
  // Given the fixture stack
  const dir = stackProject()

  // When the override has no value
  const { status, out } = stack(dir, 'up', '--env', 'ACME_FLAG')

  // Then up stops naming the expected shape
  assert.equal(status, 1)
  assert.match(out, /--env "ACME_FLAG": expected NAME=value/)
})
