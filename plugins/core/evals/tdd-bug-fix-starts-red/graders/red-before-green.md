---
type: llm
focus: trace
---

Before the agent edits src/invoice.mjs, it adds a test for the reported bug (an invoice over 100 that gets the discount) and runs the tests, and that run fails on the new test.
After the fix, the agent runs the tests again and they pass.
