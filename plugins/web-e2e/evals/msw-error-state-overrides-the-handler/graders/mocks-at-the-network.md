---
type: llm
focus: trace
---

The new test in src/profile-card.test.ts overrides the baseline for this one test with `server.use(...)`, answering `/api/users/me` with an error response (a 4xx or 5xx status, or a network error) through the handler set's `http`.
It leaves `test/mocks/handlers/` unchanged, so the baseline still answers every other test.
It doesn't mock `fetch`, `ofetch` or `src/api.ts`, and it doesn't assert on the request that was sent.
It asserts what the user sees: the alert's role or text.
Its Given, When and Then markers each carry a one-line description, as the existing test's do.
