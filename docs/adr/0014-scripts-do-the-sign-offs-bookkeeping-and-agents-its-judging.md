# Scripts do the sign-off's bookkeeping, and agents and the user do its judging

The sign-off splits its work in two. **Bookkeeping** is everything with one right answer: which gates run and over which stacks, whether the build passes, which docs are in scope, what text a brief should hold, what an agent was sent and what it returned, whether it ran as its definition, and whether a count matches its source. **Judging** is everything that needs a reading: a finding, a survivor's verdict, a dismissal, a ruling on what the product should do. Bookkeeping is done by `core` scripts with process-boundary tests. Judging is done by fresh agents ([0013](0013-core-orders-the-sign-off-and-fresh-read-only-agents-judge-it.md)) and, where it is a product decision, by the user.

The split comes from one run of the hand-run sign-off this was ported from: half of its resolutions-pass rejections were bookkeeping slips, not judgements. They were a brief retyped with a line the template didn't have, a transcript read through a filter that picked the closing text line instead of the report, an agent launched general-purpose instead of as its definition, and a count copied wrong. Each cost a judging round, and none needed judgement to catch. A prose recipe for a mechanical step is followed most of the time, and the times it isn't are invisible until something downstream trips on them.

So a brief is rendered from its template by `brief.mjs`, which fills the slots the branch decides and refuses a slot left out, and saves what it printed. `transcript.mjs` reads a subagent's session JSONL: the type it ran as (from the meta file beside it), the brief it was sent (the first user message), and its report (the `SubagentHandback` call, never the text blocks). Before the resolutions pass reads the pack, `transcript.mjs check` rejects a missing transcript, a fork, an agent not launched as `core:<agent>`, one that never handed back, and a brief that differs from the rendered one by a single byte. The resolutions agent then judges only what a script can't: what the per-run slots say, whether a fix answers its finding, and whether a dismissal holds.

An agent never does bookkeeping a script can do, and a script never rules on a finding.

## Considered options

- **Keep the bookkeeping in prose, and have the resolutions agent check it.** That is what produced the slips, and it spends a judging agent's attention on comparisons a diff makes exactly.
- **Have the conductor fill templates by hand and diff them itself.** The diff would still be a model reading two texts, and a retyped brief is how the slips started.
- **One script for the whole sign-off.** The steps run at different points in a run, between agents, so they are separate commands. A single entrypoint would only route to them.
