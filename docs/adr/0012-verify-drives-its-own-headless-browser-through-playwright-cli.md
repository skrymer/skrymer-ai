# Verify drives its own headless browser through playwright-cli

`/web-e2e:verify` walks the app through `playwright-cli` (`@playwright/cli`), run through a pinned `npx`, as the jscpd and Probity runs are ([0008](0008-the-duplication-gate-fails-open-and-runs-jscpd-through-a-pinned-npx.md)). It has no other driver and no fallback. The walk-through it was ported from drove the developer's own Chrome through the `claude-in-chrome` extension, which kept needing a person: Chrome was not connected, a window resize reported success without moving, and a maximized window could not be restored, so a gate meant to run unattended stopped until someone fixed it by hand.

`playwright-cli` starts its own Chromium, headless unless a person asks for `--headed`, and opens one session per target in the stack's `verify.targets`. A target's viewport, device scale and touch are emulated, so there is no window for anyone to fix. The agent drives the CLI from Bash: a snapshot gives element refs, then commands act on them and take screenshots. A CLI also costs no always-on context, while an MCP server's tool schemas sit in every session. And every project the web-e2e pack serves already runs Playwright.

Each walk of an AC on a target also records the console errors and the failed first-party requests. An uncaught error or a 5xx during the walk-through makes that row a `fail` with a note, even when the screen looked right. At every target, scripted checks look for page overflow, overlapping interactive elements, controls offscreen or under a fixed header, tap targets under 44px and focus that can't be seen. The screenshots catch gross layout faults. Subtle visual regressions are left to `toHaveScreenshot` in e2e specs.

The phone target is emulated Chromium, not a phone. It doesn't show iOS Safari's quirks, safe-area insets, the virtual keyboard or a device's CPU. The old driver was desktop Chrome resized to a phone's width, so it was no closer. The walk-through signs in as a disposable test user, so it never needs the developer's profile. Deep performance profiling is not verify's job either, since dev-server timings on a developer's machine show nothing about production.

## Considered options

- **Keep `claude-in-chrome`, with Playwright as a fallback.** This is what failed: the main path needed a person, and every verdict had to say which driver produced it.
- **`@playwright/mcp`.** It is the same engine, but its tool schemas cost context in every session, and setup would have to write `.mcp.json`.
- **`chrome-devtools-mcp`.** It is stronger for performance traces, but it is Chromium only, and it is MCP again.
- **A throwaway Playwright spec per AC.** It is deterministic and can be replayed, but it is poor for the exploratory probing that earns the gate.
