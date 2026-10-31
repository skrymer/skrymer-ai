# skrymer-ai

## Language

**Pack**:
A plugin for one technology stack (`kotlin-spring`, `react`, `nuxt`, …) layered on `core`. It carries that stack's playbook skills, its mutation engine and formatter, and **default rule fragments** — the stack's conventional paths and test commands — so a project only states its roots.
_Avoid_: putting a project's paths or domain rules in a pack.

**Project config**:
`.claude/skrymer-ai.config.mjs` in a consuming repo — the single place project specifics live: stack roots, TDD-gated trees, project skill rules (prompt patterns and file globs, each with a one-line *why*), and sign-off gate choices. Merged over the packs' defaults; validated at session start.
_Avoid_: editing plugin files to fit a project; a second source of the same paths (Probity takes its gated trees from it too).

**Hook engine**:
A `core` hook whose logic is generic and whose data (paths, patterns, rules) comes entirely from the merged packs + project config.

**Leak**:
Project-specific content (a project's name, domain, paths or rationale) inside skrymer-ai. Caught by the leak check in CI.

**Sign-off**:
The ordered pass a functionally complete change goes through before it is committed and pushed. Core fixes the order of the gates. A project selects which **gates** run but cannot reorder them, and cannot turn off the parts that keep a run honest: the adversary, the acceptance ledger, the resolutions pass and the retro.
_Avoid_: calling a single gate "the sign-off"; a project config that orders the gates.

**Gate**:
One selectable check in the sign-off (verify, simplify, mutation, code-review, check-adrs, security, language). An engine gate (mutation, verify) runs once per stack root whose pack provides that engine. Selecting it with no such pack is a config error.

**Survivors file**:
What a mutation sweep leaves for triage: one line per mutant no test detected, `file:line<TAB>mutator → replacement<TAB>status`, with no header, so its line count is the survivor count. One per stack, in the repo's git dir under `skrymer-ai/mutation/`, beside the sweep's log. The sign-off's pack lint counts verdict rows against it.
_Avoid_: copying survivors into a log by hand; a score in place of a verdict per line.

**Verify results file**:
What a verify walk-through (`/web-e2e:verify`) leaves for the AC coverage report: one row per acceptance criterion and target (a viewport on the web), `AC-<issue>.<n><TAB>target<TAB>status<TAB>screenshot<TAB>note`, with no header. The status is `pass`, `fail`, `blocked` or `not-visible`, and every status except `pass` carries a note. It lives in the repo's git dir under `skrymer-ai/verify/<issue>/`, beside the screenshots and the `head` the walk-through ran on.
_Avoid_: a prose verdict as the record; an AC with no row.
