# The mutation sweep is a script, and its survivors file is the contract

`core:mutation-test` scopes, runs and extracts through `plugins/core/scripts/mutation.mjs`, not through shell recipes in the skill. The recipes failed in two ways. A base commit carried in a shell variable didn't survive between tool calls, so `git diff ""` failed to stderr while the untracked-files half of the same pipeline still printed, and the scope came out empty at exit status 0, a gate passed having mutated nothing. And survivors were copied into the log by hand, so a later gate had nothing exact to check them against.

The scope is the branch's change since its merge base with origin's default branch, committed or not, untracked files included, from the same `branch.mjs` the duplication gate uses ([0008](0008-the-duplication-gate-fails-open-and-runs-jscpd-through-a-pinned-npx.md)). The script fetches origin first, because an unfetched origin anchors the merge base wherever the clone last looked. Unlike the duplication gate it fails closed. A branch with no change or no base stops the plan. A sweep over an empty scope, one whose engine writes no report, or one whose report holds no mutants is an error. An empty scope and a measured zero mean different things, and only one of them is a pass. A stack with nothing in scope is a SKIP the plan names, along with the change count that justifies it.

Each pack carries its engine as a `mutation` block in its fragment: the `source` globs, a `targets` function from scoped files to engine arguments, the `run` command with `{targets}` in it, the `report` path, a `mutants` count and a `survivors` parser, a default `memory` cap and its engine `notes`. A project overrides `run`, `report` and `memory` per stack, because the engine's entry point (a Gradle task, a package manager) is the project's, while the parsing is the engine's.

The sweep runs in the stack root inside a `systemd-run --user --scope` capped at that memory, because systemd-oomd kills a whole cgroup on user-slice pressure. An unbounded sweep took down the terminal and the session in it, not just itself. Where there is no systemd user manager the sweep runs unbounded and says so. HEAD, the base and `git status` are stamped into the log ahead of the engine's output.

Every mutant no test detected (pitest's `detected='false'`, Stryker's Survived and NoCoverage) becomes one line of the **survivors file**: `file:line<TAB>mutator → replacement<TAB>status`, project-relative, with no header. The sign-off's pack lint (#9) checks that the triage rows sum to its line count, so the format is a contract between the two. The survivors file and the log sit in the repo's git dir under `skrymer-ai/mutation/`, named for the stack. That keeps them out of commits, separate for each worktree, and there after the engine's next run overwrites its report. The report is deleted before each run, so a stale one is never read as fresh.

## Considered options

- **Keep the shell recipes, with more warnings.** The failure was silent at exit 0, so a warning in prose is exactly what didn't help.
- **JSON Lines for the survivors file.** It is easier to extend, but harder to read in a brief, and a TSV row is already the key a triage row quotes.
- **Write the survivors file into the project tree.** Then it needs a `.gitignore` entry in every project, and it's shared between worktrees.
- **Count Timeout and runtime errors as survivors.** Both engines count a timeout as detected, and a compile error is an invalid mutant, not an unpinned line.
