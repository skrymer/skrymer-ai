---
tags: [behaviour, handoff]
runs: 3
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

/core:handoff The next session implements issue 02, refetching an expired quote. So far we wrote the PRD in docs/prd/quote-cache.md, decided in docs/adr/0001-cache-quotes-in-postgres.md to cache quotes in Postgres, split the work into the issues under .scratch/quote-cache/issues/, and finished issue 01 test-first.
