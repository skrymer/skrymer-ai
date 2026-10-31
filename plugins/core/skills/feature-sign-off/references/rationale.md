# Why the sign-off is shaped this way

The reasoning behind the rules in [SKILL.md](../SKILL.md), for when a gate's order or the fixed
core looks arbitrary and you are tempted to change it.

## The order is load-bearing

- **The build first, before any agent.** An agent spent on code that doesn't build is wasted, and
  `check` is minutes where the agents are tens of minutes.
- **Simplify before mutation.** Mutate the shipping code, not a draft.
- **Mutation before review.** The tests it adds are part of what the review reads. A review that
  ran alongside it would miss a vacuous assertion the sweep just wrote.
- **Review and check-adrs side by side.** Both edit nothing, so running them back to back spends
  the shorter one's wall-clock for nothing. The cost is that both judge pre-fix code, which the
  re-check on the fixed files pays for.
- **Resolutions after every fix, verify last.** The walk-through runs once, on the code that ships,
  and nothing changes under it. When it does change code, the resolutions pass runs again on that
  change, or the walk-through's fixes would be the one part of the diff nobody but their author
  read.

A project selects gates and cannot reorder them, because each position above depends on the one
before it.

## The fixed core

Each selectable gate presumes the change is wanted: simplify cleans it, code review hunts bugs
within it, check-adrs holds it to the recorded decisions. The fixed core asks the questions none of
them does, which is why a project can't turn it off.

- **The adversary** asks whether the change should exist at all. Scoped to the premise and the
  choice of fix, it doesn't duplicate the code review.
- **The acceptance ledger** asks whether it is enough. A change can be sound, clean, well tested
  and true to every ADR, and deliver three of five criteria with every other gate green. The ledger
  enumerates its rows from the issue, not the diff, so a misread criterion can't hide.
- **The resolutions pass** reads the half of each finding the author settled alone: what it means,
  whether the fix holds, and whether a dismissal is true. Without it, the fixes are the
  least-reviewed code in the diff, written last and under the most pressure.
- **The retro** keeps the run's lessons. Left in the conversation, they die with it.

## Fresh context, not a different model

A judge's neutrality comes from holding only its brief, not from running on another model. A fork
carries the author's whole reasoning, so a forked judge starts from the author's conclusion. A
fresh agent briefed with a defence is still narrowed by it: shown the author's reason, an agent
tends to answer whether that reason holds, rather than ask what the evidence says. That is why the
brief contract forbids defences, examples and yardsticks, and why a justification goes in as an
unattributed claim to test.

## Scripts do the bookkeeping

The plan, the scope and the build are scripts, so their output is the same every run and can be
quoted whole. When done by hand from prose recipes, half of one measured run's resolutions-pass
rejections were bookkeeping slips, not judgement calls.
