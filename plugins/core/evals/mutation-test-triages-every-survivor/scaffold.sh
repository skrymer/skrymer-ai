#!/usr/bin/env bash
# An Initech storefront branch whose nuxt sweep has run and left three survivors: a boundary no
# test pins (real gap), a guard whose removal changes nothing (equivalent), and a trim that a
# page test kills but the engine never ran (false survivor).
set -euo pipefail
mkdir -p web/app/utils web/app/pages .claude
printf 'export default defineNuxtConfig({})\n' > web/nuxt.config.ts
cat > .claude/skrymer-ai.config.mjs <<'JS'
import { defineConfig } from 'skrymer-ai'

export default defineConfig({ stacks: { nuxt: { roots: ['web'] } } })
JS
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git init -q -b main
git add -A
git -c user.email=dev@initech.test -c user.name=dev commit -qm 'Start the storefront'
git switch -qc feature

cat > web/app/utils/discount.ts <<'TS'
/** Ten percent off a subtotal over 100. */
export function discount(subtotal: number): number {
  if (subtotal > 100) return subtotal * 0.1
  return 0
}
TS
cat > web/app/utils/discount.test.ts <<'TS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discount } from './discount.ts'

test('a subtotal well over 100 gets ten percent off', () => {
  assert.equal(discount(150), 15)
})

test('a small subtotal gets nothing off', () => {
  assert.equal(discount(40), 0)
})
TS
cat > web/app/utils/cart.ts <<'TS'
/** The sum of the line prices. */
export function cartTotal(prices: number[]): number {
  if (prices.length === 0) return 0
  return prices.reduce((sum, price) => sum + price, 0)
}
TS
cat > web/app/utils/cart.test.ts <<'TS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cartTotal } from './cart.ts'

test('an empty cart totals zero', () => {
  assert.equal(cartTotal([]), 0)
})

test('a cart totals its line prices', () => {
  assert.equal(cartTotal([10, 5]), 15)
})
TS
cat > web/app/utils/coupon.ts <<'TS'
/** A typed coupon code as the till reads it. */
export function couponCode(typed: string): string {
  return typed.trim().toUpperCase()
}
TS
cat > web/app/pages/checkout.test.ts <<'TS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { couponCode } from '../utils/coupon.ts'

test('checkout reads a coupon pasted with spaces around it', () => {
  assert.equal(couponCode('  save10 '), 'SAVE10')
})
TS

out=.git/skrymer-ai/mutation
mkdir -p "$out"
head=$(git rev-parse HEAD)
cat > "$out/nuxt-web.log" <<LOG
nuxt (web) mutation sweep, 2026-10-30T09:12:44.000Z
HEAD: $head
base: $head
git status:
## feature
?? web/app/pages/
?? web/app/utils/
scope: web/app/utils/cart.ts, web/app/utils/coupon.ts, web/app/utils/discount.ts
memory: capped at 10G in a systemd scope
command (in web): pnpm exec stryker run --mutate app/utils/cart.ts,app/utils/coupon.ts,app/utils/discount.ts --reporters json,clear-text

All tests
  ✓ a subtotal well over 100 gets ten percent off (killed 4)
  ✓ a small subtotal gets nothing off (killed 2)
  ✓ an empty cart totals zero (killed 1)
  ✓ a cart totals its line prices (killed 3)
Ran 1.00 tests per mutant on average.
------------|---------|----------|-----------|------------|----------|
File        | % score | # killed | # timeout | # survived | # no cov |
------------|---------|----------|-----------|------------|----------|
All files   |   76.92 |       10 |         0 |          3 |        0 |
 cart.ts    |   80.00 |        4 |         0 |          1 |        0 |
 coupon.ts  |    0.00 |        0 |         0 |          1 |        0 |
 discount.ts|   85.71 |        6 |         0 |          1 |        0 |
------------|---------|----------|-----------|------------|----------|

exit: 0
LOG
printf '%s\t%s\t%s\n' \
  'web/app/utils/discount.ts:3' 'EqualityOperator → subtotal >= 100' 'Survived' \
  'web/app/utils/cart.ts:3' 'ConditionalExpression → false' 'Survived' \
  'web/app/utils/coupon.ts:3' 'MethodExpression → typed.toUpperCase()' 'Survived' \
  > "$out/nuxt-web.survivors.tsv"
