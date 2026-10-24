---
name: frontend-dev
description: The build-and-test playbook for a Nuxt 4 / Vue frontend (with Nuxt UI). Use when building or changing ANY frontend functionality (a page, component, composable, util, server route, or its tests). Sets the architecture rules, the styling rule, the five test layers, the commands, the ESLint refactor moves and the known gotchas, and routes to `nuxt:component-testing`, `core:tdd` and the feature-sign-off skill for detail.
---

# Frontend dev (Nuxt / Vue)

The playbook for any change under a `nuxt` stack root. Read it first, build test-first, and
hand off to `feature-sign-off` at the end. It **links** the project's canonical docs
(`CONTEXT.md`, `docs/adr/`, a design doc if the project keeps one) and does not restate
them. A project's own domain rules live in its project skills, which the project config can
require alongside this one.

## Architecture rules

- **Present, don't compute.** Every derived number and domain verdict comes from the
  backend API. Never re-derive a domain rule in Vue. Pure presentation helpers live in
  `app/utils/` (auto-imported), and components render the values the API sends.
- **Inline composables.** Group each reactive concern into a named `useXxx()` in the same
  `.vue` file. Extract it to `app/composables/` only when a second consumer needs it.
  Cross-cutting mutation boilerplate (pending state, error feedback, retry) lives in one
  shared factory, never copied per call site.
- **Forms validate with a schema.** Every `<UForm>` takes a schema (Zod or similar). It is
  the single source of truth for required fields, ranges and messages, and its inferred type
  drives the form state.
- **Errors persist and offer a retry; success is quiet.** A failed mutation surfaces an error
  the user can act on, centralised in the mutation factory, rather than a toast that fades
  before it is read.
- **Style by token name.** Type, shape and colour come from named tokens, never a restated
  value. See [Styling](#styling-use-tokens-by-name).
- **Fetch through the generated client.** When the backend publishes an OpenAPI spec, call it
  through a client generated from that spec, and regenerate after a backend contract change
  rather than hand-writing a request type.
- **The client owns "today".** An endpoint that resolves a calendar day takes the user's local
  date from the client. The server's zone is not the user's.
- **Doc comments are brief, present-tense and non-obvious**, and never a changelog. A JSDoc
  earns its place by saying what the signature doesn't: a rule a reader would get wrong, a
  constraint, a unit. No caller inventory either: say *why* a helper is shared, and leave
  *who* to `git grep`.

## Styling: use tokens by name

Before styling a feature, read the project's design doc (its type scale, shape and colour
sections) and its rendered style guide page if it has one. The values and their reasons live
there and in the stylesheet only. This skill names the rule and never copies the values.

- **Type**: the scale's tokens (`text-h2`, `text-body`, …), never stock size and weight
  classes.
- **Shape**: a card or inset takes the project's radius tokens, never a stock `rounded-*`
  step or an arbitrary radius.
- **Colour**: the Nuxt UI colour roles and the `--ui-*` / `@theme` tokens, never hex, and
  never the only signal.
- **A value the scale lacks** becomes a token first, through the design doc.

Where the project has guard tests for its tokens, a red guard means the change broke the
rule. Go back to the token; don't loosen the guard.

## Test strategy: five layers, test-first

| Layer                       | Tool · env                                         | Where                   | Skill                     |
| --------------------------- | -------------------------------------------------- | ----------------------- | ------------------------- |
| Pure presentation helpers   | Vitest · env `nuxt`                                | `app/utils/*.test.ts`   | `core:tdd`                |
| Components and pages        | Vitest · `renderSuspended` + Testing Library       | co-located `*.test.ts`  | `nuxt:component-testing`  |
| Nitro server routes         | Vitest · plain, no Nuxt render                     | `server/**/*.test.ts`   | `core:tdd`                |
| Rendered behaviour (mocked) | Playwright · desktop and mobile, the API mocked    | `e2e/*.spec.ts`         | the project's e2e skill   |
| Real-stack behaviour        | Playwright smokes against the real backend         | `e2e/smoke/`            | the project's e2e skill   |

- **Mock the API once.** Both mocked layers share one typed handler set (MSW or similar): a
  baseline, overridden per test, with no assertions on the requests themselves. Assert what
  the user sees.
- One test at a time, RED first (`core:tdd`). A **deep module**, an interface worth
  specifying, gets its own test; thin glue is covered by the integrated or smoke test. An
  export from `app/utils/` that a second file calls gets its own test **in the cycle that
  exports it**. Added later, it passes on write, and its RED has to be shown on a mutant
  copy.
- **Changing what a shared formatter outputs moves tests in every layer.** Before the source
  edit, `git grep` the old wording's *pattern* across `app/`, `e2e/` and any aria snapshot
  baselines, and put every hit's new expectation into the RED. Once the source is green, the
  TDD gate refuses reverting it to show a missed test failing.
- Commands, run in the stack root: `pnpm test` (Vitest), the e2e and smoke scripts, `lint`
  and `format`, or the project's equivalents in `package.json`.

## Gotchas

- **The formatter rewrites between Edits.** `core` runs this pack's Prettier and
  `eslint --fix` after every Write or Edit under the root, so a `let` whose reassignment lands
  in a *later* Edit becomes `const` first (`prefer-const`), and the test fails with
  "Assignment to constant variable". Write a `let` and its reassignment in one Edit.
- **Auto-imports.** `app/utils/` and `app/composables/` auto-import. A util is addressed by
  its export name, not its path, so renaming the file is safe and renaming the export is not.
- **Attributes fall through to a component's root, which may carry no role.** Before adopting
  a Nuxt UI component the app has not used, read its source under
  `node_modules/@nuxt/ui/dist/runtime/components/` for the roles and aria attributes it sets.
  `UProgress` names its `role="progressbar"` from `:get-value-label`, and an `aria-label` lands
  on the role-less root, inert. It takes `:model-value`, clamped to `:max`; a `:value` is
  silently ignored and draws an indeterminate bar. `USlider`'s thumb is hardcoded to "Thumb"
  with no prop to change it: wrap it in a `role="group"` labelled by `aria-labelledby`.
  Assert names with `toHaveAccessibleName` or an aria snapshot, never the attribute.
- **`USkeleton` is a `role="alert"` with `aria-live`**, so every skeleton row announces.
  Put the rows in an `aria-hidden` wrapper and let the region's `aria-busy` say it is loading.
- **A toast's body has a hidden `aria-live` twin.** Assert it with
  `getByText(fullMessage, { exact: true })`.
- **`<Transition appear>` does not run for an element mounted inside a page's Suspense**, so
  a delayed reveal shows at full opacity from its first frame. Delay it with CSS instead.
- **Arrow keys are `.arrow-right` / `.arrow-left` in a Vue key modifier.** `.right` and
  `.left` are mouse buttons, and the handler silently never fires. In an async handler, read
  `event.currentTarget` before the first `await`; it is `null` once dispatch ends.
- **Keyboard bugs in a Reka component need Playwright.** Some Reka handlers `await nextTick()`
  and then check `event.defaultPrevented`. A browser runs a microtask checkpoint between
  listeners, so the check happens *before* an ancestor's bubbling `preventDefault`; happy-dom
  does not, so a component test passes code a browser breaks. Reproduce it in `e2e/`, and
  take the key in the capture phase (`@keydown.enter.capture`) to get ahead of Reka.
- **`UForm` validates input 300 ms late by default** (`validateOnInputDelay`). A form that
  submits on Enter, loses focus mid-request and empties on success then shows its own
  "required" error. `:validate-on-input-delay="0"` fixes it; happy-dom cannot see it, so the
  guard is an e2e with an instant mock.
- **`UInputMenu` clears its typed text 100 ms after its list closes**
  (`resetSearchTermOnBlur`), and with `create-item` it offers no Create item when an existing
  item matches ignoring case. An e2e holds the window with `page.clock`.
- **A colour, an opacity or a reveal delay is measured in the mocked e2e, not in Vitest.**
  happy-dom computes no stylesheet. Read a reveal's opacity at insertion (a
  `MutationObserver` in `addInitScript`), and poll colours (`expect.poll`), since a control
  with `transition-colors` reads an in-between value right after a click.
- **Proving a client sends its *local* day belongs in the mocked e2e.** Vitest runs in the
  host's zone and CI in UTC, so an assertion there passes code that sends the UTC date. Run
  the mocked browser in a fixed non-UTC zone, start the clock where the two days differ, and
  assert the product on screen. Use `setSystemTime`, not `setFixedTime`: a frozen `Date.now`
  stops `UInputNumber` committing what was typed.
- **Adding a query param breaks every `page.route` glob that ends at the path.** End route
  globs with `**`, and grep the e2e tree for routes on a path whenever its request gains a
  param. The failure shows as a timeout, not a routing error.
- **A token class in a Nuxt UI slot must be named in `ui.tv.twMergeConfig`.** tailwind-merge
  only knows Tailwind's stock names, so an `@theme` class sits *beside* the slot's stock class
  and CSS order picks the winner. Name it under `extend.theme`, and pin it by measuring the
  rendered component.
- **A guard that bans a class scans the whole SFC.** A static-`class` scan misses a bound
  `:class`, a `:ui` string and a script constant.
- **`truncate` does nothing on a heading styled with `text-wrap: balance` outside a layer.**
  An unlayered declaration beats every Tailwind utility. Measure the rendered height rather
  than trusting the class.
- **A failed `useAsyncData` refresh resets `data` to its default**, and everything derived
  from it goes too. Hold the last value where losing it costs something:
  `computed((last) => read ?? last)`.
- **Extract Component moves a lifetime, not just code.** What the moved code reads once, owns
  or emits after an `await` now lives and dies with the child's `v-if` or `:key`. Compare each
  against the parent before and after.
- **A fix that holds a control on another read creates a new stall.** Give that read a timeout
  and treat a timeout as a failed read that releases the control.
- **Pin a directly imported `reka-ui` to the version Nuxt UI resolves**, or the tree holds two
  copies of Reka. Bump the two together.
- **Per-project aria snapshots** (desktop and mobile): after an intended markup change,
  regenerate them and `git diff` the baselines to confirm only the intended tree moved.
  `toMatchAriaSnapshot` is a partial match, so open each baseline with
  `- /children: deep-equal` to say what is absent.

## Refactor step: the lint names the smell

When the project's `eslint.config.mjs` fails the build on size and complexity in `app/` and
`server/` (tests exempt), each hit is a smell. Fix it with the catalog move that `core:tdd`'s
refactoring guide names for that smell, chosen to make the code read better. Never fix it by
shaving lines or with an `eslint-disable`. The commit names the move.

| Rule | Smell |
| --- | --- |
| `max-lines-per-function` | Long Function |
| `sonarjs/cognitive-complexity`, `max-depth`, `max-nested-callbacks`, `no-nested-ternary` | Nested conditionals |
| `max-params`, `vue/max-props` | Long Parameter List |
| `max-lines`, `vue/max-lines-per-block`, `vue/max-template-depth` | Large Class |
| `no-else-return`, `no-lonely-if`, `sonarjs/no-collapsible-if`, `sonarjs/prefer-single-boolean-return` | Nested conditionals (small) |
| `no-param-reassign` | Mutable Data |
| `no-useless-return`, `vue/no-unused-properties`, `vue/no-unused-refs`, `vue/no-unused-emit-declarations` | Dead Code |

How the moves land in Vue:

- **Large Class → Extract Component**, never a single-consumer composable moved to
  `app/composables/` to save lines. Each composable goes with the one child that uses it and
  stays inline there.
- **Long Function → Extract Function.** A long `useXxx()` becomes smaller inline ones, and a
  pure step becomes a module-level function. A composable's inner functions count toward its
  length, so a factory splits by concern.
- **A sheet or dialog owns the mutation it issues.** A page running every mutation for its
  overlays is Feature Envy, and an event relayed up through parents that only pass it on is a
  Middle Man.
- `vue/max-lines-per-block` counts comments. When it fires on a well-commented file, the
  answer is still a component boundary, not fewer comments.

## Exit

When the change works and is tested, run **`feature-sign-off`** before committing. Its
mutation gate scopes the project's mutation tool (StrykerJS) to the files the change touched,
and every survivor gets a verdict. A slice that also moved the backend runs the backend
pack's half of that gate in the same pass.
