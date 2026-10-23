---
name: write-a-skill
description: Create or edit an agent skill with proper structure, progressive disclosure, and bundled resources. Use when user wants to create, write, build, or improve a skill.
---

# Writing Skills

A skill exists to make the agent take the same _process_ every run. [PRINCIPLES.md](PRINCIPLES.md) holds the levers for that (invocation, the description, the information hierarchy, splitting, pruning, leading words and failure modes), and [GLOSSARY.md](GLOSSARY.md) defines every **bold term** it uses. Read PRINCIPLES.md before drafting or reviewing a skill.

## Process

1. **Gather requirements** - ask user about:
   - What task/domain does the skill cover?
   - What specific use cases (**branches**) should it handle?
   - Must the agent or another skill reach it on its own (**model-invoked**), or does it only fire by hand (**user-invoked**)?
   - Does it need executable scripts or just instructions?
   - Any reference materials to include?

2. **Draft the skill** - create:
   - SKILL.md with concise instructions, each step ending on a checkable **completion criterion**
   - Reference files for what only some branches need
   - Utility scripts if deterministic operations needed

3. **Review with user** - present draft and ask:
   - Does this cover your use cases?
   - Anything missing or unclear?
   - Should any section be more/less detailed?

## Skill Structure

```
skill-name/
├── SKILL.md           # Main instructions (required)
├── REFERENCE.md       # Detailed docs (if needed)
├── EXAMPLES.md        # Usage examples (if needed)
└── scripts/           # Utility scripts (if needed)
    └── helper.js
```

A skill shipped in a plugin lives at `skills/<name>/SKILL.md` in the plugin and is invoked as `/<plugin>:<name>`. Refer to another plugin skill by that full name. A stack pack's skill may point at a `core` skill; a `core` skill points only at "your stack pack's playbook", never at a named pack.

## SKILL.md Template

```md
---
name: skill-name
description: Brief description of capability. Use when [specific triggers].
---

# Skill Name

## Quick start

[Minimal working example]

## Workflows

[Step-by-step processes with checklists for complex tasks]

## Advanced features

[Link to separate files: See [REFERENCE.md](REFERENCE.md)]
```

A user-invoked skill sets `disable-model-invocation: true`, and its description becomes a one-line summary for the human.

## Description Requirements

The description is **the only thing your agent sees** when deciding which skill to load. It sits in the system prompt alongside every other installed skill, every turn.

**Format**:

- Max 1024 chars
- Write in third person
- First sentence: what it does, front-loading the skill's **leading word**
- Second sentence: "Use when [specific triggers]", one trigger per **branch**

**Good example**:

```
Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when user mentions PDFs, forms, or document extraction.
```

**Bad example**:

```
Helps with documents.
```

The bad example gives your agent no way to distinguish this from other document skills.

## When to Add Scripts

Add utility scripts when:

- Operation is deterministic (validation, formatting)
- Same code would be generated repeatedly
- Errors need explicit handling

Scripts save tokens and improve reliability vs generated code.

## Review Checklist

After drafting, verify:

- [ ] Description includes triggers ("Use when..."), one per branch
- [ ] SKILL.md under 100 lines; what only some branches need sits behind a pointer
- [ ] Every step ends on a checkable completion criterion
- [ ] Each meaning has a **single source of truth**
- [ ] No **no-op** sentences, and target behaviour stated positively rather than by **negation**
- [ ] No time-sensitive info
- [ ] Consistent terminology
- [ ] Concrete examples included
- [ ] References one level deep
