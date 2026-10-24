---
name: component-testing
description: Vitest component and unit testing conventions for a Nuxt / Vue frontend, using Testing Library (`@testing-library/vue` and `@testing-library/user-event`) rendered through `@nuxt/test-utils`' `renderSuspended`. Use when writing or editing a Vitest test under a nuxt stack root, or when deciding how to render, query or interact with a component under test.
---

# Component testing

Vitest component and unit tests for a Nuxt frontend. Browser end-to-end tests are a separate
concern; `nuxt:frontend-dev` places them in the test layers.

## Guiding principle

> The more your tests resemble the way your software is used, the more confidence they can
> give you.
> — <https://testing-library.com/docs/guiding-principles>

Test observable behaviour through the accessibility tree, never implementation details. A
good test survives any refactor that doesn't change what the user sees or does.

## Quick start

```ts
import { describe, expect, it } from 'vitest'
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import OrderSummary from './OrderSummary.vue'

describe('OrderSummary', () => {
  it('shows the items in the order against its limit', async () => {
    await renderSuspended(OrderSummary, { props: { summary } })

    expect(screen.getByText('3 / 10 items')).toBeVisible()
  })
})
```

- `renderSuspended` (from `@nuxt/test-utils/runtime`) renders with the full Nuxt context:
  auto-imports, `NuxtLink`, Nuxt UI and `#imports`. Use it, not `@testing-library/vue`'s
  bare `render`.
- Register the `jest-dom` matchers (`toBeVisible`, `toHaveTextContent`, `toBeDisabled`, …)
  once, in the Vitest setup file.
- Stub an auto-import with `mockNuxtImport`, never with `vi.mock` on a path.

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
user behaviour: focus, key sequences, pointer events. Call `userEvent.setup()` once per test
and `await` every interaction.

## Conventions

- Co-locate: `Foo.vue` → `Foo.test.ts` in the same directory.
- One behaviour per test, and the test name reads as a capability.
- Assert on what the user perceives: visible text, roles, accessible state.
- **For mutually exclusive states, also assert the alternatives are absent** (`queryBy*` +
  `.not.toBeInTheDocument()`). A positive-only check still passes if a regression renders two
  states at once.
- **Pin a time threshold on both sides**: at n − 1 it has not fired, at n it has. "Gave up by
  8 s" alone passes a 3 s timeout. For a timer started at mount, fake only `setTimeout` /
  `clearTimeout` before rendering and advance them by hand, not with `shouldAdvanceTime`,
  which leaks render time into the clock and flakes under load.
- **A "did not happen" assertion is only as late as the reaction it waits for.** When a change
  defers a reaction (a timer, a debounce, a `nextTick`), every test asserting that the
  reaction did *not* happen must let it run (`vi.useFakeTimers()` + `vi.runAllTimers()`)
  before asserting, or it passes whatever the code does. Re-audit those tests in the same
  change. The same goes for a read moved out of awaited setup (`void load()`):
  `renderSuspended` now returns before the answer, so each test must wait for text only the
  answer renders.
- **A test that fakes the clock and submits a number input** needs
  `vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })`. Faked timers, or a `Date`
  that does not tick, leave the submit with no calls.
- **A toast never renders under `renderSuspended`**, which mounts no toaster. Mock `useToast`
  with `mockNuxtImport` and assert what `add` is handed: the title and description are the
  words the user reads.
- **`rerender({...})` re-runs a prop watcher even when the prop is the same object**, so state a
  `watch` resets is reset by the rerender, not by anything a user did. Put the state under
  test into the first render instead.
- **An overlay's autofocus takes back a `.focus()` set during the render.** To start a keyboard
  test on a control inside one, `await user.click()` it.
- **Drive a slider by keyboard**: `slider.focus()` + `user.keyboard('{ArrowRight>20/}')`, and
  assert `aria-valuenow`. It works without track geometry, which happy-dom lacks.
- Never assert on CSS classes, DOM structure, `wrapper.vm` or emitted internals.
- After writing tests, run the suite (`pnpm test`) and only proceed when it is green.

## Anti-patterns

| Avoid                                                   | Use instead                                  |
| ------------------------------------------------------- | -------------------------------------------- |
| `getByTestId` for something with a role or visible text | `getByRole` / `getByText`                    |
| `fireEvent.click(el)`                                   | `await user.click(el)`                       |
| Asserting on classes or element structure               | Assert on visible text, roles, state         |
| `@vue/test-utils` low-level APIs (`find`, `.vm`)        | Testing Library queries                      |
| Snapshot tests of rendered markup                       | Explicit behavioural assertions              |
