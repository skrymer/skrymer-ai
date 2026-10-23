---
tags: [trigger, to-issues]
runs: 3
max_turns: 3
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Turn this plan into issues on our tracker: cache Globex quotes in a Postgres table, refetch expired ones, and show cache hits on the admin page.
