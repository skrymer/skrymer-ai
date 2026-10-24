# skrymer-ai

A Claude Code plugin marketplace holding one AI-assisted development workflow, shared by every project that adopts it: test-first with an enforced TDD gate, decisions recorded as ADRs and a domain glossary, work planned as PRDs and vertical-slice issues, and a sign-off gate before anything is pushed.

## Plugins

| Plugin | What it gives a project |
|---|---|
| `core` | Process skills (tdd, grill-me, grill-with-docs, to-prd, to-issues, triage, handoff, diagnose, prototype, improve-codebase-architecture, check-adrs, feature-sign-off, mutation-test, write-a-skill, setup) and the hook engines (skill injection, skill gate, clone gate, gated-write guard, test-output guard, formatter, Probity TDD gate) |
| `kotlin-spring` | Kotlin / Spring Boot backend playbook, pitest, Detekt, Gradle conventions |
| `react` | React playbook, component testing, Stryker, ESLint/Prettier |
| `sindri` | Consumer guide for the Sindri component library (sourced from its own repo) |
| `web-e2e` | Browser walk-through verification, Playwright, MSW |
| `nuxt` | Nuxt / Vue playbook, component-testing conventions, Vitest paths, Prettier + ESLint formatter |

## Adopting it

Once per machine:

```
/plugin marketplace add skrymer/skrymer-ai
/plugin install core@skrymer-ai
```

Then in a project, run `/core:setup`. It detects the stacks, proposes the packs, and writes `.claude/settings.json`, `.claude/skrymer-ai.config.mjs` (the only project-specific config), git hooks, a CI template, and empty `CONTEXT.md` / `docs/adr/`. It is idempotent: re-running it adopts an existing repo, and `/core:setup --check` reports drift.

## Project config

```js
// .claude/skrymer-ai.config.mjs
import { defineConfig } from 'skrymer-ai'

export default defineConfig({
  stacks: { 'kotlin-spring': { roots: ['api'] } },
  tdd: { files: ['tools/**/*.kts'] },
  skills: {
    files: [{ id: 'billing', path: /api\/src\/.*\/billing\//, skills: ['billing-rules'], why: 'Money rounds one way.' }],
    prompts: [{ id: 'billing', pattern: /\binvoic\w*|\bbilling\b/i, skills: ['billing-rules'], why: 'Money rounds one way.' }],
  },
  tracker: { kind: 'github', labels: { 'needs-triage': 'triage' } },
  domain: { contexts: ['.'] },
})
```

`'skrymer-ai'` resolves to the plugin when a hook loads the file, so the project installs nothing. Each pack adds its stack's rules under every root it is given. Rule paths are matched against the file's path relative to the project root, and a file needs every skill whose rule it matches. If the config is invalid, the gates let writes through and tell you why.

### Skill reminders and session context

On each prompt, `core` reminds the session of the skills whose `skills.prompts` rules match it: the packs' rules first, then the project's, then `core`'s own process rules (tdd, grill-with-docs, write-a-skill, handoff). A skill named by several matching rules is one reminder carrying every reason, a skill the prompt already invokes is left out, and a prompt gets at most three. A project rule's `pattern` is a regex, used as written, or a string, matched case-insensitively; it can set `worktreeScoped: true` for a skill a worktree serves its own copy of.

At session start, `core` tells the session the issue tracker (`github` or `local`), the project's label for each triage role (`bug`, `enhancement`, `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`; each defaults to its own name) and the domain contexts, each a directory holding a `CONTEXT.md` and a `docs/adr/`. A config without `tracker` or `domain` gets GitHub and one context at the root; a project with no config gets no context block. A bad `tracker` or `domain` block only withholds this context, and the gates and reminders stay on.

### Formatter

After each Write or Edit, `core` formats the file with the formatter of the stack whose root holds it, running in that root so the root's own Prettier and ESLint configs apply. A pack gives its formatter as `format` groups (`nuxt`: Prettier then `eslint --fix` on script and Vue files, Prettier alone on JSON, CSS, Markdown and YAML, both through `pnpm exec`). A stack replaces its pack's groups with its own:

```js
stacks: { nuxt: { roots: ['web'], format: [{ files: ['**/*.{ts,vue}'], run: [['npx', 'biome', 'format', '--write']] }] } }
```

Each group whose `files` globs match the file's path relative to the root runs its `run` commands in turn, with the file's path appended. A command is a list of words and runs without a shell. Formatting is best-effort: a formatter that fails or isn't installed is skipped, and the write stands. A file outside every root is left alone.

### TDD gate

A write to a TDD-gated file is judged by [Probity](https://github.com/nizos/probity), which `core` runs through `npx` at a pinned version, so the project needs no Probity config or install. The gated trees are each pack's source globs under its roots (`kotlin-spring`: `<root>/src/**/*.kt`; `nuxt`: `<root>/app/**/*.{ts,vue}`, `<root>/server/**/*.ts` and `<root>/shared/**/*.ts`) plus the project's `tdd.files`. The list is positive, so build output and generated code stay ungated. Two Bash guards keep the gate whole: a shell command can't write a gated file, and a test run can't be piped through `grep`, `head` or `tail`. The first gated write downloads Probity, which takes about 20 seconds. To use a local install instead, set `SKRYMER_AI_PROBITY` to the command that runs it, for example `node_modules/.bin/probity`. If Probity can't run, or runs past the hook's timeout, a gated write is denied with the reason.

## Developing

`npm run check` runs the leak check and every hook test (`node --test`, no dependencies). The leak check fails the build when a term from `leak-denylist.txt` — a consuming project's name or domain — appears anywhere: everything here must be generic, and project specifics belong in the project's config.
