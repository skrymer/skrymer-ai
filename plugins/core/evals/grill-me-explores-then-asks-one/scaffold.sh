#!/usr/bin/env bash
# Acme's order service, whose Globex client already says how long a quote holds.
set -euo pipefail
mkdir -p .claude
cat > .claude/skrymer-ai.config.mjs <<'JS'
import { defineConfig } from 'skrymer-ai'

export default defineConfig({ tracker: { kind: 'local' } })
JS
mkdir -p src
cat > src/globex-client.mjs <<'JS'
/** Fetches a price quote from Globex. A quote holds until `validUntil`, 15 minutes after it is issued. */
export async function fetchQuote(sku) {
  const response = await fetch(`https://quotes.globex.example/v1/${sku}`)
  const { price, validUntil } = await response.json()
  return { sku, price, validUntil: new Date(validUntil) }
}
JS
cat > src/checkout.mjs <<'JS'
import { fetchQuote } from './globex-client.mjs'

/** Charges an order at the Globex price quoted for each line at checkout. */
export async function checkout(order) {
  const quotes = await Promise.all(order.lines.map((line) => fetchQuote(line.sku)))
  return quotes.reduce((total, quote, i) => total + quote.price * order.lines[i].quantity, 0)
}
JS
