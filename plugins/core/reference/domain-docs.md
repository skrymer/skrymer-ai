# Domain Docs

How a skill reads this project's domain documentation while exploring the codebase. The session's skrymer-ai context lists the domain contexts: each is a directory holding a `CONTEXT.md` glossary and a `docs/adr/` of decisions.

## Before exploring, read these

- **`CONTEXT.md`** in each listed context that the topic touches. With one context, `.`, that is the root `CONTEXT.md`.
- **`CONTEXT-MAP.md`** at the repo root, when there are several contexts. It says how they relate.
- **`docs/adr/`** in each context the area touches, and the root `docs/adr/` for system-wide decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/core:grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

One context (most projects):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Several contexts (`domain.contexts: ['src/ordering', 'src/billing']`):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/core:grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
