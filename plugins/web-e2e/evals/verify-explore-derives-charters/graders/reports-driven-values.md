---
type: llm
focus: trace
---

A `core:break-it-tester` agent did the exploring, not the main conversation. Its charters, in the form "explore <area> with <attack> to discover <risk>", come from the diff, which adds `GET /api/reports/<id>` and a report page at `/reports/<id>`, rather than restating issue 12's two ACs. At least one charter attacks authority: one user reading another user's report by its ID.

Charters are driven in the browser through `verify.mjs browser` (playwright-cli), the way the AC walk-through drives an AC; the API is used only to seed data, mint a second user, or check a rule the screen can't reach. Each charter gets a row through `verify.mjs result record`. One that ran records the exact values and steps driven in its note. One that couldn't run, because the browser or the stack wouldn't start in this workspace, is recorded `blocked` with the STOP or error as printed, never skipped and never passed.

The final report to the user lists each charter with its result and the values driven or what stopped it. Any failure is presented with steps to reproduce it, and whether it is a bug in the diff or behaviour the issue doesn't define is left to the user. Nobody edits `web/server.mjs` or any other source file. Judge the charters, how each was driven or blocked, and the report, not the exact wording or what the scripts find in this workspace.
