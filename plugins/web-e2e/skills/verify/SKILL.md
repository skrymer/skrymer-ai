---
name: verify
description: Walks an issue's acceptance criteria in a real headless browser at every viewport the project config names, and records a result per AC (pass or fail with a screenshot, blocked, or not user-visible with a reason) for the AC coverage report. With --explore, a fresh break-it tester then tries to break the change beyond its ACs through charters it records the same way. Use when a user-facing change is functionally complete and needs runtime evidence, when the user says "verify this", "walk it through", "check it in the browser" or "does it actually work", or before opening a PR that touches a screen. Runtime behaviour only: not for type checks, builds, linting or code review.
---

# Verify

Tests prove the code does what you told it to. This proves the **app** does what the issue
asked, on screen, at every target: an overlapping control, a layout that breaks at phone
width, a console error or a 500 behind a screen that looks right. The walk-through is driven by
the issue's **acceptance criteria**, not a free tour, and every AC ends with a recorded result.

Scripts do the deterministic parts, all through one entrypoint, `node <base>/../../scripts/verify.mjs`
(`<base>` is this skill's base directory), written `verify.mjs` below:

| Command | Does |
| --- | --- |
| `verify.mjs result head <issue>` / `charter <issue> "<charter>"` / `record …` / `check <issue> [--explore]` | The results file the coverage report reads, the charters an exploration registers, and the check that every AC and charter has a result. |
| `verify.mjs stack up [--disposable-db] [--env K=V …]` / `down` | Starts the stack, a fresh signed-in verify user and the dev server from the project config; prints `dev server: <url>`. `down` stops only what `up` started. |
| `verify.mjs api users <n>` / `request <METHOD> <path> [--as <email>] [--data <json>] [--expect <status>]` | Seeds data and checks server rules through the dev proxy, with the cookie jar and CSRF pair handled. |
| `verify.mjs browser open [--headed] <url>` / `layout <target>` / `close` | One headless `playwright-cli` session per target; prints the command that drives each and where screenshots go. `layout` runs the scripted layout checks. |

Run them from the project root and show what they print. Never retype their steps as shell,
and never write the results file or a verdict table in place of `record` and `check`.

## Workflow

1. **List the ACs.** Read the issue (`gh issue view <n>`, or the file the user names). The
   nth checklist item under "Acceptance criteria" is `AC-<issue>.<n>`, checked or not. Mark
   each **visible** (something on screen shows it) or **not visible** with a one-line reason:
   a server-side rule, an ADR, a CI check. A server rule the UI can reach is visible.
2. **Stamp the code**: `verify.mjs result head <issue>`. The walk-through runs on the code that
   ships. `record` refuses rows once the code changes, so don't fix anything mid-walk: record
   the fail, finish, and walk again from `head` after the fix.
3. **Record the not-visible ACs**: `verify.mjs result record AC-<issue>.<n> - not-visible --note "<reason>"`.
4. **Bring the stack up**: `verify.mjs stack up` (`--disposable-db` when the walk writes data
   you don't want kept). Drive the URL it prints, never the port you expected.
5. **Open the browser**: `verify.mjs browser open <url>`. Drive it as
   [references/driving.md](references/driving.md) says: one session per target, by ref, shims
   labelled, and the evidence read before you navigate away.
6. **Seed over the API** (`verify.mjs api`), not through the UI, unless the setup is the AC.
7. **Walk each visible AC at every target.** Per AC and target:
   - Drive the golden path, then **probe the inputs, then the states**
     ([references/probing.md](references/probing.md)). A probe that breaks fails the AC.
   - Gather the evidence the driving reference lists: the screenshot
     (`AC-<issue>.<n>.png`), the console and requests, and the layout check.
   - `verify.mjs result record AC-<issue>.<n> <target> pass|fail --screenshot <file> --note "<what you saw>"`.
8. **Anything you couldn't walk is `blocked`, never skipped.** When the stack, the browser or
   the screen won't come up, record `verify.mjs result record AC-<issue>.<n> <target> blocked --note "<the
   STOP or error, as printed>"` for every visible AC at every target, then go on to `check`.
9. **Check**: `verify.mjs result check <issue>`. It reads the ACs itself and fails on a missing
   row. Fill what it names. If it stops (for example `gh` can't reach the tracker), say so as
   printed: the results are recorded but unchecked.
10. **Clean up**: `verify.mjs browser close`, then `verify.mjs stack down`. `git status --short`
    should show nothing the walk-through left behind.

## With `--explore <issue>`

The walk-through checks what the issue asked for. Exploration checks what nobody asked about. It
runs after the walk-through, on the same stamped code (`check --explore` needs the AC rows
too), and a fresh **break-it tester**
(`core:break-it-tester`) does it: never explore in this conversation, and never hand it the
walk-through's results, so it doesn't anchor on what passed.

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
   Driving: <absolute path to references/driving.md>
   Heuristics: <absolute path to references/heuristics.md>; inputs: <absolute path to references/probing.md>
   ```

   Its contract (the charter form, the heuristic families, the report) is in its definition.
   Add nothing that says what passed or what the change is for.
3. **Check**: `verify.mjs result check <issue> --explore`. It fails on a charter with no row
   and on a run with no charter at all. When it fails, send the tester back to what it names.
4. **Clean up** as in step 10 above.

Report each charter's result as `check` printed it, then the tester's findings in its own words.
A charter `fail` is not yours to dismiss: the sign-off rules each one a bug in the diff or
behaviour no AC defines. Run standalone, put that question to the user.

## Report

Lead with `check`'s output as printed, then one line per AC and target: the status, what you
saw, and the probe **values** you drove (`"  " → "Add a cover sheet" ✅`). A pass that names
no probe value is a reachability check. Say a phone target is emulated Chromium, not a device.

## Rules

- `pass` only for what you saw work at that target, in that target's session.
- A `blocked` or `fail` note says what you saw or what stopped you, in words the user can act on.
- `playwright-cli` through `verify.mjs browser` is the only driver (ADR 0012): no other browser
  tool, and no throwaway Playwright spec in its place.
- **Pick probe values your fixtures don't already resemble.** A value that looks like the
  happy path is not a probe.
- A display oddity may be by design: check the project's `CONTEXT.md` and design docs first.
