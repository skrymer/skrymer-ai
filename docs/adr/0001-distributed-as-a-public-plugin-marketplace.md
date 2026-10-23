# Distributed as a public Claude Code plugin marketplace, guarded by a leak check

The workflow began inside one project and was then copy-ported into another, where the copy started drifting within days — every hook and most skills diverged only in paths, file extensions and stack wording. It is now one repo that projects consume as a **Claude Code plugin marketplace**: projects opt in through committed `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`), nothing is copied, and updates are pulled, not re-ported.

The repo is **public**: a private marketplace needs a non-prompting git credential helper on every machine, cloud session and CI runner, and nothing in it should be sensitive by design. The risk public brings — project specifics leaking in while generalising existing skills — is closed by a **leak check** in CI that fails on any term from `leak-denylist.txt`.

## Considered options

- **Git submodule** — works, but submodule ergonomics and brittle hook paths.
- **Copy/sync CLI** (lockfile-style) — copies drift unless re-synced: the original problem with tooling around it.
- **Private repo** — credential friction everywhere, for content that is generic by construction.
