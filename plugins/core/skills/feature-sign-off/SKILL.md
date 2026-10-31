---
name: feature-sign-off
description: The sign-off a functionally complete change passes before it is committed and pushed. Runs the gates the project config selects (simplify, mutation, code-review, check-adrs, verify) in core's fixed order, with an adversary, an acceptance ledger, a resolutions pass and a retro in every run, each judgement in a fresh read-only agent. Fixes or justifies everything they find, then commits, pushes and routes the lessons. Use when a change is done and the user says "sign off", "ready to commit", "ready to push", "wrap up this feature", "run the gates", or before opening a PR.
---

# Feature sign-off

The gate a change passes once it is functionally complete, before it is committed and pushed. It
bundles the checks the project selected into one ordered pass, so nothing ships unverified,
untested, unreviewed, short of what the issue asked for, or out of step with the recorded
decisions. Each gate is a real skill or agent. This skill conducts them and acts on what they find.

It is the exit gate, not a substitute for red-green TDD while building. Run `/core:handoff`
first, so a long run can resume in a fresh session.

**Core owns the order, the project owns the selection.** The project config's `signOff.gates`
picks which gates run. Without it, every gate whose engine an enabled pack provides runs. The
**fixed core** runs in every sign-off whatever is selected: the adversary, the acceptance ledger,
the resolutions pass and the retro. A gate not selected is reported as not selected, never as
passed.

**Every judgement runs in a fresh, read-only agent**, spawned by its core definition
(`subagent_type: core:<name>`) with a brief that holds only that run's slots. Never judge through
a fork of this conversation, and never judge your own fix. The protection is the fresh context.
The agents' contracts are in their definitions. **Render every brief** with the brief renderer
and send its output exactly as printed, never retyped or added to
([references/briefs.md](references/briefs.md)).

Scripts do the bookkeeping, from the project root, where `<scripts>` is `<base>/../../scripts`
and `<base>` is this skill's base directory: `sign-off.mjs` (the plan and the check),
`brief.mjs` (each brief) and `transcript.mjs` (what each agent was sent and returned). Never
retype their steps as shell: scripts do the sign-off's bookkeeping, and agents and the user do
its judging.

## Before any agent

1. **Plan.** Run `sign-off.mjs` and show its output: the selected gates in core's order, the
   stacks each engine gate runs over, the fixed core, and the check each touched stack runs. A
   **STOP** (a config error, no change on the branch) ends the sign-off before it starts. Report
   it as printed.
2. **Build.** When the plan prints a `run:` line under its check, run it in the background. It
   runs each touched stack's `check` command (the full build and tests) in its root. When the
   plan names no check to run, say so in the report and go on. A FAILED stack stops the sign-off before any
   agent is spawned: fix it and re-run. A branch that doesn't build is not worth an agent.
3. **Start the run log.** Keep, for the rest of the run: every agent's transcript path
   (`output_file`), recorded as you spawn it; one diff file per gate, written to the scratchpad
   (`git diff <base> <commit> > diff-<gate>.patch`), never one file rewritten as fixes land; and
   the **resolutions pack**, one row per finding and remedy:
   `| id | agent | finding | remedy | resolution |`.

## The gates, in core's order

Run only the selected ones, in this order. Act on what each surfaces before starting the next.

1. **simplify: clean it up.** Run `/simplify` on the change. It edits the tree, so it runs before
   anything judges the code. Read each of its fixes against the issue's criteria first. Sweep the
   doc comments the diff adds or touches in the same pass: brief, present tense, saying what a
   thing is and any rule a reader would get wrong. No changelog prose, no issue numbers, nothing the
   signature says. Re-read a cross-reference moved to a new target: the link resolves while the
   claim goes false. Re-run the touched tests, then commit.

2. **mutation: do the tests catch bugs?** Run `/core:mutation-test`, which sweeps each stack the
   plan names, scoped to what the branch changed as of simplify's commit, and triages every survivor
   (with its own triager agent when there are several). It runs here because the code is final
   after simplify, and because the tests it adds are reviewed next. Commit the new tests after
   `sign-off.mjs check` passes.

3. **code-review and check-adrs, in the judging message.** Commit, then launch in **one
   message**, all in the background, every brief pointing at that commit (`git diff <base> <commit>`, `git show <commit>:<path>`), never at
   the working tree:
   - the **code-reviewer** (`core:code-reviewer`), when code-review is selected;
   - the **check-adrs** agent (`core:check-adrs`), when check-adrs is selected, briefed from
     `/core:check-adrs`'s scope script as that skill says;
   - the **adversary** (`core:adversary`), always;
   - the **acceptance ledger** (`core:acceptance-ledger`), always, including a change with no
     issue or an issue with no criteria, which comes back SKIPPED. A SKIPPED ledger is a result.
     Writing criteria yourself never is.

   They are all read-and-report, so they run side by side. **Edit nothing until every one has
   returned**, so each judged the code it was pointed at. Then copy every finding into the pack,
   a nit included, split into one row per remedy before any resolution is written.

   **Acting on what the judging message returned:**

   - **Straight to the user, stopping the sign-off:** an UNSOUND ledger row, an adversary attack
     the repo's recorded decisions can't answer, a check-adrs FAIL (offer both the code fix and
     the same-change doc amendment), and anything an agent marks as the user's call. Each is a
     product decision, and no agent owns it.
   - **Everything else is fix-or-justify** (below). Batch a gate's fixes, then run the touched
     tests once.
   - **Re-check after the fixes land**, only where they touched: the constraints check-adrs cited,
     and each ledger row against the criterion's own words. A fix that now answers a different
     criterion than the one filed is UNSOUND and goes to the user. A user ruling that adds
     behaviour or settles how a criterion is met goes into the issue in the user's words, then the
     adversary and the ledger re-run on that commit.
   - **A fix on a line the mutation gate swept re-runs its sweep** over the files the fix
     touched, at any later point in the run. A verdict on a changed line no longer stands.

4. **The resolutions pass: does anything approve its own fix?** Always runs. Commit, run
   `sign-off.mjs check`, then **check every judging agent's transcript** before reading the pack:
   `transcript.mjs check <transcript> <agent> [--label <name>]`. It rejects a missing
   transcript, a fork, an agent not launched as its core definition, one that never handed back,
   and a brief that differs from the one rendered for it, showing the diff. Re-run each rejected
   agent, rendered and launched as its definition, and act on what it returns before going on.
   Then save each agent's report (`transcript.mjs <transcript> > <scratch>/report-<agent>.txt`)
   and spawn the **resolutions** agent (`core:resolutions`) with the pack, the commit as it
   ships, every report, and the saved output of every run the pack cites.
   It judges each fix and each dismissal against the transcripts, checks the pack is faithful, and
   checks the mandatory agents ran. A rejected row goes back to the gate that owns it, and that
   gate's re-run closes it. It is not a second code review: it hunts nothing.

5. **verify: does the shipping code work?** Run the verify skill of each stack the plan names
   (for a web stack, `/web-e2e:verify`), once, last, on the code that ships, so nothing changes
   under it. **Its probe list starts with the ledger's**: every `MET (probe: …)` row is a value
   this pass owes, re-read against the code as it now ships. When the walk-through's results are
   recorded, spawn the **verdict auditor** (`core:verdict-auditor`) with the results file and the
   diff, and drive what it lists as UNCOVERED or WEAK. A FAIL goes back to the gate that owns the
   fix, then here again. **If this gate changed code, the resolutions pass runs again** on what
   changed since it ran, each finding paired with its fix, before the commit.

## Keeping the judging independent

The fan-out buys a fresh context, not an independent position, unless the brief keeps it so.

- **Describe, never defend.** A brief carries what the change does in the code's own terms, the
  commit and the command that shows it, the files to start from (with "read anything else you
  want"), and how to read the issue. Never paste the issue: the agent reads what was filed. A
  brief never carries why a decision was made, the author's defence in any voice, words that
  presume the change is right ("correctly", "the fix for"), a yardstick that pre-scores the
  findings, an example drawn from the change, or another agent's conclusion. A justification that
  must be tested goes in as a claim attributed to nobody: "It is claimed that X. Test that."
- **Name the kind, never the instance.** A brief's angle names the kind of thing to look for. An
  example from the change comes back as the agent's first finding.
- **Splits are settled blind.** When two agents reach opposing conclusions on one question, spawn
  the **blind arbiter** (`core:blind-arbiter`) with the question and both positions, each quoted
  from its transcript, unattributed, and no diff. Test any harm its "strongest case against"
  names before its pick lands. An override of its pick is its own pack row. A split that one
  reproducible run decides (does this rule refuse that line, does this test go red) is settled by
  the run instead: save the output, cite it in the pack, and record why no arbiter was spawned.

## Fix-or-justify

Every finding is fixed or carries a reason it isn't, and an unaddressed finding means the sign-off
isn't done.

- **One row per remedy.** A dismissal answers every remedy its finding names. A row citing the
  user's ruling quotes the question as asked, and an item the question didn't name is asked again.
- **Quote every source a dismissal cites as it stands when you write it**: the ADR, the other
  issue's scope, the precedent on the default branch. Never a handoff or a prototype.
- **"Pre-existing" holds only if the harm is reachable on the default branch**, shown by a saved
  run of the same user steps there. A root cause that predates the diff, given a new consumer by
  it, is the diff's harm.
- **A harm the diff makes worse is fixed**, red-first if a test can measure it. "By design",
  "transient" or "accepted" is not a resolution for it, and neither is a tool refusing the fix.
- **"A follow-up" holds only with a filed issue's number.** A risk deferred to a later or on-device
  check is written into that issue's criteria, with the exact steps, in the same step.
- **A fix is pinned only by a test that fails when the fix is removed.** Prove it on a throwaway
  copy (remove the call, show the named test red), never by mutating the source in place, and save
  the output. A fix of several parts is ablated part by part, and a part whose removal changes
  nothing is deleted. A test named for a combination first shows its fixture meets each condition.
- **The pack copies, it does not recount.** A figure is the saved output's own summary line, whole.
  A row says withdrawn or superseded only once that edit is made.
- **Save every red as it fails**, with `git rev-parse HEAD` and `git status --short` beside it.
- **Before a fix corrects a claim, grep its wording** across the repo, not only the file it was
  found in.

## After the gates

1. If any gate changed code, run `sign-off.mjs check` once more. It must pass before the commit.
2. **Commit and push** on the feature branch, grouped by concern. Open the PR if the user wants
   one, noting the gates that ran.
3. **Retro.** Spawn the **retro miner** (`core:retro-miner`) with every transcript report, the pack
   and the base. It proposes lessons, each with evidence and the one file it belongs in. You apply
   them: a skill or hook edit goes on its own branch and PR, never onto the feature branch, and a
   memory entry is written directly. "Nothing worth recording" is a result.

## Report

Emit the summary in [references/report-template.md](references/report-template.md): one line per
gate in core's order (a gate not selected says so), the agents under the step that launched them,
the check, the push, and the retro.

## Rules

- **Don't rubber-stamp.** A gate that found nothing is a result worth stating. A gate skipped is a
  gap: say which and why.
- **A mid-sign-off handoff passes findings and every remedy on, never verdicts.**
- Between gates, run the touched tests, not the suites. The full `check` runs before the first
  agent and before the commit.
- Why the order and the fixed core are what they are:
  [references/rationale.md](references/rationale.md).
