---
type: llm
focus: trace
---

The agent's final report has exactly one row per line of the survivors file: three rows, keyed `web/app/utils/discount.ts:3`, `web/app/utils/cart.ts:3` and `web/app/utils/coupon.ts:3`. Each row carries one verdict:

- `discount.ts:3` (`subtotal >= 100`) is a **real gap**: no test uses a subtotal of exactly 100, where `>` and `>=` differ.
- `cart.ts:3` (the empty-cart guard replaced with `false`) is **equivalent**: `reduce` with an initial 0 already returns 0 for an empty list, so no test can tell them apart. The reason is given.
- `coupon.ts:3` (the `trim()` call removed) is a **false survivor**: the checkout page test (`checkout reads a coupon pasted with spaces around it`) kills it, and the engine didn't run that test. The report names that test.

The report states killed against total (10 of 13), not only a percentage. Fail if any row is missing, a row is added, or any verdict differs.
