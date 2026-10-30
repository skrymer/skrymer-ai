---
tags: [trigger, msw]
runs: 3
plugins: ["../../../core", "../.."]
max_turns: 3
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

The Initech invoice reminder test depends on today's date. How do I freeze the clock in that Vitest test so it's always 1 March?
