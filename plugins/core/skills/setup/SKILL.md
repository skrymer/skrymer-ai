---
name: setup
description: Adopt the skrymer-ai workflow in this project, or report its drift with --check.
argument-hint: "[--check]"
disable-model-invocation: true
---

# Setup

The **planner** does the work: `node <base>/../../scripts/setup.mjs`, where `<base>` is this skill's base directory. Run it from the project root. It detects the stacks from each pack's marker files, computes every file change, and writes only on `apply`. Re-running it is how an existing project migrates, and a set-up project plans nothing.

Claude Code protects `.claude/settings.json`: no script may write it, and every write goes past the user (ADR 0009). So `apply` leaves that file, and the session writes it with the Write tool, which asks the user.

Arguments: $ARGUMENTS

## With `--check`

Run `node <planner> check` and show its output as printed. Stop there: `--check` writes nothing.

Done when: the report is in front of the user.

## Otherwise

1. **Plan.** Run `node <planner> plan` and show the whole output: the stacks found, any stacks entry to add to an existing config by hand, any other step by hand, any file the planner cannot read, anything it skipped, the git config it sets, and the diff of each file. Ask the user to confirm it.
   Done when: the user has approved the plan, or said what is wrong with it. A wrong or missing root is fixed in `.claude/skrymer-ai.config.mjs` after applying, because the planner proposes only what it detects. A file the planner cannot read stays unplanned until it can, and the user hears which.

2. **Apply.** Run `node <planner> apply`. It names the files it wrote, the protected files it left, and the git config it set. Setting `core.hooksPath` is part of the plan the user approved, so if `apply` could not set it, run the `git config` line it prints.
   Done when: it exits 0, and `core.hooksPath` is set if the plan set it.

3. **Write the settings.** If `apply` left `.claude/settings.json`, run `node <planner> plan --json` and write that file with the Write tool, using the `after` of its entry in `changes`, exactly as given.
   Done when: the write is made, or the user has declined it.

4. **Hand over the install.** Installing plugins writes Claude Code's own config, so the user runs it. Give them one line per plugin the settings enable, to run with the `!` prefix: `! claude plugin install <plugin> --scope project`. Put `! claude plugin marketplace add skrymer/skrymer-ai` first, for a machine that lacks the marketplace.
   Done when: the user has every command.

5. **Finish by hand.** Tell the user, for each that applies:
   - An edited `package.json` (Probity removed) needs the package manager's install, so the lockfile drops it too.
   - A code-intelligence plugin (`kotlin-lsp`, `typescript-lsp`) needs its language server on the `PATH`; its plugin page names the binary.
   - The packs' hooks and skills load in a new session.
   - An entry the plan said to add by hand goes in the project config, and a line under "By hand" goes where it names, such as the line that runs the skrymer-ai hook from a husky pre-commit hook.
   - The pre-commit hook and the CI workflow are new files to commit.

6. **Validate.** Run `node <planner> check`.
   Done when: it reports no drift, or the user has heard what each remaining line needs.
