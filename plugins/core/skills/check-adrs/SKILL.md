---
name: check-adrs
description: Checks a change against the project's recorded decisions, meaning the ADRs and the CONTEXT.md glossaries the change's files put in scope. A fresh read-only agent extracts each normative constraint and gives it a PASS, FAIL or UNCERTAIN verdict citing both the doc line and the code. Use before opening a PR, as the check-adrs gate of feature-sign-off, or when the user asks to check a change against the ADRs, the glossary, CONTEXT.md or the design decisions.
---

# Check against recorded decisions

The project records its design in ADRs (`docs/adr/`) and its ubiquitous language in `CONTEXT.md`,
one of each per domain context. Tests check behaviour and code review checks correctness. This
checks that the change honours the decisions the project already made: an out-of-scope line
crossed, a rejected alternative quietly reintroduced, a boundary ruling broken, a domain term the
code spells differently from the glossary.

It reads and judges. It changes no code. The judging runs in the `check-adrs` agent, a fresh
read-only context, because the author of a change is the worst-placed reader of whether it drifted.

## Workflow

1. **Scope.** Run `node <base>/../../scripts/adr-scope.mjs` from the project root (`<base>` is this
   skill's base directory) and show its output. It measures the branch from its merge base with
   origin's default branch, committed and uncommitted, and prints each doc in scope with the
   changed files that selected it: the root `docs/adr/` always, and the `CONTEXT.md` and
   `docs/adr/` of each domain context holding a changed file. It names any doc a context should
   hold and doesn't, and ends with the pathspec for the doc-drift greps. A **STOP** means nothing
   was measured. Report it as printed and stop. It is not a pass.
2. **Spawn the `check-adrs` agent** (`subagent_type: core:check-adrs`), never a fork of this
   conversation, and before you read any ADR or glossary or grep for a term yourself. What you
   read first is what leaks into the brief. Its brief holds only:
   - the repo path, and the one command that shows the change (`git diff <base>`, or `git diff
     <base> <commit>` when a sign-off has committed);
   - the scope script's output, pasted whole;
   - the issue the change claims to deliver and how to read it (`gh issue view <n> --comments`, or
     the local file), or "none";
   - one line describing what the change does, in the code's own terms.

   Never name an ADR for it, give an example of a violation to look for, or say why a decision was
   made. Choosing which decisions apply is its job, and an example in the brief comes back as its
   first finding.
3. **Relay its report** as it returned it: FAILs, then UNCERTAINs, then the PASS summary. Don't
   soften a FAIL or upgrade an UNCERTAIN.

## Acting on a FAIL

A FAIL, or an UNCERTAIN saying a doc overstates the code, has exactly two remedies: fix the code,
or amend the doc in the same change. Offer both. Which one is the user's call. Never offer a third
resolution the cited doc rules out. When the doc changes, carry the user's ruling into it clause by
clause, and diff the amended sentence against the ruling before committing. Fix every drift hit
the agent listed in the same pass, not only the ADR.
