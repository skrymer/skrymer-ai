# Sign-off report

The summary the sign-off ends with, for the user and the PR reviewer to replay. One line per gate,
in core's order, with the agents under the step that launched them. A gate the project didn't
select says so. Figures are the saved output's own counts.

```
## Feature sign-off: <change or issue>

check          ✅ kotlin-spring (api), nuxt (web) built and tested before any agent
simplify       ✅ 1 cleanup applied (one formatter for both totals)
mutation       ⚠️ nuxt (web): 29 mutants, 27 detected → 1 real gap (test added), 1 equivalent
code-review    ⚠️ 2 findings → both fixed; 1 dismissed (ADR 0004, quoted in the pack)
  adversary    ✅ SHOULD MERGE; closest attack: "unreachable from the UI" (the cart posts it)
  acceptance   ⚠️ 6 criteria: 4 MET (AC-3 by probe → verify) · 1 PARTIAL → fixed · 1 MISSING → test added
  arbiter      not spawned (no split)
check-adrs     ⚠️ 1 FAIL → CONTEXT.md amended (the user's call); drift fixed in README.md
resolutions    ⚠️ 9 rows: 8 upheld, 1 dismissal rejected ("pre-existing": the diff moved the line) → fixed
               pack faithful to 5 transcripts; briefs clean
verify         ✅ desktop + phone: qty 0 ✅ · qty 999 ✅ · AC-3 probe "Ünïcode name" ✅
  break-it     ⚠️ 4 charters: 3 pass · EX-12.2 fail (double-click on Place order: 2 orders) → fixed red-first
               EX-12.4 fail (cart edited in two tabs: last save wins silently) → the user's call, now AC-7
  verdict      ⚠️ 1 UNCOVERED (empty cart) → driven ✅
resolutions′   not re-run (verify changed no code)

check green again. Committed and pushed to <branch>.
retro          2 lessons → nuxt engine notes (Stryker skips templates), 1 memory entry
```

A gate not selected reads `<gate>  not selected`. A SKIPPED ledger reads
`acceptance  SKIPPED (the issue states no criteria)`.
