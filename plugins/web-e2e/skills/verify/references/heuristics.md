# Heuristics: attacks for exploratory charters on the web

The break-it tester's charters take their attacks from these families. Each move is something
`verify.mjs browser` or `verify.mjs api` can drive. Hostile data builds on
[probing.md](probing.md), which owns the input shapes. Its values are a charter's raw material
here, aimed at a risk rather than an AC.

## Interrupt

- Reload while a save is in flight: hold the request with `route`, reload, then read the record
  back over the API.
- Press Back after a submit, then submit again.
- Double-submit: click the committing control twice in quick succession, and press Enter twice
  in a form.
- Close the tab or navigate away mid-flow, then come back by URL.

## Concurrency

- Two tabs on one record: edit in both, save the first, then the second. Whose edit survives,
  and does the loser hear about it?
- Two users on one record: mint a second user (`verify.mjs api users 2`) and act as each, one in
  the browser and one over the API.
- A list changed underneath the page: add, remove or reorder over the API, then act on the stale
  row without reloading.

## Sequence

- Steps out of order: the last step of a wizard before the first, or a confirm before a review.
- A deep link into the middle of a flow, cold, in a fresh session.
- Repeat a one-time action: accept an invite twice, or redeem a code that was already used.

## Authority

- Another user's ID in the URL: sign the session in as a second user (`verify.mjs api users 2`
  mints one) and open the first user's record by its address. Where the screen can't send it,
  put the ID in an API path or body too (`verify.mjs api request … --as <other>`).
- An expired or missing session: clear the cookies mid-flow, then act.
- A role that shouldn't reach the action: drive the endpoint directly when the UI hides the
  button.

## Network

- Slow: hold a request with `route` and act while it hangs: click again, navigate, edit.
- Offline: abort every request with `route`, act, then restore and see whether the page recovers.
- A failure on the second of two calls: let the first through and fail the second, then look for
  a half-made record.

## Hostile data

- The shapes in [probing.md](probing.md), aimed at a risk: markup and script in a name that is
  later shown elsewhere, a value that breaks a URL or a CSV export, a size that breaks a layout
  on another screen.
- Data the screen didn't create: a record seeded over the API with the fields the form never
  sends, empty or extreme.

## Around the change

- Every other screen that shows what the changed code writes.
- Every other caller of a function or endpoint the diff changed.
- The states a changed conditional now reaches: its other branch, its empty case, and its error
  case.

## Driving them

Drive every charter as [driving.md](driving.md) says, the way the walk-through drives an AC,
and label every shim in the charter's note.
