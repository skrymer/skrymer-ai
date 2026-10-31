---
name: mutation-test
description: Runs mutation testing over the fast test suites of each stack a change touches, scoped to the source the branch changed, then has a fresh triager agent give every surviving mutant its verdict and writes the missing tests. Use as the mutation gate of feature-sign-off, or when the user asks to mutation-test a change, run Stryker or pitest, measure a mutation score, or check whether the tests would actually catch a bug.
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
   - Each in-scope stack's **engine notes** hold that engine's blind spots. The triager reads
     them, and so do you before writing a test.
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

3. **Hand every survivors file to the triager.** The deliverable is a verdict on each survivor,
   not a score, and the author doesn't give it. Spawn the **mutant triager**
   (`subagent_type: core:mutant-triager`) fresh, in the background, with this brief, every slot
   filled with a path, never with a verdict you lean towards:

   ```
   Repo: <absolute path> (<a git worktree | the main checkout>; stay in it).
   The change: cd <path> && git diff <base sha>. The sweep ran at <HEAD sha>.
   Survivors file: <path>. Engine report: <path>. Sweep log: <path>.
   Engine notes: <path>
   Standing verdicts: <the project's known-survivors file> | none
   ```

   One triager per stack, each with its own survivors file. A stack with no survivors needs
   none. The four verdicts, their rules of evidence and the row format are in its definition.

   Done when: every triager has returned, with one row per line of its survivors file. A missing
   or extra row, or an UNSURE, goes back to it with what to settle.

4. **Write the missing tests.** For each real-gap row, write the test red-green (`core:tdd`),
   under the TDD gate. Show the red on a **mutant copy**, because the source is already correct
   and the gate refuses an in-place mutant. Check which test kills the mutant: a kill by an
   unrelated test can come from state leaked between tests. Never raise a threshold or narrow
   the scope to make a survivor go away.

   Done when: each real gap has a test that kills its mutant.

5. **Re-sweep after a fix.** A later fix on lines the sweep covered re-runs the sweep over the
   files the fix touched, and its new survivors go to a fresh triager in the same way. A verdict
   on a changed line no longer stands.

6. **Report** per stack: killed against total (not just a percentage), the survivors file's
   path, and the triager's rows as it returned them:
   `| file:line | mutator → replacement | verdict | evidence |`, with the test you wrote named
   on each real-gap row. The row count equals the survivors file's line count.

## Related

`core:mutant-triager` (the verdicts) · `core:tdd` (writing the missing test) ·
`core:feature-sign-off` (runs this as its mutation gate) ·
each pack's playbook and engine notes.
