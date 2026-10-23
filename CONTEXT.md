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
