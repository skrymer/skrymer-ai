# Exploring: `--explore <issue>`

The walk-through checks what the issue asked for. Exploration checks what nobody asked about.
It runs after the walk-through, on the same stamped code (`check --explore` needs the AC rows
too), and a fresh **break-it tester** (`core:break-it-tester`) does it: never explore in this
conversation, and never hand it the walk-through's results, so it doesn't anchor on what
passed. `verify.mjs` is the skill's one entrypoint, as in [SKILL.md](../SKILL.md).

1. **Stamp the code**: `verify.mjs result head <issue>`. On the code the walk-through ran on it
   changes nothing. On changed code it drops the walk-through's rows, which no longer stand.
   Then **bring the stack up**, if the walk-through has taken it down: `verify.mjs stack up`.
   Note the URL it prints.
2. **Spawn the tester** (`subagent_type: core:break-it-tester`) with this brief, every slot
   filled:

   ```
   Repo: <absolute path> (<a git worktree | the main checkout>; stay in it).
   The change: cd <path> && git diff <base> <commit>
   What it does: <one or two sentences in the code's own terms; description, never assessment>
   The issue: gh issue view <n> --comments | <the local issue file>
   Stack config: the stacks entry for <root> in .claude/skrymer-ai.config.mjs
   Verify: node <absolute path to verify.mjs>; run from the project root
   Dev server: <the URL stack up printed>. Targets: <each target and its size>
   Driving: <absolute path to driving.md, beside this file>
   Heuristics: <absolute path to heuristics.md>; inputs: <absolute path to probing.md>
   ```

   Its contract (the charter form, the heuristic families, the report) is in its definition.
   Add nothing that says what passed or what the change is for.
3. **Check**: `verify.mjs result check <issue> --explore`. It fails on a charter with no row
   and on a run with no charter at all. When it fails, send the tester back to what it names.
4. **Clean up**: `verify.mjs browser close`, then `verify.mjs stack down`.

Report each charter's result as `check` printed it, then the tester's findings in its own words.
A charter `fail` is not yours to dismiss: the sign-off rules each one a bug in the diff or
behaviour no AC defines. Run standalone, put that question to the user.
