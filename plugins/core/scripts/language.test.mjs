import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitProject, runScript } from './git-fixture.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'language.mjs')

const GLOSSARY = `# Acme

## Language

**Line Item**:
One product on an invoice, with its quantity and price.
_Avoid_: row, line

**Invoice**:
What Acme bills a customer for one order.
`

/** A project whose root glossary is GLOSSARY, with [branch] written on a feature branch. */
const project = (branch, base = {}) => gitProject({ 'CONTEXT.md': GLOSSARY, 'web/app/invoice.ts': 'export class Invoice {}\n', ...base }, branch)

test('each new type the branch declares is matched against the glossary, and a mismatch names why', () => {
  // Given a branch declaring a type named for a term, one named with a term the glossary avoids, one naming no term, and a technical one
  const dir = project({
    'web/app/invoice.ts': 'export class Invoice {}\n\nexport interface LineItem { qty: number }\nexport type CartRow = LineItem\n',
    'web/app/tax.ts': 'export class TaxBand {}\nexport class HttpClient {}\n',
  })

  // When the language is extracted
  const { status, out } = runScript(SCRIPT, dir)

  // Then the avoided term and the missing term are mismatches, the term is a match, and the technical type is left out
  assert.equal(status, 0, out)
  assert.deepEqual(out.trimEnd().split('\n').slice(1), [
    'context . (CONTEXT.md):',
    '  MISMATCH CartRow  web/app/invoice.ts:4  uses "row", which the glossary’s **Line Item** avoids',
    '  MISMATCH TaxBand  web/app/tax.ts:1  names no term in the glossary',
    '  matches: LineItem (web/app/invoice.ts:3) → **Line Item**',
    '3 new identifiers checked: 2 mismatches, each for the language judge.',
  ])
})

test('the PRD’s terms are checked against the glossaries of the contexts the branch touches', () => {
  // Given a branch with no new type, and a PRD naming a glossary term, an avoided term and a new one
  const dir = project({ 'web/app/invoice.ts': 'export class Invoice {}\n// totals\n' })
  writeFileSync(join(dir, 'prd.md'), '# Billing\n\nEach **Invoice** lists its **Rows**, and a **Tax Band** sets the rate.\n')

  // When the language is extracted with the PRD
  const { out } = runScript(SCRIPT, dir, ['--prd', 'prd.md'])

  // Then the avoided and the new terms are mismatches, and the known term isn't
  assert.deepEqual(out.trimEnd().split('\n').slice(1), [
    'context . (CONTEXT.md):',
    '  no new identifiers',
    'PRD (prd.md):',
    '  MISMATCH Rows  prd.md  uses "row", which the glossary’s **Line Item** avoids',
    '  MISMATCH Tax Band  prd.md  names no term in the glossary',
    '  matches: Invoice → **Invoice**',
    '0 new identifiers and 3 PRD terms checked: 2 mismatches, each for the language judge.',
  ])
})

test('a context the branch touches that has no glossary makes every new identifier a mismatch', () => {
  // Given a config with a billing context that has no CONTEXT.md, and a branch declaring a type in it
  const dir = project(
    { 'billing/Ledger.kt': 'package acme\n\nclass LedgerEntry\n' },
    { '.claude/skrymer-ai.config.mjs': "export default { domain: { contexts: ['.', 'billing'] } }\n", 'billing/.keep': '' }
  )

  // When the language is extracted
  const { out } = runScript(SCRIPT, dir)

  // Then the billing context says it has no glossary, and its type is a mismatch
  assert.match(out, /\ncontext billing \(no CONTEXT\.md\):\n {2}MISMATCH LedgerEntry {2}billing\/Ledger\.kt:3 {2}the context has no glossary\n/)
})
