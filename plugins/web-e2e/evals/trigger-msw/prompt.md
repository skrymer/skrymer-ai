---
tags: [trigger, msw]
runs: 3
plugins: ["../../../core", "../.."]
max_turns: 3
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

I'm about to write a component test for Initech's invoices page, which loads the current user from the users API. How should the test fake that API response, and how do I make it return a 500 for the error-state test?
