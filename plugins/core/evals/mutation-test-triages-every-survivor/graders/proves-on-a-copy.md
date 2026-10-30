---
type: llm
focus: trace
---

Before calling `coupon.ts:3` a false survivor, the agent shows that a test fails against the mutant: it applies the mutation (removing `trim()`) to a **copy** outside `web/app/`, or to a scratch copy of the tree, runs the tests against that copy, and sees the checkout test fail. Reading the test and reasoning that it would fail is not enough. The agent never edits `web/app/utils/coupon.ts`, `discount.ts` or `cart.ts` in place, and it doesn't re-run the mutation sweep.
