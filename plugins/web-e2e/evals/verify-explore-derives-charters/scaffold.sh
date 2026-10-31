#!/usr/bin/env bash
# A web root whose dev server is a small Node API, with issue 12's body beside it. main lists
# and takes TPS reports; the branch adds a report's own endpoint and page, which returns any
# report to anyone signed in. No AC asks who may read a report, so only exploration finds it.
set -euo pipefail
mkdir -p web/public .claude
cat > web/server.mjs <<'JS'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'

const reports = []
const userOf = (req) => {
  const users = existsSync('users.json') ? JSON.parse(readFileSync('users.json', 'utf8')) : {}
  return users[(req.headers.authorization ?? '').replace(/^Bearer /, '')]
}
const send = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))

createServer(async (req, res) => {
  const user = userOf(req)
  if (!req.url.startsWith('/api/')) return res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(existsSync('public/report.html') && req.url.startsWith('/reports/') ? 'public/report.html' : 'public/index.html'))
  if (!user) return send(res, 401, { error: 'sign in' })
  if (req.method === 'GET' && req.url === '/api/reports') return send(res, 200, reports.filter((r) => r.owner === user))
  if (req.method === 'POST' && req.url === '/api/reports') {
    let body = ''
    for await (const chunk of req) body += chunk
    const { coverSheet } = JSON.parse(body || '{}')
    if (!coverSheet?.trim()) return send(res, 422, { error: 'Add a cover sheet' })
    const report = { id: reports.length + 1, owner: user, coverSheet }
    reports.push(report)
    return send(res, 201, report)
  }
  send(res, 404, { error: 'not found' })
}).listen(0, '127.0.0.1', function () {
  console.log(`Local: http://127.0.0.1:${this.address().port}/`)
})
JS
cat > web/mint.mjs <<'JS'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const users = existsSync('users.json') ? JSON.parse(readFileSync('users.json', 'utf8')) : {}
const token = randomBytes(8).toString('hex')
users[token] = process.argv[2]
writeFileSync('users.json', JSON.stringify(users))
console.log(token)
JS
printf "import { defineConfig } from '@playwright/test'\n\nexport default defineConfig({ testDir: 'e2e' })\n" > web/playwright.config.ts
printf '<h1>TPS reports</h1>\n' > web/public/index.html
cat > .claude/skrymer-ai.config.mjs <<'JS'
export default {
  stacks: {
    'web-e2e': {
      roots: ['web'],
      verify: {
        dev: { run: ['node', 'server.mjs'], ready: /Local:\s+(http\S+)/ },
        user: { mint: ['node', 'mint.mjs', '{email}'] },
        api: { base: '/api' },
      },
    },
  },
}
JS
cat > issue-12.md <<'MD'
## What to build

Each of Initech's TPS reports gets its own page, linked from the list, showing its cover sheet.

## Acceptance criteria

- [ ] Opening /reports/<id> shows that report's cover sheet
- [ ] A report that doesn't exist shows "No such report"
MD
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git init -q -b main
printf 'issue-12.md\nweb/users.json\n' >> .git/info/exclude
git add -A
git -c user.email=dev@initech.test -c user.name=dev commit -qm 'List and take TPS reports'
git switch -qc report-page
# The branch's change: a report's own endpoint, which returns any report to anyone signed in.
node -e "
const fs = require('fs')
const s = fs.readFileSync('web/server.mjs', 'utf8')
fs.writeFileSync('web/server.mjs', s.replace('  send(res, 404', fs.readFileSync(0, 'utf8') + '  send(res, 404'))" <<'BRANCH'
  const one = /^\/api\/reports\/(\d+)$/.exec(req.url)
  if (req.method === 'GET' && one) {
    const report = reports.find((r) => r.id === Number(one[1]))
    return report ? send(res, 200, report) : send(res, 404, { error: 'no such report' })
  }
BRANCH
printf '<h1>TPS report</h1>\n<p id="cover-sheet"></p>\n' > web/public/report.html
git add -A
git -c user.email=dev@initech.test -c user.name=dev commit -qm "Give each TPS report its own page"
# The sandbox masks dotfiles in the workspace with files git can't add, which would stop head's
# stamp. The committed config stays tracked.
echo '/.*' >> .git/info/exclude
