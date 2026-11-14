---
name: component-testing
description: Vitest component and unit testing conventions for a React frontend, using Testing Library (`@testing-library/react` and `@testing-library/user-event`) with the `jest-dom` matchers. Use when writing or editing a Vitest test under a react stack root, or when deciding how to render, query or interact with a component or hook under test.
---

# Component testing

Vitest component and unit tests for a React frontend. Browser end-to-end tests are a separate
concern; `react:frontend-dev` places them in the test layers.

## Guiding principle

> The more your tests resemble the way your software is used, the more confidence they can
> give you.
> — <https://testing-library.com/docs/guiding-principles>

Test observable behaviour through the accessibility tree, never implementation details. A
good test survives any refactor that doesn't change what the user sees or does.

## Quick start

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrderSummary } from './OrderSummary'

describe('OrderSummary', () => {
  it('shows the items in the order against its limit', () => {
    render(<OrderSummary summary={summary} />)

    expect(screen.getByText('3 / 10 items')).toBeVisible()
  })
})
```

- Run Vitest with `environment: 'jsdom'` (or `happy-dom`) and register the `jest-dom`
  matchers (`toBeVisible`, `toHaveTextContent`, `toBeDisabled`, …) once, in the setup file,
  with `import '@testing-library/jest-dom/vitest'`.
- Testing Library unmounts between tests only when Vitest's `globals` is on. Without globals,
  call `cleanup()` in an `afterEach` in the setup file, or rendered trees leak into the next test.
- **Render through the app's providers.** A component that reads a router, a query client, a
  theme or a store needs them. Give the project one `renderWithProviders` (a custom `render`
  with a `wrapper`) and use it everywhere, never a provider tree rebuilt per test. Make a fresh
  query client per test, with retries off, so a cache doesn't carry across tests.
- Test a hook through a component that uses it. Reach for `renderHook` only for a hook that
  is itself a deep module, with an interface worth specifying.

## Query priority

Find elements the way a user or assistive technology would. Prefer, in order:

1. `getByRole` with `{ name }`: buttons, headings, inputs, links, regions
2. `getByLabelText` / `getByPlaceholderText`: form fields
3. `getByText`: non-interactive content
4. `getByTestId`: last resort, only when nothing above can address the element

`getBy*` throws when absent, `queryBy*` returns `null` (use it for "is not there"), and
`findBy*` is async (use it to wait for something to appear). Scope to a region with
`within(...)` rather than reaching for test ids.

## Interactions

Drive interaction with `@testing-library/user-event`, never `fireEvent`. It reproduces real
user behaviour: focus, key sequences, pointer events. Call `userEvent.setup()` once per test,
before rendering, and `await` every interaction.

## Async and `act`

- Testing Library wraps `render`, `user-event` and `findBy*` in `act` already. An "update …
  was not wrapped in act(...)" warning means an update landed after the test stopped waiting:
  wait for what it renders with `findBy*` or `waitFor`, never by wrapping more code in `act`.
- `waitFor` retries one assertion until it passes. Put a single expectation in it, and no side
  effects, since it runs many times.
- **With fake timers, hand them to user-event**:
  `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`, or every interaction hangs.

## Conventions

- Co-locate: `Foo.tsx` → `Foo.test.tsx` in the same directory.
- One behaviour per test, and the test name reads as a capability.
- Assert on what the user perceives: visible text, roles, accessible state.
- **For mutually exclusive states, also assert the alternatives are absent** (`queryBy*` +
  `.not.toBeInTheDocument()`). A positive-only check still passes if a regression renders two
  states at once.
- **Pin a time threshold on both sides**: at n − 1 it has not fired, at n it has. "Gave up by
  8 s" alone passes a 3 s timeout. For a timer started on mount, fake only `setTimeout` /
  `clearTimeout` before rendering and advance them by hand, not with `shouldAdvanceTime`,
  which leaks render time into the clock and flakes under load.
- **A "did not happen" assertion is only as late as the reaction it waits for.** When a change
  defers a reaction (a timer, a debounce, an effect), every test asserting that the reaction
  did *not* happen must let it run (`vi.useFakeTimers()` + `vi.runAllTimers()`) before
  asserting, or it passes whatever the code does. Re-audit those tests in the same change.
- **`rerender(<Foo … />)` keeps state**, since it is the same component instance. To test a
  fresh mount with other props, `unmount()` and `render` again, or put the state under test
  into the first render.
- **StrictMode runs effects twice in development.** Render under `<StrictMode>` in the shared
  wrapper, so a test catches an effect that doesn't clean up after itself.
- Fake the network at the network (MSW or the project's equivalent), never with `vi.mock` of
  the API client or `fetch`. Mock a module only for something the test can't drive, such as a
  browser API jsdom lacks.
- Never assert on CSS classes, DOM structure, component state or a hook's internals.
- After writing tests, run the suite (`pnpm test`) and only proceed when it is green.

## Anti-patterns

| Avoid                                                   | Use instead                                  |
| ------------------------------------------------------- | -------------------------------------------- |
| `getByTestId` for something with a role or visible text | `getByRole` / `getByText`                    |
| `fireEvent.click(el)`                                   | `await user.click(el)`                       |
| `container.querySelector(...)`                          | Testing Library queries                      |
| Wrapping code in `act` to silence a warning             | `findBy*` / `waitFor` on what it renders     |
| Asserting on classes or element structure               | Assert on visible text, roles, state         |
| Shallow rendering or Enzyme-style internals             | A full render with Testing Library           |
| Snapshot tests of rendered markup                       | Explicit behavioural assertions              |
