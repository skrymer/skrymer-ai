# Driving the browser

How a walk-through drives an AC, and how the break-it tester drives a charter: the same way,
through `verify.mjs browser`, which runs `playwright-cli` (ADR 0012). There is no other driver.

## Sessions

- `verify.mjs browser open <url>` opens one headless session per target and prints the command
  that drives each one, and the directory its screenshots go in. Use those commands as printed.
  Add `--headed` only when the user asks to watch.
- Drive the URL `verify.mjs stack up` printed, never the port you expected.
- Drive a target only in its own session. A result at one target says nothing about another.
- `verify.mjs browser close` when you're done.

## Acting

- `goto` the screen, `snapshot` for element refs, and act by ref: `click e12`, `fill e5 "…"`,
  `press Enter`. Never by pixel coordinates.
- `fill` sets a field's value at once, while `type` sends keys. Drive the golden path and one
  boundary with `type`, since keystroke and blur timing is where some bugs live. Check the
  field's value after typing into it.
- Assert a precondition before a committing click. A selector that matches nothing changes
  nothing, and the Save after it saves the record unchanged: a probe that reads as passed.
- Seed data over the API (`verify.mjs api`), not through the UI, unless the setup is what you
  are driving. To act as a second user, mint one (`verify.mjs api users 2`) and sign that
  session in as them.

## Shims

- Force a failure, a hang or a network error with `route` on the one request, never with a real
  value that happens to fail some other way. Say so in the note, and `unroute` after.
- Reload before reading the page again after a shim, or after a write made straight to the API.
  Neither re-reads the page's data, so a stale row isn't a finding until a fresh page shows it.

## Evidence

Before you navigate away from what you drove:

- `screenshot --filename=<the dir open printed>/<target>/<key>.png`, where the key is the AC's
  or the charter's, of what proves the result.
- `console error` and `requests`: an uncaught error, or a 5xx from the app's own server, makes
  the result a `fail` even when the screen looks right.
- `verify.mjs browser layout <target>` on the screen. A finding on what you drove is a `fail`.
  One elsewhere on the page goes into the note.

Then record the result through `verify.mjs result record`, with the screenshot and a note that
names the values you drove.
