# Verify records a result per acceptance criterion through a script, and its results file is the contract

`/web-e2e:verify` walks an issue's acceptance criteria in a real browser, and the AC coverage report (#42) fills its "Verified in browser" column from what the walk-through found. The walk-through is driven by an agent, and an agent that chooses what to walk and then writes the report on it can leave an AC out without anyone noticing. So the result is recorded row by row through `core`'s `verify-result.mjs`, and the same script checks the set is complete. The script is in `core` because nothing about it is specific to the web: a pack's verify skill drives its own platform (`/web-e2e:verify` drives a browser) and writes its rows through it. "Never skipped silently" is then checked by code, not left to the skill's prose.

Each AC is keyed `AC-<issue>.<n>`, where `n` is the AC's 1-based position in the issue's checklist. That works for issues written before `to-issues` numbers its ACs, and once it does the two keys are the same.

The **verify results file** has one row per AC and target, `AC<TAB>target<TAB>status<TAB>screenshot<TAB>note`, with no header. The status is `pass`, `fail`, `blocked` or `not-visible`. A `not-visible` AC has one row, with `-` for the target and the screenshot, and its note gives the reason (for example a backend-only rule, or an ADR). Any row whose status isn't `pass` needs a note. A target is what the walk-through runs on: a viewport for the web, a device profile for a future native pack. The target names are the stack's `verify.targets` in the project config. `record` validates a row and appends it, replacing an earlier row for the same AC and target, so re-driving an AC after a fix leaves one result. `check <issue>` reads the issue's ACs and fails if any AC lacks a row for every configured target, or a `not-visible` row.

The file, its screenshots and a `head` file sit in the repo's git dir under `skrymer-ai/verify/<issue>/`, which keeps them out of commits and separate for each worktree, as with the survivors file ([0010](0010-the-mutation-sweep-is-a-script-and-its-survivors-file-is-the-contract.md)). `head` holds the commit and a hash of the uncommitted diff the walk-through ran on. The walk-through has to run on the code that ships, because review and simplification change behaviour, so the coverage report rejects results whose `head` doesn't match the branch it is checking.

## Considered options

- **A Markdown verdict, as the walk-through's prose report.** It is easy for a reviewer to read but hard to parse reliably, and it can't show an AC that is missing.
- **JSON for the results file.** It is easier to extend, but a TSV row is one AC on one target, and `grep`, `wc` and a brief can quote it as it stands.
- **One row per AC, with the targets as columns.** The set of targets belongs to each project, so the width of each row would change from project to project.
- **Call the column `viewport`.** That is accurate for the web, but a native app is walked on device profiles, and the rows have to stay the same.
- **Key by the AC's text.** A typo fixed in the issue would then orphan the result.
