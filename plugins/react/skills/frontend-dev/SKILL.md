---
name: frontend-dev
description: The build-and-test playbook for a React frontend (Vite or similar, TypeScript). Use when building or changing ANY React functionality (a page, component, hook, util, or its tests). Sets the architecture rules, the styling rule, the test layers, the commands, the ESLint refactor moves and the known gotchas, and routes to `react:component-testing`, `core:tdd` and the feature-sign-off skill for detail.
---

# Frontend dev (React)

The playbook for any change under a `react` stack root. Read it first, build test-first, and
hand off to `feature-sign-off` at the end. It **links** the project's canonical docs
(`CONTEXT.md`, `docs/adr/`, a design doc if the project keeps one) and does not restate
them. A project's own domain rules live in its project skills, which the project config can
require alongside this one.

## Architecture rules

- **Present, don't compute.** Every derived number and domain verdict comes from the
  backend API. Never re-derive a domain rule in a component. Pure presentation helpers live in
  `src/utils/`, and components render the values the API sends.
- **Hooks own a concern.** Group each stateful concern into a named `useXxx()` in the same
  file as the component that uses it. Move it to `src/hooks/` only when a second consumer
  needs it. Cross-cutting mutation boilerplate (pending state, error feedback, retry) lives in
  one shared hook, never copied per call site.
- **Derive, don't sync.** A value computable from props or state is computed during render,
  never copied into state and kept in step by an effect. An effect is for synchronising with
  something outside React (a subscription, the DOM, a timer), and it cleans up after itself.
- **Server state lives in the data layer.** Fetch through the project's query library (or its
  equivalent), not `useEffect` + `useState`. It owns caching, dedupe, retries and staleness.
- **Forms validate with a schema.** Every form takes a schema (Zod or similar). It is the
  single source of truth for required fields, ranges and messages, and its inferred type
  drives the form state.
- **Errors persist and offer a retry; success is quiet.** A failed mutation surfaces an error
  the user can act on, centralised in the mutation hook, rather than a toast that fades before
  it is read. A render error is caught by an error boundary at the route, not left to blank the
  page.
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

- **Type**: the scale's tokens, never stock size and weight classes or a literal `font-size`.
- **Shape**: a card or inset takes the project's radius tokens, never a stock step or an
  arbitrary radius.
- **Colour**: the design system's colour roles and CSS variables, never hex, and never the
  only signal.
- **A value the scale lacks** becomes a token first, through the design doc.

Where the project has guard tests for its tokens, a red guard means the change broke the
rule. Go back to the token; don't loosen the guard.

## Test strategy: layers, test-first

| Layer                       | Tool · env                                         | Where                   | Skill                     |
| --------------------------- | -------------------------------------------------- | ----------------------- | ------------------------- |
| Pure presentation helpers   | Vitest · plain                                     | `src/utils/*.test.ts`   | `core:tdd`                |
| Components, hooks and pages | Vitest · jsdom + Testing Library                   | co-located `*.test.tsx` | `react:component-testing` |
| Rendered behaviour (mocked) | Playwright · desktop and mobile, the API mocked    | `e2e/*.spec.ts`         | the project's e2e skill   |
| Real-stack behaviour        | Playwright smokes against the real backend         | `e2e/smoke/`            | the project's e2e skill   |

- **Mock the API once.** The mocked layers share one typed handler set (MSW or similar): a
  baseline, overridden per test, with no assertions on the requests themselves. Assert what
  the user sees.
- One test at a time, RED first (`core:tdd`). A **deep module**, an interface worth
  specifying, gets its own test; thin glue is covered by the integrated or smoke test. An
  export from `src/utils/` that a second file calls gets its own test **in the cycle that
  exports it**. Added later, it passes on write, and its RED has to be shown on a mutant
  copy.
- **Changing what a shared formatter outputs moves tests in every layer.** Before the source
  edit, `git grep` the old wording's *pattern* across `src/`, `e2e/` and any aria snapshot
  baselines, and put every hit's new expectation into the RED. Once the source is green, the
  TDD gate refuses reverting it to show a missed test failing.
- Commands, run in the stack root: `pnpm test` (Vitest), `pnpm build` (the type check and the
  bundle), `pnpm lint`, and the e2e and smoke scripts, or the project's equivalents in
  `package.json`.

## Gotchas

- **The formatter rewrites between Edits.** `core` runs this pack's Prettier and
  `eslint --fix` after every Write or Edit under the root, so a `let` whose reassignment lands
  in a *later* Edit becomes `const` first (`prefer-const`), and an import used only by a
  later Edit can be dropped. Write a `let` and its reassignment, or an import and its first
  use, in one Edit.
- **`react-hooks/exhaustive-deps` is a correctness rule, not a style one.** Never silence it.
  A dependency you don't want is a sign the effect does too much: derive the value, move the
  function inside the effect, or reach for an event handler instead.
- **A `key` resets a subtree.** A `key` built from an index re-uses the wrong row's state on
  reorder, and a `key` that changes every render remounts the subtree and loses focus and
  input. Key by the item's identity.
- **A stale closure reads old state.** A callback created in one render sees that render's
  state, so a timer or a subscription set up once reads its first value forever. Use the
  functional updater (`setCount((c) => c + 1)`) or a ref for the latest value.
- **An object or function created in render is new every render.** Passed into a dependency
  list it re-runs the effect each render, and passed to a memoised child it defeats the memo.
  Hoist it, derive it, or memoise it where a profile shows it matters, not by reflex.
- **Attributes on a custom component go nowhere unless it forwards them.** An `aria-label` on
  a component that doesn't spread its props onto the element is inert. Before adopting a
  component library piece the app has not used, read its source for the roles and aria
  attributes it sets, and assert names with `toHaveAccessibleName` or an aria snapshot, never
  the attribute.
- **jsdom lays nothing out and computes no stylesheet.** A colour, an opacity, a size, a
  scroll position or a reveal delay is measured in the mocked e2e, not in Vitest. Poll colours
  (`expect.poll`), since a control with a colour transition reads an in-between value right
  after a click.
- **Keyboard and focus bugs inside a headless UI library may need Playwright.** A handler that
  awaits a microtask before checking `event.defaultPrevented` behaves differently in a browser
  than in jsdom, so a component test can pass code a browser breaks. Reproduce it in `e2e/`.
- **Proving a client sends its *local* day belongs in the mocked e2e.** Vitest runs in the
  host's zone and CI in UTC, so an assertion there passes code that sends the UTC date. Run
  the mocked browser in a fixed non-UTC zone, start the clock where the two days differ, and
  assert the product on screen.
- **A failed refetch can drop what the screen showed.** Check what the data layer hands back
  on error, and keep the last good value where losing it costs something.
- **Extract Component moves a lifetime, not just code.** State the moved code owns now lives
  and dies with the child's conditional render or `key`. Compare each piece against the parent
  before and after.
- **A fix that holds a control on another read creates a new stall.** Give that read a timeout
  and treat a timeout as a failed read that releases the control.
- **Per-project aria snapshots** (desktop and mobile): after an intended markup change,
  regenerate them and `git diff` the baselines to confirm only the intended tree moved.
  `toMatchAriaSnapshot` is a partial match, so open each baseline with
  `- /children: deep-equal` to say what is absent.

## Refactor step: the lint names the smell

When the project's ESLint config fails the build on size and complexity in `src/` (tests
exempt), each hit is a smell. Fix it with the catalog move that `core:tdd`'s refactoring guide
names for that smell, chosen to make the code read better. Never fix it by shaving lines or
with an `eslint-disable`. The commit names the move.

| Rule | Smell |
| --- | --- |
| `max-lines-per-function` | Long Function |
| `sonarjs/cognitive-complexity`, `max-depth`, `max-nested-callbacks`, `no-nested-ternary` | Nested conditionals |
| `max-params`, `react/jsx-max-depth` | Long Parameter List, deep nesting |
| `max-lines` | Large Class |
| `no-else-return`, `no-lonely-if`, `sonarjs/no-collapsible-if`, `sonarjs/prefer-single-boolean-return` | Nested conditionals (small) |
| `no-param-reassign` | Mutable Data |
| `no-useless-return`, `react/no-unused-prop-types`, `@typescript-eslint/no-unused-vars` | Dead Code |

How the moves land in React:

- **Large Class → Extract Component**, never a single-consumer hook moved to `src/hooks/` to
  save lines. Each hook goes with the one child that uses it and stays beside it.
- **Long Function → Extract Function.** A long component becomes smaller components and
  hooks, and a pure step becomes a module-level function. A hook's inner functions count
  toward its length, so a hook splits by concern.
- **Long Parameter List on a component** is a prop list that mixes concerns. Split the
  component, or pass children, before grouping props into an object.
- **A dialog owns the mutation it issues.** A page running every mutation for its dialogs is
  Feature Envy, and a callback threaded down through components that only pass it on is a
  Middle Man; move the work to where it is used, or use context for what truly is shared.

## Exit

When the change works and is tested, run **`feature-sign-off`** before committing. Its
mutation gate is **`core:mutation-test`**, which scopes StrykerJS to the files the change touched,
and every survivor gets a verdict. Stryker's config contract and blind spots are in
[references/stryker.md](references/stryker.md). A slice that also moved the backend runs the backend
pack's half of that gate in the same pass.
