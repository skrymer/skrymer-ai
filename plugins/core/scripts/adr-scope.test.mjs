import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitProject, runScript } from './git-fixture.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'adr-scope.mjs')

const configOf = (body) => `import { defineConfig } from 'skrymer-ai'\n\nexport default defineConfig(${body})\n`

/** Three contexts, the root, billing and shipping, each with its glossary and decisions, and a README and CLAUDE.md at the root. */
const CONTEXTS = {
  '.claude/skrymer-ai.config.mjs': configOf(`{ domain: { contexts: ['.', 'billing', './shipping/'] }, signOff: { docs: ['handbook/**/*.md'] } }`),
  'CONTEXT.md': '# Acme\n',
  'docs/adr/0001-one.md': '# One\n',
  'billing/CONTEXT.md': '# Billing\n',
  'billing/docs/adr/0001-invoices.md': '# Invoices\n',
  'billing/src/invoice.ts': 'export const total = 0\n',
  'shipping/CONTEXT.md': '# Shipping\n',
  'shipping/docs/adr/0001-parcels.md': '# Parcels\n',
  'shipping/src/parcel.ts': 'export const weight = 0\n',
  'README.md': '# Acme\n',
  'CLAUDE.md': '# Acme\n',
}

test('the scope lists each doc a changed file puts in scope, with the files that put it there', () => {
  // Given a branch changing a billing file and a root file, and nothing under shipping
  const dir = gitProject(CONTEXTS, { 'billing/src/invoice.ts': 'export const total = 1\n', 'tools/seed.ts': 'export {}\n' })

  // When the scope script runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then the root and billing docs are in scope with the files that chose them, and shipping's are not
  assert.equal(status, 0, out)
  assert.match(out, /^ {2}docs\/adr\/ {2}← billing\/src\/invoice\.ts, tools\/seed\.ts$/m)
  assert.match(out, /^ {2}CONTEXT\.md {2}← billing\/src\/invoice\.ts, tools\/seed\.ts$/m)
  assert.match(out, /^ {2}billing\/CONTEXT\.md {2}← billing\/src\/invoice\.ts$/m)
  assert.match(out, /^ {2}billing\/docs\/adr\/ {2}← billing\/src\/invoice\.ts$/m)
  assert.doesNotMatch(out, /shipping\/(CONTEXT\.md|docs)/)
})

test('the root decisions are in scope even when the root is not a context', () => {
  // Given contexts that leave out the root, and a branch changing only shipping
  const dir = gitProject(
    { ...CONTEXTS, '.claude/skrymer-ai.config.mjs': configOf(`{ domain: { contexts: ['billing', 'shipping'] } }`) },
    { 'shipping/src/parcel.ts': 'export const weight = 2\n' }
  )

  // When the scope script runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then docs/adr/ is in scope as always, beside shipping's docs, and the root glossary is not
  assert.equal(status, 0, out)
  assert.match(out, /^ {2}docs\/adr\/ {2}← \(always in scope\)$/m)
  assert.match(out, /^ {2}shipping\/CONTEXT\.md {2}← shipping\/src\/parcel\.ts$/m)
  assert.doesNotMatch(out, /^ {2}CONTEXT\.md/m)
})

test('the drift greps cover the root docs, the glossaries in scope and the sign-off docs', () => {
  // Given the three contexts and a branch changing a billing file
  const dir = gitProject(CONTEXTS, { 'billing/src/invoice.ts': 'export const total = 1\n' })

  // When the scope script runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then the grep line names CLAUDE.md, README.md, docs/, both glossaries in scope and the configured glob, and no shipping doc
  assert.equal(status, 0, out)
  assert.match(out, /^drift: git grep -n -E '<pattern>' -- CLAUDE\.md README\.md docs\/ CONTEXT\.md billing\/CONTEXT\.md ':\(glob\)handbook\/\*\*\/\*\.md'$/m)
})

test('a doc a context should hold but does not is named as absent, not dropped silently', () => {
  // Given billing without its decisions directory, and a branch changing a billing file
  const { 'billing/docs/adr/0001-invoices.md': _, ...withoutDecisions } = CONTEXTS
  const dir = gitProject(withoutDecisions, { 'billing/src/invoice.ts': 'export const total = 1\n' })

  // When the scope script runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then billing's glossary is in scope and its decisions directory is reported absent
  assert.equal(status, 0, out)
  assert.match(out, /^absent: billing\/docs\/adr\/$/m)
  assert.doesNotMatch(out, /^ {2}billing\/docs\/adr\//m)
})

test('a project with no config is scoped as one context at the root', () => {
  // Given a project with no skrymer-ai config and a branch changing a file
  const { '.claude/skrymer-ai.config.mjs': _, ...unconfigured } = CONTEXTS
  const dir = gitProject(unconfigured, { 'billing/src/invoice.ts': 'export const total = 1\n' })

  // When the scope script runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then the root glossary and decisions are in scope, and billing's are not, since it is no context
  assert.equal(status, 0, out)
  assert.match(out, /^ {2}CONTEXT\.md {2}← billing\/src\/invoice\.ts$/m)
  assert.doesNotMatch(out, /billing\/CONTEXT\.md/)
})

test('a branch with no change stops, since nothing was measured', () => {
  // Given a feature branch with nothing changed since its base
  const dir = gitProject(CONTEXTS)

  // When the scope script runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then it stops and says so
  assert.equal(status, 1)
  assert.match(out, /^STOP: the branch holds no change since [0-9a-f]{7}\. Nothing was measured\.$/m)
})

test('a config with errors stops, naming each one', () => {
  // Given a config selecting a gate core has no such name for
  const dir = gitProject(
    { ...CONTEXTS, '.claude/skrymer-ai.config.mjs': configOf(`{ signOff: { gates: ['lint'] } }`) },
    { 'billing/src/invoice.ts': 'export const total = 1\n' }
  )

  // When the scope script runs
  const { status, out } = runScript(SCRIPT, dir)

  // Then it stops with the config's error
  assert.equal(status, 1)
  assert.match(out, /^STOP: the project config has errors:\n {2}signOff\.gates: there is no gate "lint"\./m)
})
