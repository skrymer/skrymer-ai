---
tags: [behaviour, tdd]
runs: 3
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

/core:tdd Build `shippingCost(order)` in src/shipping.mjs for Globex, tested in test/shipping.test.mjs. An order is `{ subtotal, express }`. The behaviours, in priority order:

1. Shipping is 5 for a subtotal under 50.
2. Shipping is free from a subtotal of 50.
3. Express adds 10 to either.

That is the agreed interface and plan, so go ahead without waiting for approval. Run the tests with `npm test`.
