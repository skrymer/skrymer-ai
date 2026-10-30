#!/usr/bin/env node
/**
 * The API probe: drives the API of the stack `verify-stack.mjs up` brought up, through the dev
 * server's proxy as the browser does, to seed what a walk-through needs or to check a rule the
 * screen doesn't show. A hand-rolled harness once sent the CSRF pair wrong and silently
 * admitted test data, so the cookie jar and the pair are handled here, once.
 *
 *   node verify-api.mjs users <n>
 *       mints n fresh users through `user.mint`, one `verify-<run>-<i>@example.invalid` each,
 *       and prints `email<TAB>token` per user.
 *   node verify-api.mjs request <METHOD> <path> [--as <email|token>] [--data <json>] [--expect <status>]
 *       sends METHOD to `api.base` + path at the dev server's URL, as a minted user (by address)
 *       or a token, through `api.auth`. It prints `HTTP <status>` and the body, and fails on a
 *       status of 400 or more, or on any status but the one --expect names.
 *
 * Each identity has its own cookie jar. Before a request that isn't GET, HEAD or OPTIONS, when
 * the config names `api.csrf`, the probe GETs `api.base` + `api.csrf.prime` unless the jar
 * already holds the CSRF cookie, then sends the cookie's value back, decoded as a browser
 * client does, in the CSRF header. An API that sets no such cookie stops the request rather
 * than letting it go without the pair. Users and jars live in `skrymer-ai/verify/probe/` in the
 * repo's git dir, and last as long as the stack.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { freshEmails, mint, runAsScript, Stop, verifyConfig, verifyDir } from './verify-common.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
const SAFE = ['GET', 'HEAD', 'OPTIONS']

async function main(argv, projectDir) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { as: { type: 'string' }, data: { type: 'string' }, expect: { type: 'string' } },
  })
  const [command, ...args] = positionals
  const { stack, state } = await upStack(projectDir)
  const dir = verifyDir(projectDir, 'probe')
  mkdirSync(join(dir, 'jars'), { recursive: true })
  if (command === 'users' && args.length === 1 && /^[1-9]\d*$/.test(args[0])) return users(stack, state, projectDir, dir, Number(args[0]))
  if (command === 'request' && args.length === 2) return request(stack, state, dir, args, values)
  throw new Stop('usage: verify-api.mjs users <n> | request <METHOD> <path> [--as <email|token>] [--data <json>] [--expect <status>]')
}

/** The verify stack that is up, with the state `verify-stack up` recorded for it. */
async function upStack(projectDir) {
  const statePath = verifyDir(projectDir, 'stack.json')
  if (!existsSync(statePath)) throw new Stop(`no verify stack is up. Bring one up first: node ${join(SCRIPT, '..', 'verify-stack.mjs')} up`)
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  if (!state.url) throw new Stop('the verify stack is still coming up: it has no dev server URL yet.')
  const stack = (await verifyConfig(projectDir)).verify.find((candidate) => candidate.root === state.root)
  if (!stack) throw new Stop(`the stack that is up, under "${state.root || '.'}", is no longer in the project config. Take it down: node ${join(SCRIPT, '..', 'verify-stack.mjs')} down`)
  return { stack, state }
}

function users(stack, state, projectDir, dir, n) {
  if (!stack.user) throw new Stop(`stacks.${stack.pack}.verify.user names no command that mints a user.`)
  const minted = freshEmails(n).map((email) => [email, mint(stack, projectDir, email, { env: state.env })])
  appendFileSync(join(dir, 'users.tsv'), minted.map((row) => `${row.join('\t')}\n`).join(''))
  process.stdout.write(minted.map((row) => `${row.join('\t')}\n`).join(''))
}

async function request(stack, state, dir, [method, path], { as, data, expect }) {
  if (!stack.api) throw new Stop(`stacks.${stack.pack}.verify.api names no API to probe, such as { base: '/api' }.`)
  if (!path.startsWith('/')) throw new Stop(`"${path}": expected a path under ${stack.api.base}, starting with /.`)
  if (expect !== undefined && !/^\d{3}$/.test(expect)) throw new Stop(`--expect "${expect}": expected an HTTP status such as 403.`)
  const verb = method.toUpperCase()
  const token = as === undefined ? null : tokenOf(dir, as)
  const jarPath = join(dir, 'jars', `${token === null ? 'anonymous' : createHash('sha256').update(token).digest('hex').slice(0, 16)}.json`)
  const jar = existsSync(jarPath) ? JSON.parse(readFileSync(jarPath, 'utf8')) : {}
  const send = async (verbToSend, at, body) => {
    const headers = {}
    if (token !== null) headers[stack.api.auth.header] = stack.api.auth.value.replaceAll('{token}', token)
    if (Object.keys(jar).length) headers.cookie = Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ')
    if (body !== undefined) headers['content-type'] = 'application/json'
    const { csrf } = stack.api
    if (csrf && !SAFE.includes(verbToSend)) {
      if (jar[csrf.cookie] === undefined) throw new Stop(`GET ${stack.api.base}${csrf.prime} set no ${csrf.cookie} cookie, so the CSRF pair can't be sent with ${verb} ${path}. Check api.csrf in the verify block.`)
      headers[csrf.header] = decodeURIComponent(jar[csrf.cookie])
    }
    const url = new URL(`${stack.api.base}${at}`.replace(/\/{2,}/g, '/'), state.url)
    let response
    try {
      response = await fetch(url, { method: verbToSend, headers, body, redirect: 'manual' })
    } catch (error) {
      throw new Stop(`${verbToSend} ${url} failed: ${error.cause?.message ?? error.message}. Is the dev server still up?`)
    }
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(';')
      const name = pair.slice(0, pair.indexOf('=')).trim()
      const expired = attributes.some((a) => /^\s*max-age\s*=\s*(0|-\d+)\s*$/i.test(a) || (/^\s*expires\s*=/i.test(a) && Date.parse(a.split('=')[1]) < Date.now()))
      if (expired) delete jar[name]
      else jar[name] = pair.slice(pair.indexOf('=') + 1).trim()
    }
    writeFileSync(jarPath, JSON.stringify(jar))
    return response
  }
  if (stack.api.csrf && !SAFE.includes(verb) && jar[stack.api.csrf.cookie] === undefined) await send('GET', stack.api.csrf.prime || '')
  const response = await send(verb, path, data)
  process.stdout.write(`HTTP ${response.status}\n${await response.text()}\n`)
  if (expect !== undefined && response.status !== Number(expect)) {
    process.stdout.write(`expected HTTP ${expect}, got ${response.status}\n`)
    process.exitCode = 1
  } else if (expect === undefined && response.status >= 400) process.exitCode = 1
}

/** The token [as] stands for: a minted user's, by address, or [as] itself. */
function tokenOf(dir, as) {
  if (!as.includes('@')) return as
  const users = existsSync(join(dir, 'users.tsv')) ? readFileSync(join(dir, 'users.tsv'), 'utf8') : ''
  const row = users.split('\n').find((line) => line.startsWith(`${as}\t`))
  if (!row) throw new Stop(`no user ${as} was minted since the stack came up. Mint one: node ${SCRIPT} users 1`)
  return row.split('\t')[1]
}

runAsScript(SCRIPT, 'verify-api', main)
