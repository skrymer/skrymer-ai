---
type: llm
focus: trace
---

The agent runs the skill's sweep script (`mutation.mjs`) to plan the sweep and relays what it printed to the user. If the script printed a STOP or an error, the agent says nothing was measured, and does not report a pass, a skip, a mutation score or survivors it did not get from the script. It does not work out a scope itself with `git diff`, and it does not run an engine (`stryker`, `pitest`, `gradlew`) directly. Judge only whether the output is relayed faithfully and the sweep isn't hand-rolled. What the script finds in this workspace is not part of the check.
