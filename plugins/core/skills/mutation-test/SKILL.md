---
name: mutation-test
description: Runs mutation testing over the fast test suites of each stack a change touches, scoped to the source the branch changed, then triages every surviving mutant. Use as the mutation gate of feature-sign-off, or when the user asks to mutation-test a change, run Stryker or pitest, measure a mutation score, or check whether the tests would actually catch a bug.
---

# Mutation test

Coverage says a line ran. Mutation testing asks whether any test would have **noticed it
change**. The engine rewrites the source one mutant at a time and re-runs the tests that cover
it. A mutant that survives is a line no assertion pins.

Each pack brings its stack's engine: pitest for `kotlin-spring`, StrykerJS for `nuxt`. The
**sweep script** does the scoping, running and survivor extraction:
`node <base>/../../scripts/mutation.mjs`, where `<base>` is this skill's base directory. Run it
from the project root. Never retype its steps as shell. A shell variable that didn't survive
between tool calls once gave a silent zero-scope run that passed the gate.

**Out of scope for every engine:** browser and container layers (Playwright, Testcontainers),
which are far too slow to re-run per mutant, and anything no engine reaches, such as hook
scripts. Sweep those by hand. List one named mutant per changed behaviour, not per changed line:
each regex alternative, each joined part of a string, each cap or ordering a comment claims.
Apply each as an exact string replacement to a scratch copy and run the tests there. A mutant
killed by a test that fakes an external tool proves nothing unless the fake has the real tool's
process structure.

## Workflow

1. **Plan.** Run `node <script>` and show its output. It fetches origin, measures the branch from
   its merge base with origin's default branch (committed and uncommitted, untracked included),
   and prints for each stack the files in scope, its run command and its engine notes. It also
   prints a SKIP for each stack with nothing in scope.
   - **SKIP** is a result. Report it with the change count it names.
   - **STOP** means the branch holds no change or has no base. That is not a skip: nothing
     was measured. Report it and stop.
   - Read each in-scope stack's **engine notes** before triaging. They hold that engine's blind
     spots.
   - A test file the diff deletes takes its subject's spec with it, and the scope doesn't
     see that. Read the deleted test's imports (`git show <base>:<file>`) and sweep the sources
     it rendered as well, by hand with the engine notes' single-file command.

   Done when: every stack is either in scope or reported as SKIP, or the plan stopped.

2. **Sweep each stack, one at a time.** Run the `run:` line the plan printed, in the background.
   A sweep takes minutes. **Never run two sweeps at once.** Each fits in memory alone and not
   together, and the script caps each one in a systemd scope so a runaway fails alone instead
   of taking the session with it. The script stamps HEAD and `git status` into the log and prints
   killed against total. Every undetected mutant becomes one line of the survivors file:
   `file:line<TAB>mutator → replacement<TAB>status`.
   A sweep that fails (empty scope, no report, zero mutants) measured nothing. Fix the cause and
   re-run. Never report it as a pass.

   Done when: each in-scope stack's sweep printed its counts and survivors path.

3. **Triage every line of every survivors file.** The deliverable is a verdict on each survivor,
   not a score. Each survivor gets exactly one of these:
   - **Real gap.** The mutant changes behaviour a user could observe, in a module that owes its
     own test. Write the missing test red-green (`core:tdd`). Show the red on a **mutant copy**,
     because the source is already correct and the TDD gate refuses an in-place mutant. A mutant
     whose only effect is a thrown error is a real gap: "the user sees nothing" is not
     equivalence.
   - **Killed by an out-of-scope layer.** The module is thin glue whose red lives in an e2e or
     smoke test the engine can't see. **Name the spec and the test that kill it.** If none
     does, it is a real gap in that layer.
   - **Equivalent.** It is semantically identical, so no test can kill it (`x >= 0` → `x > -1`, a
     default never reached). Record why in one line. A branch the code says handles a case is
     not "never reached" until a test reaches that case. Hand-mutate it with a fixture where the
     two outcomes differ.
   - **False survivor.** A test does kill it, but the engine never ran that test. Suspect this
     whenever a whole class scores 0%. Settle it by hand-mutating a throwaway copy and running
     the suite against it (the engine notes say how for each stack). If tests fail, no test is
     owed.

   Rules that keep the verdicts honest:
   - **Check the project's standing verdicts first**, if it keeps a known-survivors file. Triage
     what *this change* introduced. Re-open an entry only if the code under it moved, and retire
     one whose code the change deleted.
   - **Call a survivor "pre-existing" only after running that mutant against the base.** A
     survivor on a line the change moved can look inherited and still be new. Diffing survivor
     sets by source line, base sweep against branch sweep, does a whole file at once.
     "Pre-existing" says where a survivor came from, not what it is. It still gets a verdict.
   - **Re-run a survivor's line alone before triaging it.** A scoped sweep can leave survivors
     that a targeted re-run kills.
   - **Check which test kills a mutant you wrote a test for.** A kill by an unrelated test can
     come from state leaked between tests.
   - Never raise a threshold or narrow the scope to make a survivor go away.

   Done when: every line of every survivors file has one verdict and its evidence.

4. **Report** per stack: killed against total (not just a percentage), the survivors file's
   path, and a row per survivor:
   `| file:line | mutator → replacement | verdict | evidence |`. The row count equals the
   survivors file's line count.

## Delegating triage

With more than ~3 survivors, spawn one **read-only** subagent to classify them and return only
the rows. The report is bulky and the conclusion is small. Write the tests yourself afterwards.
Fill the slots with paths, never with the verdicts you lean towards:

```
READ-ONLY: do not edit, create or delete any file, in the repo or outside it.

A mutation sweep ran over [the scoped files] at [HEAD sha]. Every undetected mutant is one
line of [survivors file path]; the engine's full report is [report path], and the sweep's log
is [log path]. The four verdicts and their rules are in [this skill's SKILL.md], step 3, and
the engine's blind spots in [engine notes path]. Standing verdicts: [known-survivors path, or
"none"]. The change under test: git diff [base sha]. Read anything else you want.

For every line of the survivors file, return one row:
| file:line | mutator → replacement | verdict | evidence |
verdict is one of: real gap, killed by an out-of-scope layer (name the spec and test),
equivalent, false survivor, or standing (quote the entry, and say whether the code under it
moved). Evidence cites the source lines that decide it. A mutant whose only effect is a thrown
error is not equivalent; say where the error goes. Return a row for every line, marking the
ones you are unsure of UNSURE.
```

## Related

`core:tdd` (writing the missing test) · `core:feature-sign-off` (runs this as its mutation gate) ·
each pack's playbook and engine notes.
