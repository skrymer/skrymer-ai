import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitProject as fixture, git, runScript } from './git-fixture.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'mutation.mjs')

/**
 * A stand-in engine: run in the stack root, it records the arguments it was given, then copies
 * `engine-report` (beside it) to the report path, unless there is none.
 */
const ENGINE = `
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
const [report, ...args] = process.argv.slice(2)
writeFileSync('engine-args.json', JSON.stringify(args))
console.log('engine ran')
if (existsSync('engine-report')) {
  mkdirSync(dirname(report), { recursive: true })
  copyFileSync('engine-report', report)
}
`

/** A project config enabling kotlin-spring under `api` and nuxt under `web`, each running the stand-in engine. */
const CONFIG = `
import { defineConfig } from 'skrymer-ai'

export default defineConfig({
  stacks: {
    'kotlin-spring': { roots: ['api'], mutation: { run: ['node', 'engine.mjs', 'out/mutations.xml', '-PmutationTargets={targets}'], report: 'out/mutations.xml' } },
    nuxt: { roots: ['web'], mutation: { run: ['node', 'engine.mjs', 'out/mutation.json', '--mutate', '{targets}'], report: 'out/mutation.json' } },
  },
})
`

const BASE = {
  '.claude/skrymer-ai.config.mjs': CONFIG,
  'api/engine.mjs': ENGINE,
  'web/engine.mjs': ENGINE,
  'api/build.gradle.kts': '',
  'web/nuxt.config.ts': '',
  'api/src/main/kotlin/acme/shop/Order.kt': 'package acme.shop\n\nclass Order\n',
  'web/app/utils/cart.ts': 'export const total = 0\n',
  'README.md': '# acme\n',
}

const IGNORE = '.gitignore'

/** A project from [base] on a feature branch with [branch] uncommitted on top, ignoring what the stand-in engine leaves. */
const gitProject = (branch = {}, base = BASE) => fixture({ ...base, [IGNORE]: 'engine-args.json\nout/\nengine-report\n' }, branch)

/** Runs the sweep script in [dir] with [args], without a memory cap so the result is the same on any machine. */
function sweep(dir, ...args) {
  return runScript(SCRIPT, dir, args, { SKRYMER_AI_MUTATION_CAP: 'off' })
}

const outFile = (dir, name) => join(dir, '.git', 'skrymer-ai', 'mutation', name)

const pitestReport = (...rows) => `<?xml version="1.0" encoding="UTF-8"?>
<mutations>
${rows
  .map(
    ([detected, status, line]) =>
      `<mutation detected='${detected}' status='${status}'><sourceFile>Order.kt</sourceFile><mutatedClass>acme.shop.Order</mutatedClass><lineNumber>${line}</lineNumber><mutator>org.pitest.mutationtest.engine.gregor.mutators.NegateConditionalsMutator</mutator><description>negated conditional</description></mutation>`
  )
  .join('\n')}
</mutations>
`

test('the plan names each stack the branch touches and skips the rest with a note', () => {
  // Given a branch that changes Kotlin source and the README, and nothing under the Nuxt root
  const dir = gitProject({ 'api/src/main/kotlin/acme/shop/Order.kt': 'package acme.shop\n\nclass Order(val id: Int)\n', 'README.md': '# acme shop\n' })

  // When the plan runs
  const { status, out } = sweep(dir)

  // Then kotlin-spring is scoped to the changed file with its run command, and nuxt is skipped naming the change count
  assert.equal(status, 0, out)
  assert.match(out, /kotlin-spring \(api\): 1 file/)
  assert.match(out, /api\/src\/main\/kotlin\/acme\/shop\/Order\.kt/)
  assert.match(out, /mutation\.mjs run kotlin-spring api/)
  assert.match(out, /nuxt \(web\): SKIP — none of the 2 files the branch changed is mutable source/)
})

test('the plan leaves out tests, deleted files and files outside the source globs, and counts untracked ones', () => {
  // Given a branch that adds an untracked composable, edits a colocated test, deletes a util and touches a config
  const dir = gitProject(
    { 'web/app/utils/cart.test.ts': 'test()\n', 'web/app/composables/useCart.ts': 'export {}\n', 'web/app/utils/cart.ts': null, 'web/nuxt.config.ts': '// tuned\n' },
    { ...BASE, 'web/app/utils/cart.test.ts': '' }
  )

  // When the plan runs
  const { status, out } = sweep(dir)

  // Then only the untracked composable is in nuxt's scope
  assert.equal(status, 0, out)
  assert.match(out, /nuxt \(web\): 1 file/)
  assert.match(out, /web\/app\/composables\/useCart\.ts/)
  assert.doesNotMatch(out, /cart\.test\.ts|utils\/cart\.ts|nuxt\.config/)
})

test('a branch with no change at all stops the plan instead of skipping every stack', () => {
  // Given a feature branch identical to its base
  const dir = gitProject()

  // When the plan runs
  const { status, out } = sweep(dir)

  // Then it stops, saying the branch holds no change
  assert.equal(status, 1)
  assert.match(out, /STOP: the branch holds no change since/)
  assert.doesNotMatch(out, /SKIP/)
})

test('a repo without origin stops the plan, saying the base is unresolved', () => {
  // Given a project with a change but no origin to measure it from
  const dir = gitProject({ 'README.md': '# changed\n' })
  git(dir, 'remote', 'remove', 'origin')

  // When the plan runs
  const { status, out } = sweep(dir)

  // Then it stops on the missing baseline rather than reporting an empty scope
  assert.equal(status, 1)
  assert.match(out, /STOP: .*no baseline to compare with/)
})

test('a sweep writes one survivors line per undetected mutant, stamped with HEAD and git status in its log', () => {
  // Given a branch changing Order.kt, and an engine whose report has two undetected mutants and one killed
  const dir = gitProject({
    'api/src/main/kotlin/acme/shop/Order.kt': 'package acme.shop\n\nclass Order(val id: Int)\n',
    'api/engine-report': pitestReport(['false', 'SURVIVED', 3], ['true', 'KILLED', 3], ['false', 'NO_COVERAGE', 5]),
  })

  // When kotlin-spring's sweep runs
  const { status, out } = sweep(dir, 'run', 'kotlin-spring')

  // Then the engine got the pitest targets, the survivors file holds the two rows, and the log carries the stamp
  assert.equal(status, 0, out)
  const args = JSON.parse(readFileSync(join(dir, 'api', 'engine-args.json'), 'utf8'))
  assert.deepEqual(args, ['-PmutationTargets=acme.shop.Order,acme.shop.Order$*,acme.shop.OrderKt'])
  assert.equal(
    readFileSync(outFile(dir, 'kotlin-spring-api.survivors.tsv'), 'utf8'),
    'api/src/main/kotlin/acme/shop/Order.kt:3\tNegateConditionals → negated conditional\tSURVIVED\n' +
      'api/src/main/kotlin/acme/shop/Order.kt:5\tNegateConditionals → negated conditional\tNO_COVERAGE\n'
  )
  const log = readFileSync(outFile(dir, 'kotlin-spring-api.log'), 'utf8')
  assert.match(log, new RegExp(`HEAD: ${git(dir, 'rev-parse', 'HEAD')}`))
  assert.match(log, / M api\/src\/main\/kotlin\/acme\/shop\/Order\.kt/)
  assert.match(log, /engine ran/)
  assert.match(out, /3 mutants, 1 detected, 2 undetected/)
})

test('a sweep with nothing undetected writes an empty survivors file', () => {
  // Given a branch changing a util, and an engine whose report has only a killed mutant
  const report = JSON.stringify({ schemaVersion: '1.0', files: { 'app/utils/cart.ts': { mutants: [{ mutatorName: 'BooleanLiteral', replacement: 'false', status: 'Killed', location: { start: { line: 1 } } }] } } })
  const dir = gitProject({ 'web/app/utils/cart.ts': 'export const total = 1\n', 'web/engine-report': report })

  // When nuxt's sweep runs, naming its root
  const { status, out } = sweep(dir, 'run', 'nuxt', 'web')

  // Then the engine got the file as its --mutate list and the survivors file is empty
  assert.equal(status, 0, out)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'web', 'engine-args.json'), 'utf8')), ['--mutate', 'app/utils/cart.ts'])
  assert.equal(readFileSync(outFile(dir, 'nuxt-web.survivors.tsv'), 'utf8'), '')
  assert.match(out, /1 mutant, 1 detected, 0 undetected/)
})

test('a sweep whose scope resolves to no files is an error and runs no engine', () => {
  // Given a branch that changes only the README
  const dir = gitProject({ 'README.md': '# acme shop\n' })

  // When kotlin-spring's sweep runs
  const { status, out } = sweep(dir, 'run', 'kotlin-spring')

  // Then it fails, saying the scope is empty, and the engine never ran
  assert.equal(status, 1)
  assert.match(out, /kotlin-spring \(api\): the scope resolved to no files/)
  assert.equal(existsSync(join(dir, 'api', 'engine-args.json')), false)
})

test('a report left by an earlier sweep is never read as this one’s', () => {
  // Given a stale report from an earlier sweep, and an engine that writes none this time
  const dir = gitProject({ 'api/src/main/kotlin/acme/shop/Order.kt': 'package acme.shop\n\nclass Order(val id: Int)\n', 'api/out/mutations.xml': pitestReport(['false', 'SURVIVED', 3]) })

  // When kotlin-spring's sweep runs
  const { status, out } = sweep(dir, 'run', 'kotlin-spring')

  // Then it fails for want of a report and writes no survivors file
  assert.equal(status, 1)
  assert.match(out, /the engine wrote no report at api\/out\/mutations\.xml/)
  assert.equal(existsSync(outFile(dir, 'kotlin-spring-api.survivors.tsv')), false)
})

test('a report with no mutants is an error, never a zero-mutant pass', () => {
  // Given an engine whose report holds no mutants at all
  const dir = gitProject({ 'api/src/main/kotlin/acme/shop/Order.kt': 'package acme.shop\n\nclass Order(val id: Int)\n', 'api/engine-report': pitestReport() })

  // When kotlin-spring's sweep runs
  const { status, out } = sweep(dir, 'run', 'kotlin-spring')

  // Then it fails, saying the engine made no mutants over a non-empty scope
  assert.equal(status, 1)
  assert.match(out, /the engine made no mutants over 1 file/)
})

test('a sweep for a pack the project does not enable names the ones it can run', () => {
  // Given a project with a change
  const dir = gitProject({ 'README.md': '# acme shop\n' })

  // When a sweep is asked for a pack outside the config
  const { status, out } = sweep(dir, 'run', 'react')

  // Then it fails, listing the stacks that have an engine
  assert.equal(status, 1)
  assert.match(out, /no stack "react" with a mutation engine\. Stacks: kotlin-spring \(api\), nuxt \(web\)/)
})
