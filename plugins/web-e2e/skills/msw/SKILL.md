---
name: msw
description: The project's way of faking an HTTP API in tests, and the one to follow over general MSW knowledge. Use whenever a test needs a mocked, faked or stubbed API response, error (4xx/5xx), empty or slow state; when writing or editing a mock handler (for example under test/mocks/) or a test that overrides one; or when tempted to vi.mock fetch, $fetch, ofetch, axios, a GraphQL client or an API-client module, or to page.route an app endpoint. Covers one typed MSW 3 handler set shared by Vitest (msw/node), Playwright (@msw/playwright's network fixture) and opt-in dev-server mocking, strict unhandled requests and per-test use() overrides, for REST and GraphQL. Not for mocking timers, dates or non-HTTP modules.
---

# MSW

Every JS test that needs an HTTP dependency mocks it **at the network**, with
[MSW](https://mswjs.io/). Unit, component and e2e tests, and the dev server when it's asked
to, all answer from **one** handler set, so a mock written for a unit test also serves the
e2e walk-through. This skill targets **msw 3** and **@msw/playwright 0.x**. The library
names below are examples: use the project's own client, schema tooling and paths.

## Where things live

| What | Typical place |
| --- | --- |
| Typed `http` (from the API schema, when there is one) | `test/mocks/http.ts` |
| The baseline, one file per API resource, joined in an index | `test/mocks/handlers/<resource>.ts` |
| Vitest `server`, started by the test setup file | `test/mocks/node.ts` |
| Playwright `test` with the `network` fixture | `e2e/support/network.ts` |

Keep handlers outside the app's source tree (not under `src/` or `app/`), so the mutation
sweep and the TDD gate leave them alone. Follow the project's layout if it already has one.

## Quick start

```ts
// Vitest: the baseline already answers; override only what this test is about
import { http, HttpResponse } from 'msw'
import { server } from '../test/mocks/node'

it('says the invoices could not load', async () => {
  // Given the invoices API is down
  server.use(http.get('*/api/invoices', () => HttpResponse.json({ message: 'unavailable' }, { status: 503 })))
  // When … Then assert what the user sees
})
```

```ts
// Playwright: the suite's own test, whose network fixture serves the same handlers
test('shows the empty state', async ({ page, network }) => {
  network.use(http.get('*/api/invoices', () => HttpResponse.json([])))
})
```

Setup per runtime, typing and GraphQL: [REFERENCE.md](REFERENCE.md), [graphql.md](graphql.md).

## Rules

1. **Mock at the network, never the client.** No `vi.mock` / `vi.doMock` of `fetch`,
   `$fetch`, `ofetch`, axios, a GraphQL client or the project's own API module. No
   `page.route` for the app's API. `page.route` is only for third-party hosts MSW doesn't
   serve, such as a CDN or analytics. Where the Playwright skill reaches for `page.route`,
   this rule wins. The project's lint preset refuses both.
2. **Unhandled is a failure.** Start the server with `onUnhandledFrame: 'error'` (msw 2
   called it `onUnhandledRequest`). End the handler list with a terminal handler that fails
   any API request the handlers above it let fall through: msw counts a matched handler
   that returns nothing as handled and sends the request to the real network. Add the
   missing endpoint to the baseline instead of loosening the check.
3. **One baseline: a neutral, consistent user.** Extend it when a screen starts reading a
   new endpoint. Never bend it to suit one test, and never keep mutable state in it, since
   every test shares it.
4. **Override, don't redefine.** `use()` only the variation the test is about: an error, an
   empty list, a slow response. A handler returning `undefined` falls through, so scope an
   override by its params. A variation more than one layer needs is a factory beside the
   baseline, named in domain terms (`invoicesOverdue(3)`), never a copy per layer.
   Overrides last one test: `resetHandlers()` runs after each Vitest test, and the
   Playwright fixture is built per test.
5. **No request assertions.** Never capture a URL, query or body to assert on it. A handler
   answers correctly only when the request is right, and answers 400 otherwise, which the
   user meets as the error state. A mutation's handler keeps what it was sent, and the test
   asserts the screen after the re-read. A fixed reply proves nothing about what was sent.
6. **Type every response** from the API schema where one exists (`openapi-msw` for OpenAPI,
   typed documents for GraphQL), so a schema change breaks the mocks at compile time. Use an
   untyped response only for a status the schema doesn't declare, behind one named helper.
7. **A mock can't prove a backend decision.** If an assertion holds only because a handler
   encodes a business rule, the test proves the mock. Put that case in a backend test.
8. **A stateful handler stands in for the backend.** Before writing one, read the real
   endpoint: its status for a missing or foreign id, its refusals and the order it checks
   them in, its sort order. Copy a refusal's message as the backend words it, because the
   page shows it.

## Changing a handler

- Run the tests green, then break the handler's response once (on a copy) and check that
  the tests depending on it go red. A test no break turns red is reading something else.
- Before deleting a request count or an exact-payload assertion, name the client
  regression it caught, and check its replacement shows that regression on screen.

Traps measured so far, and how the fixtures work: [REFERENCE.md](REFERENCE.md).
