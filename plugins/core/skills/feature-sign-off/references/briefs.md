# Briefs

Each judging agent's contract (its angles, rules of evidence and report shape) lives in its core
definition, so a brief carries only what changes per run. Its template, `briefs/<agent>.txt`
beside this skill, is only those slots. The renderer fills it, and the resolutions pass checks
each sent brief against the rendered one by exact diff, so a brief is sent as printed or not at
all:

```
node <scripts>/brief.mjs <agent> [--label <name>] [--commit <sha>] --slot <name>=<value> …
```

It prints the brief and saves it in the repo's git dir under `skrymer-ai/sign-off/briefs/`. A
re-run of an agent takes a `--label` (`--label 2`), and so does its transcript check. `--commit`
defaults to HEAD, which is the commit the judging message points at once you've committed.

The renderer fills from the branch: the repo, whether it is a worktree, the base, the commit, and
the gate's diff, saved without lockfiles. Fill every other slot. A slot with nothing to say takes
"none", and one left out stops the render. `@<file>` reads a value from a file, for output too
long to quote, such as the scope script's.

| Slot | What it holds |
| --- | --- |
| `what` | What the change does, in one or two sentences in the code's own terms: description, never assessment |
| `issue` | How to read the issue: `gh issue view <n> --comments`, the local issue file, or none. Several issues take one line each |
| `parent` | The parent issue, read the same way, or none |
| `files` | The files that matter most, or that other agents already read, to start from |
| `scope` | `adr-scope.mjs`'s output, whole (check-adrs) |
| `pack` | The resolutions pack's path |
| `transcripts` | One transcript report per agent the run spawned (`transcript.mjs <transcript>`, saved), each with its agent |
| `runs` | Each saved run the pack cites, with the HEAD and `git status` it was stamped with, or none |
| `scratch` | `you may copy the repo into <dir> and run tests there`, or `not allowed` |
| `question`, `position1`, `position2` | The blind arbiter's one question, and each position with the evidence its agent cited, quoted from its transcript |
| `results`, `head` | The verify results file and the commit its head file names (verdict auditor) |
| `probes` | Each `MET (probe: …)` row the acceptance ledger returned, quoted, or none |
| `memory` | The memory index's path, or none (retro miner) |

The blind arbiter's brief has no diff, by design: the working tree is not evidence for either
position. A position carries what its agent cited, never your resolution row, and never a "for
example" that is one position's framing.
