# Core plus stack packs, driven by one project config file

The workflow splits into a stack-agnostic **`core`** plugin (process skills + hook engines) and one **pack** per stack (`kotlin-spring`, `react`, `web-e2e`, `nuxt`, and `sindri`, which is listed here but sourced from the Sindri repo so its guide versions with its components). A project enables only the packs it uses, so no skill it can't use is loaded or injected.

Everything project-specific lives in **`.claude/skrymer-ai.config.mjs`** — an ES module, not JSON, because the rules are regexes and each carries a one-line *why*. Hook engines derive every path from its stack roots plus the packs' default rule fragments, the TDD-gated trees Probity judges included ([0005](0005-core-runs-probity-with-a-config-it-ships.md)), so there is one source of truth. The plugin validates it at session start so a typo cannot silently disable a gate.

## Considered options

- **One plugin with every stack inside, switched by config** — simpler to publish, but every project loads and is nudged toward skills it can't use.
- **Nuxt guidance left project-local** — rejected; existing Nuxt projects get the same split as new ones.
