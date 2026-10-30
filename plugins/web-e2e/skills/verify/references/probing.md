# Probing: inputs first, states second

"Probe two edges" gets read as *the empty state and the error path*, and that is not enough.
Those are states the app puts itself in. The bugs live in the values **the user** puts in.

A filter walked with three queries, all lowercase and all matching, hid that a capitalised
query found nothing and that an accented name was unreachable from a phone keyboard. Both
survived hundreds of tests and a full mutation score on the file that held them.

## Inputs

For each input the change added or changed (a text field, a number, a picker, a date) ask what
shapes a real user's data comes in, and drive at least one of each, at its boundaries:

| Input | Shapes to drive |
| --- | --- |
| A text query | a **capitalised** word, an **accented** name, whitespace alone, the empty string, a word matching nothing |
| A capped, trimmed name | the cap and cap+1 **padded with spaces**; the cap counted in UTF-16 (16 × 😀 is 32 units); a character the client and server trim differently (`"\u001F"`, `"﻿"`), alone and in front of a real value, through every client-side decision the name feeds (a duplicate check, a preview), not only the server's refusal |
| A number | zero, the rule's boundary, one past it, a decimal where an integer is expected, an extreme you pick rather than the largest seeded value. Where the display chains two steps, the value one step pushes over the next one's threshold (round-then-group carries `999.5` to `1,000`) |
| A list | none, one, the cap, one past the cap |
| A date | today, local midnight, a day the rule spans; for a derived day, the last day of a month, 31 Dec, 28 Feb in a leap year. A bound anchored to today moves daily: judge each bound on its own |
| A cell with several flags | each pair of flags (selected, disabled, today, marked) on one cell |
| A server rule the UI can't reach | both edges, one past each, and the field omitted, through `verify.mjs api request … --expect <status>`, on every endpoint that runs it. A value the client refuses never reaches the server's refusal: change the state behind the page over the API so the client accepts what the server refuses |
| A new request-body field | read the saved record back through the API after the save: a form can look right and send nothing |
| A threshold the code reads | a breakpoint, a timer, a debounce, a grace period: value−1 and value. A reveal delay (skeleton, dim) too: hold the endpoint for the slow side, read the element's opacity at insertion for the fast side |
| A size or type change | the widest figure the data allows in each fixed box, and the same at `html` font-size 20px |
| A migration | the upgraded database, not only a fresh one: seed on the main branch's build, then start the branch on the same data with `verify.mjs stack up --disposable-db` |

## States

Then two states, chosen by what the change could plausibly have broken: empty, the error path,
the reset. And:

- **The case each fix commit on the branch was written for.** `git log` the branch and drive
  each fix's own scenario.
- **Every other caller of a shared path the diff changed**, not only the screen the issue names.
- **For a refactor or a style sweep, the inputs come from the files the diff rewrote**, not the
  screens the issue names: every `v-if` or conditional branch hosting a changed line is a state.

## Driving them

- **Force a failure branch with a labelled shim**, not a real value that happens to fail some
  other way: `route` the one request to a status, a network error or a hold, and say so in the
  note. `unroute` after.
- **Reload before reading the page again** after a shim or a write made straight to the API.
  Neither re-reads the page's data, so a stale row isn't a finding until a fresh page shows it.
- **Check a field's value after typing into it.** `fill` sets it at once; `type` sends keys.
  Drive the golden path and one boundary with `type`, since keystroke and blur timing is where
  some bugs live.
- **Assert a precondition before a committing click.** A selector that matches nothing changes
  nothing, and the Save after it saves the record unchanged: a probe that reads as passed.
- **"Can't be driven" is a claim.** Before writing it, look for every endpoint that can put
  the app in that state, and for rows already stored that hold it.
