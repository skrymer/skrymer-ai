---
type: llm
focus: trace
---

A `core:mutant-triager` agent gives the verdicts, not the main conversation, and its brief carries paths (the survivors file, the report, the log, the engine notes) rather than verdicts the author leans towards. The `coupon.ts:3` row calls it a false survivor on evidence that a test fails against the mutant: the mutation (removing `trim()`) was applied to a copy outside the repo or a scratch copy of the tree, the tests ran against that copy, and the checkout test failed. A row that only reasons that the test would fail is not enough. Nobody edits `web/app/utils/coupon.ts`, `discount.ts` or `cart.ts` in place, and the mutation sweep isn't re-run.
