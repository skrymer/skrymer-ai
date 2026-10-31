# Briefs

Each judging agent's contract (its angles, rules of evidence and report shape) lives in its core
definition, so a brief carries only what changes per run. Fill every slot. Leave a slot "none"
rather than dropping it, and add nothing the contract in [SKILL.md](../SKILL.md) forbids. A brief
that departs from these slots says so, and why, in the pack.

Every brief opens with the same three slots:

```
Repo: <absolute path> (<a git worktree | the main checkout>; stay in it).
The change: cd <path> && git fetch -q origin && git diff <base> <commit>
What it does: <one or two sentences in the code's own terms; description, never assessment>
```

## code-reviewer

```
<the three opening slots>
Base: <base sha>. Commit: <commit sha>.
Start with: <the files the diff touches that matter most>. Read anything else you want.
```

## check-adrs

```
<the three opening slots>
Scope, as the scope script printed it:
<adr-scope.mjs output, whole>
The issue: gh issue view <n> --comments | <the local issue file> | none
```

## adversary

```
<the three opening slots>
The issue it claims to deliver: gh issue view <n> --comments | <the local issue file> | none
Its parent, where it has one: gh issue view <parent> --comments | none
Already read by other agents, so start here: <files>. Read anything else you want.
```

## acceptance-ledger

```
<the three opening slots>
The issue it claims to deliver: gh issue view <n> | <the local issue file> | none
(several issues: one line each)
Already read by other agents, so start here: <files>. Read anything else you want.
```

## resolutions

```
<the three opening slots, with <commit> the commit as it ships>
The resolutions pack: <path>
Transcripts: <every transcript path the run recorded, one per line, each with its agent>
Saved runs the pack cites: <path, with the HEAD and git status it was stamped with> | none
Scratch copy: you may copy the repo into <scratch dir> and run tests there | not allowed
```

## blind-arbiter

No diff, by design: the working tree is not evidence for either position.

```
Repo: <absolute path> (<a git worktree | the main checkout>; stay in it).
The question: <one question, phrased so both positions answer it>
Position 1: <the position and the evidence its agent cited, quoted from its transcript>
Position 2: <likewise>
```

A position carries what its agent cited, never your resolution row, and never a "for example"
that is one position's framing.

## verdict-auditor

```
<the three opening slots>
The verify results file: <path>, stamped at <the head file's commit>
Probe values the acceptance ledger named: <each MET (probe: …) row, quoted> | none
```

## retro-miner

```
Repo: <absolute path> (<a git worktree | the main checkout>; stay in it).
Base: <base sha>. The change as committed: git log --stat <base>..HEAD and git diff <base>..HEAD
Transcripts: <every transcript path the run recorded, one per line, each with its agent>
The resolutions pack: <path>
Memory index: <path to MEMORY.md> | none
```
