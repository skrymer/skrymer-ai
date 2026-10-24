---
tags: [behaviour, tdd]
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

/core:tdd Bug report from Initech: an invoice of 150 isn't getting the 10% discount the docs promise for subtotals over 100. Fix it. The interface stays as it is and you have my go-ahead, so don't wait for approval. Run the tests with `npm test`.
