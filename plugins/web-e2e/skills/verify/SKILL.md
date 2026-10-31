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

Run after the walk-through: a fresh break-it tester explores beyond the ACs. Follow
[references/explore.md](references/explore.md), and nothing in the workflow above.

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
