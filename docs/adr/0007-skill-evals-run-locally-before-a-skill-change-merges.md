# Skill evals run locally, before a skill change merges

`core`'s process skills are edited to fit this workflow, and the only check that an edit kept the behaviour a skill exists for is to run an agent on it. `plugins/core/evals/` holds one `claude plugin eval` case per behaviour: a prompt, a scaffold script that seeds a tiny project with fake names, and graders. Graders check what can be checked mechanically (a tool call, the order of two edits, a file left uncreated, a pattern in a file) and leave the rest to an LLM judge with concrete claims to check. `trigger-*` cases ask in plain words and check that the model picks the skill, so a description edit is covered too. The hook engines are deterministic and tested at the process boundary, so they have no evals.

`npm run evals` runs the suite on the author's machine, on their subscription, before a PR that changes a skill merges; `-- --tag <skill>` runs one skill's cases. CI does not run it: a runner would need a credential secret, and every PR would spend from it. `npm run check` stays the CI gate.

The run uses Sonnet as the agent, which is cheap enough to run three times per case, and Opus as the judge. Haiku, the default judge, failed correct vertical slices; and a judge must not be the agent's model. A case passes at 0.8, because one judge vote in three can still go either way. The no-plugin baseline arm is off: the question is whether the skill still does its job, not whether it beats no skill, and the arm doubles the runs.

Each run is a throwaway workspace with only `core` loaded, so the `SessionStart` and `UserPromptSubmit` hooks fire as in a project. A case that needs the session context seeds a `.claude/skrymer-ai.config.mjs`. A case's Bash runs in `bwrap` with its own network namespace. On Ubuntu 24.04 and later, AppArmor refuses that unless `/usr/bin/bwrap` has a profile allowing `userns`, and every Bash call then fails.

The run's sandbox is stricter than an interactive session's, and a case is written for the sandbox it runs in. Protected paths such as `.claude/settings.json` are masked, so they can't even be read, and `dangerouslyDisableSandbox` is turned off. Only the plugin under test is visible, so a script in `core` finds no packs beside it, even ones a case lists under `plugins`. A skill whose real work touches them, like `/core:setup` ([0009](0009-setup-leaves-protected-settings-to-an-approved-write.md)), is graded on its trajectory: the command it runs (a `tool_used` grader on the Bash input), whether it relays the script's output faithfully, and what it leaves unwritten. A judge's criteria never depend on what the script finds in the harness. Its scripts' logic is covered by their own process tests. A case never asks the harness to lift its sandbox.

## Considered options

- **Run the evals in CI on PRs that touch `plugins/core/skills/**`.** That catches a skipped run, but it needs an API key or an OAuth token as a repo secret, and every push to such a PR spends it.
- **Haiku as the judge.** It is ten times cheaper per vote, but it failed sound breakdowns that Opus passes, and a flaky judge teaches people to ignore red.
- **Keep the with-without ablation.** It shows how much a skill changes behaviour, which is worth a one-off look, but it is not a regression check.
