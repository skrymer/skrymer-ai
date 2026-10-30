/**
 * Fixtures the verify scripts' tests share: a temp project whose web-e2e stack starts stand-in
 * commands and a stand-in dev server, and a way to run a script in it.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Git without the developer's own config, so a global signing key or hook can't reach the fixtures. */
export const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

/** Appends its first argument and `ACME_FLAG` to `calls.log` in the directory it runs in. */
const RECORD = `
import { appendFileSync } from 'node:fs'
appendFileSync('calls.log', \`\${process.argv[2]} \${process.env.ACME_FLAG ?? '-'}\\n\`)
`

/** Prints a token for the --email it is given, or fails for one it is told to refuse. */
const MINT = `
const email = process.argv[process.argv.indexOf('--email') + 1]
if (email.includes('refuse')) { console.error('acme: no such tenant'); process.exit(3) }
console.log('minting a user')
console.log(\`token-\${email}\`)
`

/**
 * A stand-in dev server. It listens on a free port, or does nothing and prints the URL in
 * `ANSWER_URL` when that is set, and logs the URL as Nuxt does. It serves:
 *   GET /env            the .env it started with and its ACME_FLAG
 *   GET /api/...        sets an XSRF-TOKEN cookie, URL-encoded as a framework would, and answers 200
 *   POST /api/orders    201 when the bearer token and the decoded CSRF cookie are sent back, else 401 / 403
 *   GET /api/orders     the orders admitted so far for the bearer token
 * With `DIE_EARLY` set it exits before it is ready.
 */
const DEV_SERVER = `
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
if (process.env.DIE_EARLY) { console.error('Error: listen EADDRINUSE: address already in use'); process.exit(1) }
const CSRF = 'a+b/c=='
const orders = {}
const cookies = (req) => Object.fromEntries((req.headers.cookie ?? '').split(/;\\s*/).filter(Boolean).map((c) => c.split('=')))
const server = createServer((req, res) => {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
  if (req.url === '/env') return res.end(JSON.stringify({ env: existsSync('.env') ? readFileSync('.env', 'utf8') : null, flag: process.env.ACME_FLAG ?? null }))
  if (!req.url.startsWith('/api')) { res.statusCode = 404; return res.end() }
  res.setHeader('Set-Cookie', [\`XSRF-TOKEN=\${encodeURIComponent(CSRF)}; Path=/\`, 'SESSION=s1; Path=/; HttpOnly'])
  if (req.method === 'GET' && req.url === '/api/orders') return res.end(JSON.stringify(orders[token] ?? []))
  if (req.method === 'GET') return res.end('{}')
  if (!token) { res.statusCode = 401; return res.end('{"error":"unauthenticated"}') }
  if (req.headers['x-xsrf-token'] !== CSRF || cookies(req)['XSRF-TOKEN'] !== encodeURIComponent(CSRF)) { res.statusCode = 403; return res.end('{"error":"csrf"}') }
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    ;(orders[token] ??= []).push(JSON.parse(body))
    res.statusCode = 201
    res.end(body)
  })
})
if (process.env.ANSWER_URL) {
  console.log(\`  ➜ Local:   \${process.env.ANSWER_URL}\`)
  setInterval(() => {}, 1000)
} else {
  server.listen(0, '127.0.0.1', () => console.log(\`  ➜ Local:   http://127.0.0.1:\${server.address().port}/\`))
}
`

/** The verify block of the fixture's config, with [extra] fields spliced in. */
const verifyBlock = (extra) => `{
  stack: { up: ['node', 'record.mjs', 'stack-up'], down: ['node', 'record.mjs', 'stack-down'], disposableDb: { up: ['node', 'record.mjs', 'db-up'], down: ['node', 'record.mjs', 'db-down'] } },
  dev: { run: ['node', 'dev-server.mjs'], ready: /Local:\\s+(http\\S+)/ },
  user: { mint: ['node', 'mint.mjs', '--email', '{email}'], env: { file: '.env', key: 'ACME_DEV_TOKEN' } },
  api: { base: '/api', csrf: { cookie: 'XSRF-TOKEN', header: 'X-XSRF-TOKEN' } },
  ${extra}
}`

/**
 * A temp project in a git repo with a web-e2e stack under `web` whose verify block runs the
 * stand-ins: `record.mjs` for the stack and database commands, which run in the project root,
 * `mint.mjs` for users and `dev-server.mjs` as the dev server, which run in the stack root.
 * [config] replaces the verify block; [files] adds files.
 */
export function stackProject({ config = verifyBlock(''), files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-project-'))
  const write = (all) => {
    for (const [file, content] of Object.entries(all)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true })
      writeFileSync(join(dir, file), content)
    }
  }
  write({
    '.claude/skrymer-ai.config.mjs': `export default { stacks: { 'web-e2e': { roots: ['web'], verify: ${config} } } }\n`,
    'record.mjs': RECORD,
    'web/mint.mjs': MINT,
    'web/dev-server.mjs': DEV_SERVER,
    '.gitignore': 'calls.log\n.env\n',
    ...files,
  })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: { ...process.env, ...GIT_ENV } })
  return dir
}

export const withVerify = verifyBlock

/** Runs [script] in [dir] with [args] and [env], returning its status and output. */
export function runScript(script, dir, args, env = {}) {
  const run = spawnSync('node', [join(HERE, script), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, ...env }, timeout: 60_000 })
  return { status: run.status, out: run.stdout + run.stderr }
}

/** The state file `verify-stack up` leaves in [dir]'s git dir. */
export const stackState = (dir) => JSON.parse(readFileSync(join(dir, '.git', 'skrymer-ai', 'verify', 'stack.json'), 'utf8'))

/** Whether a process [pid] is alive. */
export function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
