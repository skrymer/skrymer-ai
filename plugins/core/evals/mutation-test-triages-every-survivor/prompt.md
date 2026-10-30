---
tags: [behaviour, mutation-test]
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write]
---

/core:mutation-test The nuxt sweep for this branch has already run; its log and survivors file are in .git/skrymer-ai/mutation/. Don't re-run the sweep. Triage the survivors and give me the report. I'll write any missing tests myself. The tests run with `node --test`.
