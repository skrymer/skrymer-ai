# `core` owns its process skills, forked once from an upstream set

`core`'s process skills (`tdd`, `grill-me`, `grill-with-docs`, `to-prd`, `to-issues`, `triage`, `handoff`, `diagnose`, `prototype`, `improve-codebase-architecture`, `write-a-skill`) are forked once from an MIT-licensed upstream set and then owned. They will diverge to fit this workflow, so no skill refers to, links to or tracks a skill in another repo. `THIRD-PARTY-NOTICES.md` carries the upstream copyright and licence, and it is the only place that names the upstream. The leak check enforces that.

References point from pack to `core`, never the other way. A `core` skill speaks of "your stack pack's playbook", and the stack-specific parts live in the packs: `kotlin-spring:backend-dev` maps each Detekt rule to a smell name in `core:tdd`'s refactoring guide. Adding a pack never means a `core` release.

Which issue tracker a project uses, its label for each triage role and where its domain docs live are project facts, so they sit in the project config as `tracker` and `domain`. A `SessionStart` hook turns them into a short context block naming the tracker, the label mapping and the domain contexts, and pointing at `core`'s reference file for that tracker and for reading domain docs. Skills read that block; hook engines read the config. A skill that finds no block tells the user to run `/core:setup`.

## Considered options

- **Depend on the upstream skills and patch around them.** Every upstream change would reach projects unreviewed, and a skill could not change to fit the TDD gate, the packs or the sign-off.
- **Per-project `docs/agents/` files for the tracker and domain layout**, as the upstream setup skill writes. That is a second source of project facts beside the config, and three files to keep in step in every project.
- **Inline the tracker conventions in the `SessionStart` block.** That spends about forty lines of context in every session, including the many that never touch the tracker.
