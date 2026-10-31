import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runScript } from './git-fixture.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'pack-lint.mjs')

/** A run dir holding two transcripts, a survivors file with two lines, a red log, and the pack given as its [sources] and [rows]. */
function run(sources, rows) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-lint-'))
  mkdirSync(join(dir, 'red'))
  writeFileSync(join(dir, 'reviewer.jsonl'), '{}\n')
  writeFileSync(join(dir, 'triager.jsonl'), '{}\n')
  writeFileSync(join(dir, 'nuxt-web.survivors'), 'app/cart.ts:3\tEqualityOperator → >=\tSurvived\napp/cart.ts:9\tBlockStatement → {}\tNoCoverage\n')
  writeFileSync(join(dir, 'red', 'CR-1.log'), 'exit: 1\n')
  const table = (head, lines) => [`| ${head.join(' | ')} |`, `|${head.map(() => ' --- |').join('')}`, ...lines.map((cells) => `| ${cells.join(' | ')} |`)].join('\n')
  writeFileSync(
    join(dir, 'pack.md'),
    `# Resolutions pack\n\n## Sources\n\n${table(['agent', 'transcript', 'findings'], sources)}\n\n## Resolutions\n\n${table(['id', 'agent', 'finding', 'remedy', 'resolution'], rows)}\n`
  )
  return dir
}

const SOURCES = [
  ['code-reviewer', 'reviewer.jsonl', '2'],
  ['mutant-triager (nuxt web)', 'triager.jsonl', 'survivors nuxt-web.survivors'],
]
const ROWS = [
  ['CR-1', 'code-reviewer', 'the total rounds half down', 'round half up', 'FIXED: a total of 2.005 rounds to 2.01 — red red/CR-1.log'],
  ['CR-2.a', 'code-reviewer', 'the helper duplicates format()', 'call format()', 'Dismissed: format() pads to 8; quoted at app/format.ts:4'],
  ['CR-2.b', 'code-reviewer', 'the helper duplicates format()', 'delete the helper', 'Dismissed: the same reason as CR-2.a'],
  ['MT-1', 'mutant-triager (nuxt web)', 'app/cart.ts:3 real gap', 'test the boundary', 'FIXED: a total of 2.005 rounds to 2.01 — red red/CR-1.log'],
  ['MT-2', 'mutant-triager (nuxt web)', 'app/cart.ts:9 equivalent', 'none', 'Equivalent: reduce from 0 returns 0 for an empty cart'],
]

test('a pack whose rows match their sources, with one remedy each and cited reds, is clean', () => {
  // Given a pack with every finding and survivor rowed, and each FIXED cell citing a red that exists
  const dir = run(SOURCES, ROWS)

  // When it is linted
  const { status, stdout } = runScript(SCRIPT, dir, ['pack.md'])

  // Then it is clean
  assert.deepEqual([status, stdout], [0, 'pack lint: 5 rows from 2 sources, clean.\n'])
})

test('the lint fails on a missing finding row, a miscount against the survivors file, a malformed or uncited FIXED cell, and two remedies in a row', () => {
  // Given a pack missing CR-2, missing a survivor row, with a FIXED cell out of form, one citing no log, and a row with two remedies
  const rows = [
    ['CR-1', 'code-reviewer', 'the total rounds half down', 'round half up; add a test at 2.005', 'FIXED: a total of 2.005 rounds to 2.01 — red red/CR-1.log'],
    ['MT-1', 'mutant-triager (nuxt web)', 'app/cart.ts:3 real gap', 'test the boundary', 'FIXED by the boundary test'],
    ['GH-1', 'adversary', 'unreachable from the UI', 'none', 'FIXED: the cart posts it — red red/GH-1.log'],
  ]
  const dir = run([...SOURCES, ['adversary', 'gone.jsonl', '1']], rows)

  // When it is linted
  const { status, stdout } = runScript(SCRIPT, dir, ['pack.md'])

  // Then each problem is named, and it fails before any judging starts
  assert.equal(status, 1)
  assert.deepEqual(stdout.trimEnd().split('\n'), [
    'pack lint: 6 problems. Fix the pack before the resolutions pass reads it.',
    '- code-reviewer: returned 2 findings, and the pack rows 1 (CR-1).',
    '- mutant-triager (nuxt web): nuxt-web.survivors has 2 survivors, and the pack rows 1.',
    '- adversary: no transcript at gone.jsonl.',
    '- CR-1: the remedy names two remedies ("round half up; add a test at 2.005"). Split it into one row per remedy.',
    '- MT-1: a FIXED cell reads "FIXED: <test> — red <log path>", not "FIXED by the boundary test".',
    '- GH-1: the FIXED cell cites red/GH-1.log, which does not exist.',
  ])
})
