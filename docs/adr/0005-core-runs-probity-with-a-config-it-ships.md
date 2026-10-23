# `core` runs Probity with a config it ships, and decides what is gated itself

Probity loads its config through jiti, which resolves only `@nizos/probity` itself. A project `probity.config.ts` that re-exports from the project config can't resolve `'skrymer-ai'`, and only `core` can find the packs whose conventions name the gated trees. So the project has no Probity config at all. `core`'s TDD gate reads the merged config, and for a write to a gated file it runs `npx -y @nizos/probity@<exact version> --config <core>/scripts/probity.config.mjs`. That config applies `enforceTdd` to every write it is handed, because the gate has already decided the write is gated. A project installs nothing, so a Kotlin-only repo needs no `package.json`. The version is pinned exactly, so an upstream release reaches projects only through a `core` release. Probity's first run per version downloads it, which takes about 20 seconds. Ungated writes never start it.

The gated trees are a positive list: each pack names its source globs relative to a root (`kotlin-spring`: `src/**/*.kt`), they expand under every stack root, and a project can add globs of its own. Generated code and build output stay outside the list by construction, with no exclusion list to maintain. The gated-write guard reads the same list, so a shell command can't write a file the TDD gate would have judged.

A test run piped through `grep`, `head` or any `tail` is blocked. Gradle prints a failure's assertion well above its closing `FAILURE` block, so even a ten-line tail hides the one line the validator needs.

## Considered options

- **Fork Probity into `core`.** Probity depends on three agent SDKs and a native AST parser, which would break `core`'s "plain Node, no dependencies" rule. A fork would also have to re-apply every upstream fix to the validator prompts.
- **Generate a plain Probity config into the project at session start.** That works, but it leaves a generated file to gitignore or commit, and a second copy of the gated trees that can drift.
- **Keep the project's Probity config and its dev dependency.** That forces a `package.json` on non-JS projects, and the project's config would still need some way to reach the plugin's code.
