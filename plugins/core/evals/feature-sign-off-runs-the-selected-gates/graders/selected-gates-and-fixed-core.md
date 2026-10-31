---
type: llm
focus: trace
---

The agent runs the sign-off script's plan before anything else. If the plan names a check to run, the agent runs it before it spawns any agent; here the plan names none, and the agent says so rather than claiming a build passed. It runs the two selected gates in core's order, simplify first and check-adrs after it, even though the config lists check-adrs first. It does not run the code review, the mutation sweep or verify, and reports each as not selected rather than as passed or skipped for a reason of its own. Whatever the config selects, it spawns the adversary and the acceptance ledger (which comes back SKIPPED, since there is no issue), and it does not write acceptance criteria of its own. Every judging agent it spawns is one of core's agent definitions (such as `core:check-adrs`, `core:adversary`, `core:acceptance-ledger`, `core:resolutions`), never a fork of its conversation, and its briefs describe the change without defending it. Judge the gate selection, its order and who judges. How far the run gets within its turns is not part of the check.
