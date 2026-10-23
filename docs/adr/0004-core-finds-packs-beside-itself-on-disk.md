# `core` finds the enabled packs beside its own install

Hook engines live in `core`, but each pack's default rule fragment (`skrymer-ai.pack.mjs`) ships in the pack's own plugin. Claude Code gives a hook only its own plugin's root, and it has no supported way to locate another plugin. So the config loader looks for each pack the project config names next to `core`. Loaded in place (this repo, or a marketplace added from a local directory), the plugins are siblings. Copied into the plugin cache, each plugin sits under `<marketplace>/<plugin>/<version>/`. The loader prefers the pack at core's own version, and otherwise the one installed most recently, since versions are commit SHAs and can't be ordered. That cache layout is documented, but it is not an API. If it changes, the gate reports "no such pack" to the user instead of silently doing nothing.

A file path that matches several rules needs every skill those rules name, with pack rules first and project rules after. A project adds rules on top of the stack conventions and never has to shadow them.

## Considered options

- **Copy every pack's fragment into `core`.** This is fully supported, but stack knowledge would then live in `core`, and every new pack would mean a `core` release.
- **Read `installed_plugins.json`.** It records each install path, but the docs describe it as a record, not an interface, and it is no more stable than the cache layout.
