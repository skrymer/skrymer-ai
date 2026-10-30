---
tags: [behaviour, msw]
runs: 3
plugins: ["../../../core", "../.."]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

/web-e2e:msw Add a test to `src/profile-card.test.ts` for when Initech's API fails to return the signed-in user: the card should show the alert. Dependencies can't be installed in this workspace, so write the test without running it.
