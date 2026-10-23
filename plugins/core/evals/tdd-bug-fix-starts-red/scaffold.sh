#!/usr/bin/env bash
# A tiny Node project whose invoice total drops the discount on large orders.
set -euo pipefail
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "initech-billing", "private": true, "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > src/invoice.mjs <<'JS'
/** The total of an invoice's lines, with 10% off when the subtotal exceeds 100. */
export function invoiceTotal(lines) {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0)
  return subtotal > 1000 ? subtotal * 0.9 : subtotal
}
JS
cat > test/invoice.test.mjs <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { invoiceTotal } from '../src/invoice.mjs'

test('a small invoice pays full price', () => {
  // Given
  const lines = [{ price: 20, quantity: 2 }]

  // When
  const total = invoiceTotal(lines)

  // Then
  assert.equal(total, 40)
})
JS
