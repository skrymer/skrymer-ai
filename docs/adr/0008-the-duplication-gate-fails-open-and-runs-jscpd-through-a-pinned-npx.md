# The duplication gate fails open, and runs jscpd through a pinned `npx`

`core`'s duplication gate refuses a new test while the branch holds duplicated source code it added. It runs jscpd through `npx` at an exact version, as the TDD gate runs Probity ([0005](0005-core-runs-probity-with-a-config-it-ships.md)): a project installs nothing, a Kotlin-only repo needs no `package.json`, and an upstream release reaches projects only through a `core` release. jscpd runs from the npx cache with a config that `core` writes, so a project's own jscpd config can't empty the scan or change how jscpd exits. `SKRYMER_AI_JSCPD` names another command, such as a local install.

Unlike the TDD gate, it fails open. A scan that can't run lets the write through and says "duplication-gate skipped: …" to the user and the agent, so a skipped scan never reads as a clean one. That covers jscpd failing, a missing baseline ref, or a scan past its 8-second limit, which is killed along with every process it started. A skipped TDD check lets untested code in. A skipped duplication check only defers one refactor nudge, since the next new test scans again. On the first run, with jscpd not yet in the cache, the gate starts the download in the background and skips that one scan instead of blocking on it.

A write counts as a new test when it lands on a file one pack's `duplication.tests` globs match and adds a test declaration. The scan covers only that pack's TDD-gated trees, under all of its roots, so the deny can word the way out in that pack's terms (Pull Up Method for Kotlin; a composable, component or `utils/` function for Vue). Duplication in another stack waits for that stack's next test.

The gate decides which clones are the branch's from git, not from jscpd's baseline. A clone counts when either copy overlaps a line the branch added or changed since its merge-base with origin's default branch (`origin/HEAD`, else `origin/main`). jscpd's `--baseline-from-ref` fingerprints a clone by its first and last lines, so renaming a class, moving a file or deleting one of three copies made an old clone look new. It also checked out the baseline into a temporary worktree on every new test, which ran the repo's checkout hooks each time. A project never has to state its default branch.

## Considered options

- **Fail closed, like the TDD gate.** The first-run download, a fresh clone with no `origin/HEAD`, or a slow scan would block every new test. That is a high price for a nudge the next test repeats.
- **A project install of jscpd**, as the originating project had. That forces a `package.json` on non-JS projects, and each project's version drifts.
- **Scan every stack on any new test.** That is stricter, but slower, and it puts another stack's advice into a cycle that can't act on it.
- **jscpd's `--baseline-from-ref`.** It is simpler, but fingerprinting by text misjudges moved and edited copies, and it compares with the default branch's tip rather than where the branch left it.
- **A configurable baseline ref.** `origin/HEAD` already names the default branch, so a config field would be one more thing to get wrong.
