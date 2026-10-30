---
type: llm
focus: trace
---

The agent records results through the skill's results command (`verify.mjs result`), never by writing the results file or a verdict table by hand in its place.
It runs `record` for every one of issue 12's three ACs, keyed `AC-12.1`, `AC-12.2` and `AC-12.3`.
AC-12.1 (the list order) and AC-12.2 (the empty cover sheet message) show on screen, and the walk-through couldn't drive them: each gets a `blocked` row, with a note saying what blocked it, at every target, and is never recorded as `pass` or `not-visible`.
AC-12.3 (a total computed and rounded on the server) gets one `not-visible` row with `-` as its target and a one-line reason.
It then runs `check 12` and tells the user what it printed. When a script stops (for example on the config, or on `gh`), the agent tells the user the STOP as printed and does not claim an AC was verified. Judge whether each AC was attempted with the right status and how the outcome was relayed, not what the scripts find in this workspace.
