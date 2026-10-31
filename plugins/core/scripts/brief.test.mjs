import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git, gitProject, runScript } from './git-fixture.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'brief.mjs')

/** A project on a feature branch whose committed change edits a source file and its lockfile. */
function project() {
  const dir = gitProject(
    { 'web/app/cart.ts': 'export const total = 0\n', 'web/pnpm-lock.yaml': "lockfileVersion: '9.0'\n" },
    { 'web/app/cart.ts': 'export const total = 1\n', 'web/pnpm-lock.yaml': "lockfileVersion: '9.1'\n" }
  )
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'Change the total')
  return realpathSync(dir)
}

const signOffDir = (dir, ...parts) => join(dir, '.git', 'skrymer-ai', 'sign-off', ...parts)

test('the renderer fills an agent’s brief from its template, the run’s slots and the branch, and saves it', () => {
  // Given a committed change on a feature branch
  const dir = project()
  const base = git(dir, 'merge-base', 'HEAD', 'origin/main')
  const commit = git(dir, 'rev-parse', 'HEAD')

  // When the adversary's brief is rendered with its per-run slots
  const { status, stdout, stderr } = runScript(SCRIPT, dir, [
    'adversary',
    '--slot', 'what=The cart total starts at 1.',
    '--slot', 'issue=gh issue view 12 --comments',
    '--slot', 'parent=none',
    '--slot', 'files=web/app/cart.ts',
  ])

  // Then stdout is the brief exactly, and the saved copy and the gate's diff sit in the git dir
  assert.equal(status, 0, stderr)
  const diff = signOffDir(dir, 'diff-adversary.patch')
  assert.equal(
    stdout,
    `Repo: ${dir} (the main checkout; stay in it).
The change: git diff ${base} ${commit}, saved without lockfiles at ${diff}
What it does: The cart total starts at 1.
The issue it claims to deliver: gh issue view 12 --comments
Its parent, where it has one: none
Already read by other agents, so start here: web/app/cart.ts. Read anything else you want.
`
  )
  assert.equal(readFileSync(signOffDir(dir, 'briefs', 'adversary.txt'), 'utf8'), stdout)
  assert.equal(stderr, `saved: ${signOffDir(dir, 'briefs', 'adversary.txt')}\n`)
  const patch = readFileSync(diff, 'utf8')
  assert.match(patch, /^\+export const total = 1$/m)
  assert.doesNotMatch(patch, /pnpm-lock/)
})

test('a slot read from a file keeps every line, and a label saves a re-run’s brief apart', () => {
  // Given a committed change and the scope script's output saved to a file
  const dir = project()
  writeFileSync(join(dir, 'scope.txt'), 'docs in scope:\n  docs/adr/ (always)\n  CONTEXT.md (web/app/cart.ts)\n')

  // When check-adrs' brief is rendered for a second run, its scope read from the file
  const { status, stdout, stderr } = runScript(SCRIPT, dir, ['check-adrs', '--label', '2', '--slot', 'what=The cart total starts at 1.', '--slot', 'scope=@scope.txt', '--slot', 'issue=none'])

  // Then the scope is there whole, and the brief is saved under its label
  assert.equal(status, 0, stderr)
  assert.match(stdout, /\nScope, as the scope script printed it:\ndocs in scope:\n {2}docs\/adr\/ \(always\)\n {2}CONTEXT\.md \(web\/app\/cart\.ts\)\nThe issue: none\n$/)
  assert.equal(readFileSync(signOffDir(dir, 'briefs', 'check-adrs-2.txt'), 'utf8'), stdout)
  assert.ok(existsSync(signOffDir(dir, 'diff-check-adrs-2.patch')))
})

test('a slot left unfilled, a slot the template lacks, and an agent with no template each stop the render', () => {
  // Given a committed change
  const dir = project()

  // When the adversary is rendered without its slots, then with a slot it lacks, then a template that doesn't exist
  const missing = runScript(SCRIPT, dir, ['adversary', '--slot', 'what=The cart total starts at 1.'])
  const extra = runScript(SCRIPT, dir, ['blind-arbiter', '--slot', 'question=q', '--slot', 'position1=a', '--slot', 'position2=b', '--slot', 'what=x'])
  const unknown = runScript(SCRIPT, dir, ['devils-advocate'])

  // Then each names the problem, and no brief is saved
  assert.deepEqual([missing.status, missing.stdout], [1, 'STOP: the adversary brief needs every slot filled ("none" when it has nothing): issue, parent, files.\n'])
  assert.deepEqual([extra.status, extra.stdout], [1, 'STOP: the blind-arbiter brief has no slot "what". Its slots: question, position1, position2.\n'])
  assert.equal(unknown.status, 1)
  assert.match(unknown.stdout, /^STOP: there is no brief template for "devils-advocate"\. Templates: acceptance-ledger, adversary, blind-arbiter, check-adrs, code-reviewer, diagram-auditor, language-judge, resolutions, retro-miner, security-reviewer, verdict-auditor\.\n$/)
  assert.equal(existsSync(signOffDir(dir, 'briefs')), false)
})
