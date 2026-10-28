---
type: llm
focus: trace
---

The agent runs the setup planner's `check` and reports every drift line it printed to the user, without dropping or inventing any. It does not run `plan` or `apply`, and changes no file. Judge only whether the report is relayed faithfully; what the check finds in this workspace is not part of the check.
