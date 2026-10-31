---
tags: [behaviour, verify-explore]
runs: 3
plugins: ["../../../core", "../.."]
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write]
---

/web-e2e:verify --explore 12. The walk-through of its ACs is done. `gh` can't reach GitHub from this workspace, so the issue's body is in `issue-12.md`, and the branch's base is `main`.
