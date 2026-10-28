# Setup leaves the protected settings to a write the user approves

Claude Code protects `.claude/settings.json`. Its Bash sandbox denies writes to it even inside the project, an `allowWrite` or allow rule can't lift that, and an Edit or Write to it always asks the user ([sandboxing](https://code.claude.com/docs/en/sandboxing), [permission modes](https://code.claude.com/docs/en/permission-modes)). The platform means a change to an agent's own config to go past a person, so `/core:setup` works with that instead of around it.

The planner still computes the merged settings, so the merge stays deterministic and tested: the marketplace, `core`, the packs and their code-intelligence plugins enabled, the project's own keys kept, and any Probity hook removed. `apply` writes every other file and names the protected ones it left. The skill then writes `.claude/settings.json` with the Write tool, using the content `plan --json` gives, and the user approves that one write. Installing the plugins writes Claude Code's own config too, so the skill hands the user `claude plugin install … --scope project` lines to run with the `!` prefix.

A file the planner can't read, as when a sandbox hides a protected path, is reported and left unplanned, and the rest of the repo is still planned. `check` counts it as drift.

## Considered options

- **Run the planner with the sandbox off** (`dangerouslyDisableSandbox`). It works in an interactive session after a prompt, but it asks the user to drop a protection for the whole command, where an approved Write drops it for one file. It also fails outright where unsandboxed commands are disallowed, as in `claude plugin eval`.
- **Add the planner to the sandbox's `excludedCommands`.** That gives the script full access on every run, needs a settings change before setup can run at all, and a managed sandbox ignores project exclusions.
- **Let the skill merge the settings by hand** with Read and Edit. That avoids the hand-off, but the merge rules (Probity removal, deduplicated plugins, kept keys) would live in prose instead of in tested code.
