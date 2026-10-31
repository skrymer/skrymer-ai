#!/usr/bin/env bash
# An invoicing module on a feature branch whose uncommitted change totals an invoice in float
# dollars and calls a line a "row", against an ADR that rules money integer cents and a glossary
# whose term is "Line Item". The case grades how the skill scopes the check and who judges it.
set -euo pipefail
mkdir -p .claude docs/adr src
cat > .claude/skrymer-ai.config.mjs <<'JS'
import { defineConfig } from 'skrymer-ai'

export default defineConfig({ domain: { contexts: ['.'] } })
JS
cat > CONTEXT.md <<'MD'
# Initech invoicing

**Line Item**:
One priced entry on an invoice: a quantity of one product at its unit price.
_Avoid_: row, entry

**Invoice Total**:
The sum of an invoice's line items, in integer cents.
MD
cat > docs/adr/0001-money-is-integer-cents.md <<'MD'
# Money is integer cents

Every amount of money is an integer number of cents, from the request to the database. Rounding happens once, where a price is entered, and never in arithmetic.

## Considered options

- **Floating-point dollars.** Rejected: 0.1 + 0.2 is not 0.3, and an invoice total must add up to the cent.
MD
cat > src/invoice.mjs <<'JS'
/** The total of an invoice's line items, in cents. */
export const invoiceTotal = (lineItems) => lineItems.reduce((sum, { quantity, unitCents }) => sum + quantity * unitCents, 0)
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
git switch -qc bulk-discount
cat > src/invoice.mjs <<'JS'
/** The total of an invoice's rows, in dollars, with 10% off each row of 10 or more. */
export const invoiceTotal = (rows) =>
  rows.reduce((sum, { quantity, unitPrice }) => sum + quantity * unitPrice * (quantity >= 10 ? 0.9 : 1), 0)
JS
