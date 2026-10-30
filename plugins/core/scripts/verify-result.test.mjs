import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'verify-result.mjs')

/** Git without the developer's own config, so a global signing key or hook can't reach the fixtures. */
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.email=dev@acme.test', '-c', 'user.name=dev', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim()

const ISSUE = `## What to build

Initech's order history.

- [ ] not an AC: a list before the criteria

## Acceptance criteria

- [x] The order list shows the newest order first
- [ ] An empty history says so
- [ ] Totals are computed on the server

## Blocked by

- [ ] #3
`

/**
 * A temp project in a git repo with a web-e2e stack under `web` at [targets], or the pack's
 * default targets, and a stub `gh` that prints [issue] as issue 8's body and fails for any other.
 */
function project({ targets, issue = ISSUE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-result-project-'))
  const verify = targets ? `, verify: { targets: ${JSON.stringify(targets)} }` : ''
  mkdirSync(join(dir, '.claude'))
  mkdirSync(join(dir, 'web'))
  writeFileSync(join(dir, '.claude', 'skrymer-ai.config.mjs'), `export default { stacks: { 'web-e2e': { roots: ['web']${verify} } } }\n`)
  writeFileSync(join(dir, 'web', 'page.ts'), 'export const page = 1\n')
  writeFileSync(join(dir, 'shot.png'), 'png')
  writeFileSync(join(dir, '.gitignore'), 'shot.png\nbin/\n')
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'base')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'issue.md'), issue)
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.slice(0, 3).join(' ') !== 'issue view 8') { console.error('GraphQL: Could not resolve to an issue with the number of ' + args[2]); process.exit(1) }
process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(join(bin, 'issue.md'))}, 'utf8'))
`
  )
  chmodSync(join(bin, 'gh'), 0o755)
  return dir
}

/** Runs the results script in [dir] with [args], with the stub `gh` first on the PATH. */
function result(dir, ...args) {
  const run = spawnSync('node', [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV, PATH: `${join(dir, 'bin')}${delimiter}${process.env.PATH}` },
  })
  return { status: run.status, out: run.stdout + run.stderr }
}

const verifyDir = (dir, ...parts) => join(dir, '.git', 'skrymer-ai', 'verify', '8', ...parts)
const rows = (dir) => readFileSync(verifyDir(dir, 'results.tsv'), 'utf8')

/** Records every AC of issue 8 at both default targets, the third one as not visible. */
function recordAll(dir) {
  for (const ac of ['AC-8.1', 'AC-8.2']) {
    for (const target of ['desktop', 'phone']) assert.equal(result(dir, 'record', ac, target, 'pass', '--screenshot', 'shot.png').status, 0)
  }
  assert.equal(result(dir, 'record', 'AC-8.3', '-', 'not-visible', '--note', 'a backend-only rule').status, 0)
}

test('head stamps the commit and the uncommitted diff the walk-through runs on', () => {
  // Given a project with an uncommitted change and a new file
  const dir = project()
  writeFileSync(join(dir, 'web', 'page.ts'), 'export const page = 2\n')
  writeFileSync(join(dir, 'web', 'new.ts'), 'export const fresh = true\n')

  // When head runs for issue 8
  const { status, out } = result(dir, 'head', '8')

  // Then the head file holds HEAD's commit and a hash of the diff, untracked files included
  assert.equal(status, 0, out)
  const [commit, diff] = readFileSync(verifyDir(dir, 'head'), 'utf8').trim().split('\n')
  assert.equal(commit, `commit ${git(dir, 'rev-parse', 'HEAD')}`)
  assert.match(diff, /^diff [0-9a-f]{64}$/)

  // And when the new file changes, the hash changes with it
  writeFileSync(join(dir, 'web', 'new.ts'), 'export const fresh = false\n')
  result(dir, 'head', '8')
  assert.notEqual(readFileSync(verifyDir(dir, 'head'), 'utf8').trim().split('\n')[1], diff)
})

test('head on a clean tree says so instead of hashing nothing', () => {
  // Given a project with nothing uncommitted
  const dir = project()

  // When head runs
  result(dir, 'head', '8')

  // Then the diff line says the tree is clean
  assert.equal(readFileSync(verifyDir(dir, 'head'), 'utf8'), `commit ${git(dir, 'rev-parse', 'HEAD')}\ndiff clean\n`)
})

test('record writes a row with the screenshot copied beside the results', () => {
  // Given a project whose head is stamped
  const dir = project()
  result(dir, 'head', '8')

  // When an AC is recorded as passing at desktop with a screenshot
  const { status, out } = result(dir, 'record', 'AC-8.1', 'desktop', 'pass', '--screenshot', 'shot.png')

  // Then the row names the copied screenshot and has an empty note
  assert.equal(status, 0, out)
  assert.equal(rows(dir), 'AC-8.1\tdesktop\tpass\tAC-8.1-desktop.png\t\n')
  assert.equal(readFileSync(verifyDir(dir, 'AC-8.1-desktop.png'), 'utf8'), 'png')
})

test('recording an AC again at the same target replaces its row', () => {
  // Given an AC recorded as failing at phone
  const dir = project()
  result(dir, 'head', '8')
  result(dir, 'record', 'AC-8.2', 'phone', 'fail', '--screenshot', 'shot.png', '--note', 'the empty state overflows')
  result(dir, 'record', 'AC-8.2', 'desktop', 'pass', '--screenshot', 'shot.png')

  // When it is re-driven at phone and passes
  result(dir, 'record', 'AC-8.2', 'phone', 'pass', '--screenshot', 'shot.png')

  // Then one row per target remains, the phone one passing
  assert.equal(rows(dir), 'AC-8.2\tdesktop\tpass\tAC-8.2-desktop.png\t\nAC-8.2\tphone\tpass\tAC-8.2-phone.png\t\n')
})

test('an AC marked not visible replaces its target rows, and a walked target replaces the not-visible row', () => {
  // Given an AC walked at desktop
  const dir = project()
  result(dir, 'head', '8')
  result(dir, 'record', 'AC-8.3', 'desktop', 'blocked', '--note', 'no seed data')

  // When it is marked not visible
  result(dir, 'record', 'AC-8.3', '-', 'not-visible', '--note', 'a backend-only rule')

  // Then only the not-visible row is left
  assert.equal(rows(dir), 'AC-8.3\t-\tnot-visible\t-\ta backend-only rule\n')

  // And when it is walked after all, the not-visible row goes
  result(dir, 'record', 'AC-8.3', 'phone', 'pass', '--screenshot', 'shot.png')
  assert.equal(rows(dir), 'AC-8.3\tphone\tpass\tAC-8.3-phone.png\t\n')
})

test('record refuses a row that breaks the contract and writes nothing', () => {
  // Given a project whose head is stamped
  const dir = project()
  result(dir, 'head', '8')

  // When each kind of bad row is recorded
  const refusals = [
    [['AC-8', 'desktop', 'pass', '--screenshot', 'shot.png'], /"AC-8" is not an AC key such as AC-8\.1/],
    [['AC-8.1', 'tablet', 'pass', '--screenshot', 'shot.png'], /there is no target "tablet"\. Targets: desktop, phone/],
    [['AC-8.1', 'desktop', 'skipped', '--note', 'later'], /"skipped" is not a status\. Statuses: pass, fail, blocked, not-visible/],
    [['AC-8.1', 'desktop', 'fail', '--screenshot', 'shot.png'], /a fail needs a --note saying why/],
    [['AC-8.1', 'desktop', 'pass'], /a pass needs a --screenshot/],
    [['AC-8.1', 'desktop', 'pass', '--screenshot', 'missing.png'], /no screenshot at missing\.png/],
    [['AC-8.1', 'desktop', 'not-visible', '--note', 'backend'], /a not-visible AC has - for its target/],
    [['AC-8.1', '-', 'not-visible', '--note', 'backend', '--screenshot', 'shot.png'], /a not-visible AC has no screenshot/],
    [['AC-8.1', 'desktop', 'blocked', '--note', 'two\tcolumns'], /a note is one line without tabs/],
  ]

  // Then each is refused with the reason and no row is written
  for (const [args, reason] of refusals) {
    const { status, out } = result(dir, 'record', ...args)
    assert.equal(status, 1, args.join(' '))
    assert.match(out, reason)
  }
  assert.equal(existsSync(verifyDir(dir, 'results.tsv')), false)
})

test('record refuses before head is stamped, and after the code changes under it', () => {
  // Given a project with no head
  const dir = project()

  // When a row is recorded
  const before = result(dir, 'record', 'AC-8.1', 'desktop', 'pass', '--screenshot', 'shot.png')

  // Then it is refused, pointing at head
  assert.equal(before.status, 1)
  assert.match(before.out, /no head for issue 8.*verify-result\.mjs head 8/s)

  // And when head is stamped and the code then changes, a row is refused as walked on other code
  result(dir, 'head', '8')
  writeFileSync(join(dir, 'web', 'page.ts'), 'export const page = 3\n')
  const after = result(dir, 'record', 'AC-8.1', 'desktop', 'pass', '--screenshot', 'shot.png')
  assert.equal(after.status, 1)
  assert.match(after.out, /the code changed since head was stamped/)
})

test('head on changed code drops the rows walked on the old code', () => {
  // Given a recorded row
  const dir = project()
  result(dir, 'head', '8')
  result(dir, 'record', 'AC-8.1', 'desktop', 'pass', '--screenshot', 'shot.png')

  // When the code changes and head is stamped again
  writeFileSync(join(dir, 'web', 'page.ts'), 'export const page = 4\n')
  const { out } = result(dir, 'head', '8')

  // Then the old rows and their screenshots are gone, and head says how many
  assert.match(out, /dropped 1 row walked on the old code/)
  assert.equal(existsSync(verifyDir(dir, 'results.tsv')), false)
  assert.equal(existsSync(verifyDir(dir, 'AC-8.1-desktop.png')), false)
})

test('check passes when every AC has a row at every target or a not-visible row', () => {
  // Given every AC of issue 8 recorded
  const dir = project()
  result(dir, 'head', '8')
  recordAll(dir)

  // When check runs
  const { status, out } = result(dir, 'check', '8')

  // Then it passes, listing each AC's results
  assert.equal(status, 0, out)
  assert.match(out, /AC-8\.1\s+desktop pass, phone pass/)
  assert.match(out, /AC-8\.3\s+not visible: a backend-only rule/)
  assert.match(out, /3 ACs, every one with a result/)
})

test('check fails naming each AC that lacks a row at a target', () => {
  // Given AC 2 walked at desktop only and AC 3 not at all
  const dir = project()
  result(dir, 'head', '8')
  result(dir, 'record', 'AC-8.1', 'desktop', 'pass', '--screenshot', 'shot.png')
  result(dir, 'record', 'AC-8.1', 'phone', 'fail', '--screenshot', 'shot.png', '--note', 'the list overflows')
  result(dir, 'record', 'AC-8.2', 'desktop', 'pass', '--screenshot', 'shot.png')

  // When check runs
  const { status, out } = result(dir, 'check', '8')

  // Then it fails naming the missing targets, while a fail still counts as a result
  assert.equal(status, 1, out)
  assert.match(out, /AC-8\.1\s+desktop pass, phone fail: the list overflows/)
  assert.match(out, /AC-8\.2\s+desktop pass, phone MISSING/)
  assert.match(out, /AC-8\.3\s+MISSING/)
  assert.match(out, /INCOMPLETE: 2 of 3 ACs lack a result/)
})

test('check fails on a row for an AC the issue does not have, or for a target the config dropped', () => {
  // Given every AC recorded at desktop and phone, then the config narrowed to desktop and the issue to two ACs
  const dir = project()
  result(dir, 'head', '8')
  recordAll(dir)
  writeFileSync(join(dir, 'bin', 'issue.md'), '## Acceptance criteria\n\n- [ ] The order list shows the newest order first\n- [ ] An empty history says so\n')
  writeFileSync(join(dir, '.claude', 'skrymer-ai.config.mjs'), `export default { stacks: { 'web-e2e': { roots: ['web'], verify: { targets: { desktop: [1440, 900] } } } } }\n`)
  git(dir, 'commit', '-qam', 'narrow the targets')
  result(dir, 'head', '8')
  for (const ac of ['AC-8.1', 'AC-8.2']) result(dir, 'record', ac, 'desktop', 'pass', '--screenshot', 'shot.png')
  writeFileSync(verifyDir(dir, 'results.tsv'), `${rows(dir)}AC-8.1\tphone\tpass\tAC-8.1-desktop.png\t\nAC-8.3\t-\tnot-visible\t-\tbackend\n`)

  // When check runs
  const { status, out } = result(dir, 'check', '8')

  // Then it fails naming the stray rows
  assert.equal(status, 1, out)
  assert.match(out, /AC-8\.1 phone: there is no target "phone"/)
  assert.match(out, /AC-8\.3: issue 8 has 2 ACs/)
})

test('check fails closed when the code changed since head, or gh cannot read the issue, or the issue has no ACs', () => {
  // Given every AC recorded, then the code changed
  const dir = project()
  result(dir, 'head', '8')
  recordAll(dir)
  writeFileSync(join(dir, 'web', 'page.ts'), 'export const page = 5\n')

  // When check runs, then it fails on the stale head
  const stale = result(dir, 'check', '8')
  assert.equal(stale.status, 1)
  assert.match(stale.out, /the code changed since head was stamped/)

  // And when the issue cannot be read, check fails with gh's own word
  const unreadable = result(dir, 'check', '9')
  assert.equal(unreadable.status, 1)
  assert.match(unreadable.out, /gh could not read issue 9: GraphQL: Could not resolve/)

  // And when the issue has no checklist, check fails rather than passing over nothing
  const empty = project({ issue: '## What to build\n\nNo criteria yet.\n' })
  result(empty, 'head', '8')
  const none = result(empty, 'check', '8')
  assert.equal(none.status, 1)
  assert.match(none.out, /issue 8 has no acceptance criteria checklist/)
})

test('a project whose stacks never verify has no targets to record against', () => {
  // Given a project config with no stack that verifies
  const dir = project()
  writeFileSync(join(dir, '.claude', 'skrymer-ai.config.mjs'), 'export default { stacks: {} }\n')

  // When head runs
  const { status, out } = result(dir, 'head', '8')

  // Then it stops naming the missing stack
  assert.equal(status, 1)
  assert.match(out, /no stack in the project config verifies/)
})
