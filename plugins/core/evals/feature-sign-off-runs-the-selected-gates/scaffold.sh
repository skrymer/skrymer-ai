#!/usr/bin/env bash
# A small invoicing module on a feature branch with a finished, uncommitted change, whose config
# selects two gates, listed against core's order. Packs are invisible in the harness (ADR 0007),
# so no stack is enabled and the plan names no check (the check itself is covered by
# sign-off.test.mjs). The case grades which gates the conductor runs, in what order, and
# who judges.
set -euo pipefail
mkdir -p .claude docs/adr src test
cat > .claude/skrymer-ai.config.mjs <<'JS'
import { defineConfig } from 'skrymer-ai'

export default defineConfig({ signOff: { gates: ['check-adrs', 'simplify'] } })
JS
cat > CONTEXT.md <<'MD'
# Initech invoicing

**Line Item**:
One priced entry on an invoice: a quantity of one product at its unit price, in integer cents.
MD
cat > docs/adr/0001-money-is-integer-cents.md <<'MD'
# Money is integer cents

Every amount of money is an integer number of cents. Rounding happens once, where a price is entered.
MD
cat > package.json <<'JSON'
{ "name": "initech-invoicing", "private": true, "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > src/invoice.mjs <<'JS'
/** The total of an invoice's line items, in cents. */
export const invoiceTotal = (lineItems) => lineItems.reduce((sum, { quantity, unitCents }) => sum + quantity * unitCents, 0)
JS
cat > test/invoice.test.mjs <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { invoiceTotal } from '../src/invoice.mjs'

test('an invoice totals its line items', () => {
  // Given two line items
  const lineItems = [{ quantity: 2, unitCents: 150 }, { quantity: 1, unitCents: 99 }]

  // When the invoice is totalled
  const total = invoiceTotal(lineItems)

  // Then the total is the sum, in cents
  assert.equal(total, 399)
})
JS
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git init -q -b main
git add -A
git -c user.email=dev@initech.test -c user.name=dev commit -qm 'Add the invoice total'
git init -q --bare .origin
# The harness drops its own dotfiles into the workspace; they are not the branch's change.
printf '.origin/\n/.*\n' >> .git/info/exclude
git remote add origin "$PWD/.origin"
git push -q origin main
git remote set-head origin main
git switch -qc empty-invoice
cat > src/invoice.mjs <<'JS'
/** The total of an invoice's line items, in cents. An invoice with no line items totals 0. */
export const invoiceTotal = (lineItems = []) => lineItems.reduce((sum, { quantity, unitCents }) => sum + quantity * unitCents, 0)
JS
cat >> test/invoice.test.mjs <<'JS'

test('an invoice with no line items totals 0', () => {
  // Given no line items
  // When the invoice is totalled without them
  const total = invoiceTotal()

  // Then the total is 0
  assert.equal(total, 0)
})
JS
