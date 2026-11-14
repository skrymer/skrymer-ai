# StrykerJS: engine notes

`core:mutation-test` runs these through `mutation.mjs`. This page covers what the sweep
expects of the project, and the places Stryker is blind.

## What the sweep runs

By default it runs `pnpm exec stryker run --mutate <files> --reporters json,clear-text` in the
stack root and reads `reports/mutation/mutation.json`. The scope is the changed `.ts`, `.tsx`,
`.js` and `.jsx` files under `src/`, minus tests. A project on another package manager or
report path names its own in the config:
`stacks: { react: { roots: [...], mutation: { run: [...'{targets}'...], report } } }`.

The project's `stryker.config.json` needs:

```json
{
  "testRunner": "vitest",
  "plugins": ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
  "vitest": { "configFile": "vitest.config.ts" },
  "checkers": ["typescript"],
  "tsconfigFile": "tsconfig.app.json"
}
```

- **`plugins` must be listed explicitly.** pnpm's symlinked `node_modules` defeats Stryker's
  plugin discovery. Without the list you get "no TestRunner plugins were loaded".
- **The TypeScript checker is optional, and costs time.** It marks a mutant that doesn't type
  check as a CompileError instead of running the tests against it. Add
  `@stryker-mutator/typescript-checker` and point `tsconfigFile` at the tsconfig that includes
  `src/` (a Vite project's root tsconfig only holds references). If the sweep is too slow,
  drop it from `checkers` and `plugins` and drop `tsconfigFile`.
- **Start with Stryker's default concurrency**, and drop it if the machine swaps: each worker
  holds its own Vitest worker with a jsdom environment.

## Budget

Roughly a second per mutant with `vitest.related` scoping each mutant to its related tests.
A util is ~10–20 mutants and seconds. A component is tens of mutants. The whole surface is
many minutes, so always go through the scope.

## Gotchas

- **JSX mutates as code.** A conditional render (`{open && <Panel />}`) and a string literal
  in JSX are mutated, but markup and attributes mostly are not. A wrong class or a missing
  `aria-*` needs a component or e2e test.
- **A Timeout is a kill**, usually an infinite loop or an effect that re-renders forever, and
  the sweep counts it as detected.
- **A dependency array survives as an equivalent mutant more often than not.** `[]` versus
  `[a]` only differs when a test changes `a` after mount. A survivor there is a real gap when
  the effect must re-run, so drive the change with `rerender` or a user action.
- **No mutator flags a normalising call that isn't there.** `fold(a).includes(fold(b))` scores
  the same as `a.includes(fold(b))`, so 100% on a normalise-then-compare function means
  nothing. That covers case folding, accent stripping, trimming, unit conversion and key
  canonicalisation. Use a fixture whose *stored* side needs the transform. `toLowerCase` ↔
  `toUpperCase` swaps are not equivalent either: upper-casing maps "ß" to "SS".
- **There is no truthiness mutator.** `x == null ? a : b` scoring 100% says nothing about
  `x ? b : a`, which differs for `0`, `''` and `NaN`. A guard separating *absent* from *zero*
  needs an explicit zero case. In JSX the same gap renders a stray `0`: `{count && <Badge />}`.

## Re-running one line, and hand-mutating a copy

Re-run a survivor's line alone before triaging it, under the same cap the sweep uses (its log
prints the full command):
`systemd-run --user --scope -p MemoryMax=10G -- pnpm exec stryker run --mutate "src/utils/cart.ts:14-14"`. A scoped sweep can leave survivors
that a targeted re-run kills. `killedBy` in `mutation.json` says which test killed a mutant.
Check it for a mutant you wrote a test for, because a kill by an unrelated test can come from
state leaked between tests.

To settle a false survivor, copy the component and its test outside the gated `src/` tree,
for example into `mutant/` with a `vitest.config.ts` that includes it. Apply the one mutation,
and run `vitest --config` against it. Then delete the copy. An error thrown during render is
caught by the nearest error boundary, and one thrown in an event handler only reaches the
console, so assert the error state the user sees, or spy on `console.error` and assert nothing
arrived, or a green run proves nothing.

A copy of the whole root in a scratch directory, such as the one a sign-off's resolutions pass
is allowed, runs Vitest only with `node_modules` hard-linked (`cp -al`). A symlinked
`node_modules` can't resolve modules there.
