# StrykerJS: engine notes

`core:mutation-test` runs these through `mutation.mjs`. This page covers what the sweep
expects of the project, and the places Stryker is blind.

## What the sweep runs

By default it runs `pnpm exec stryker run --mutate <files> --reporters json,clear-text` in the
stack root and reads `reports/mutation/mutation.json`. The scope is the changed `.ts` and `.vue`
files under `app/`, `server/` and `shared/`, minus tests. A project on another package manager
or report path names its own in the config:
`stacks: { nuxt: { roots: [...], mutation: { run: [...'{targets}'...], report } } }`.

The project's `stryker.config.json` needs:

```json
{
  "testRunner": "vitest",
  "plugins": ["@stryker-mutator/vitest-runner"],
  "vitest": { "configFile": "vitest.config.ts" },
  "ignorePatterns": ["!.nuxt", "/.nuxt/test", "/.nuxt/e2e", "/.nuxt/dev"],
  "concurrency": 1
}
```

- **`plugins` must be listed explicitly.** pnpm's symlinked `node_modules` defeats Stryker's
  plugin discovery. Without the list you get "no TestRunner plugins were loaded".
- **`!.nuxt` is required.** Stryker always ignores `.nuxt` and doesn't read `.gitignore`, so its
  sandbox loses Nuxt's generated tsconfig and every run crashes in the dry run. `!.nuxt`
  un-ignores the whole tree, so leftover Playwright builds (`.nuxt/test`, `.nuxt/e2e`) and a
  live `pnpm dev`'s `.nuxt/dev` are ignored again after it. Copied in, the first two can exhaust
  the parent's V8 heap before a single mutant runs, and the third changes under the copy.
- **`concurrency: 1` is not the slow option.** Each worker holds a Vitest worker with a Nuxt
  environment (~4 GB) on top of the parent (~2 GB). At 4 workers one project peaked at 21 GB
  of anonymous memory, and the workers thrashed so badly that a small sweep was faster at 1.
  `--max-old-space-size` for the runner changes nothing, so don't add it.

## Budget

Roughly 0.7–0.9 s per mutant with `vitest.related` scoping each mutant to its related tests. A
util is ~10–20 mutants and seconds. All of `app/utils/` is a couple of minutes. The whole surface
is many minutes, so always go through the scope.

## Gotchas

- **`.vue` mutates the `<script>` block only.** A template-only defect, such as a wrong class or
  a missing `v-if`, needs a component test.
- **A Timeout is a kill**, usually an infinite loop, and the sweep counts it as detected.
- **A whole `.vue` file can come back NoCoverage** although its test renders it. The cause is
  undiagnosed. Go straight to hand-mutating a copy rather than debugging the runner. A single
  Survived mutant whose only killer is a page test that mounts the component is false in the
  same way, because Stryker's related-test set can leave page tests out.
- **Put `// Stryker disable next-line all` on every compiler macro as it is written:**
  `defineProps`, `defineEmits` and `defineModel`. A mutated macro kills the run, and the symptom
  varies. It can be failing tests in the dry run, `stryMutAct_… is not defined`, "No tests were
  found", or a file that comes back entirely NoCoverage.
- **No mutator flags a normalising call that isn't there.** `fold(a).includes(fold(b))` scores
  the same as `a.includes(fold(b))`, so 100% on a normalise-then-compare function means
  nothing. That covers case folding, accent stripping, trimming, unit conversion and key
  canonicalisation. Use a fixture whose *stored* side needs the transform. `toLowerCase` ↔
  `toUpperCase` swaps are not equivalent either: upper-casing maps "ß" to "SS".
- **There is no truthiness mutator.** `x == null ? a : b` scoring 100% says nothing about
  `x ? b : a`, which differs for `0`, `''` and `NaN`. A guard separating *absent* from *zero*
  needs an explicit zero case.

## Re-running one line, and hand-mutating a copy

Re-run a survivor's line alone before triaging it, under the same cap the sweep uses (its log
prints the full command):
`systemd-run --user --scope -p MemoryMax=10G -- pnpm exec stryker run --mutate "app/utils/cart.ts:14-14"`. A scoped sweep can leave survivors
that a targeted re-run kills. `killedBy` in `mutation.json` says which test killed a mutant.
Check it for a mutant you wrote a test for, because a kill by an unrelated test can come from
state leaked between tests.

To settle a false survivor, copy the component and its test outside the gated `app/` tree,
for example into `mutant/` with a `vitest.config.ts` that includes it. Have the copy import its
siblings explicitly, apply the one mutation, and run `vitest --config` against it. Then delete
the copy. A mutant that throws inside a Vue event handler, watcher or render is swallowed by Vue.
Hook `useNuxtApp().hook('vue:error', …)` and assert nothing arrived, or a green run proves
nothing.

A copy of the whole root in a scratch directory, such as the one a sign-off's resolutions pass
is allowed, runs Vitest only with `node_modules` hard-linked (`cp -al`) and `nuxt prepare` run
in the copy. A symlinked `node_modules` can't resolve modules there.
