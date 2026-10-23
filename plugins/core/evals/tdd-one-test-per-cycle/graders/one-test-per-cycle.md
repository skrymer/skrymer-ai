---
type: llm
focus: trace
---

The agent works in cycles of one test each: it adds one test for one behaviour, runs the tests and sees that test fail, then changes src/shipping.mjs until the tests pass, before it adds the next test.
It never adds tests for two or more of the behaviours before the first change to src/shipping.mjs that makes one pass.
