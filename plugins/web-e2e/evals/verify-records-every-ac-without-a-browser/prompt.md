---
tags: [behaviour, verify]
runs: 3
plugins: ["../../../core", "../.."]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

/web-e2e:verify issue 12. `gh` can't reach GitHub from this workspace, so the issue's body is in `issue-12.md`.
