# MSW for a GraphQL API

The rules in [SKILL.md](SKILL.md) are the same for GraphQL: one baseline, strict unhandled
requests, per-test `use()`, and no request assertions. The same `setupServer` and the same
Playwright `network` fixture serve `graphql.*` handlers. Only the points below differ.

## Handlers by operation

Group handlers by operation (`GetInvoices`, `MarkInvoicePaid`), one file per area of the
schema, and join them in the same baseline index as any REST handlers.

```ts
import { graphql, HttpResponse } from 'msw'
import { GetInvoicesDocument, MarkInvoicePaidDocument } from '../../src/gql/graphql'

export const invoiceHandlers = [
  graphql.query(GetInvoicesDocument, () => HttpResponse.json({ data: { invoices: baselineInvoices } })),
  graphql.mutation(MarkInvoicePaidDocument, ({ variables }) => /* keep it, answer the re-read */),
]
```

Scope a whole API with `graphql.link('https://api.acme.test/graphql')` when the app talks to
more than one endpoint.

## Typing

Pass the **typed document** that GraphQL Code Generator (`client-preset` or
`typed-document-node`) generates, as above. MSW then types `variables` and the `data` you
return, just as `openapi-msw` does for REST. A string operation name (`graphql.query('GetInvoices', …)`)
types nothing, so use it only when there's no codegen, and then type the generics yourself.

## Errors are data

A GraphQL error usually arrives as HTTP 200 with an `errors` array, not as a status:

```ts
server.use(
  graphql.query(GetInvoicesDocument, () =>
    HttpResponse.json({ errors: [{ message: 'Not authorised', extensions: { code: 'FORBIDDEN' } }] }),
  ),
)
```

Override with what the real server sends: a resolver error in `errors` (with partial `data`
if the schema allows it), or a transport failure (a 5xx or `HttpResponse.error()`) for an
outage. The page treats them differently, so test each one the page treats differently.

## Clients

The same rule holds for any client: never `vi.mock` Apollo's or urql's client, its hooks or
its link. A client cache outlives a test, so build a fresh client per test, or reset its
cache in `afterEach`, or an earlier test's answer will answer the next one.
