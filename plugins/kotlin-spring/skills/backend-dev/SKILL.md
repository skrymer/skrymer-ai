---
name: backend-dev
description: The build-and-test playbook for a Kotlin / Spring Boot backend. Use when building or changing ANY backend functionality (a domain type, service, repository, controller, migration, or its tests). Sets the architecture rules, the five test layers, the Gradle commands, the Detekt refactor moves and the known gotchas, and routes to the tdd, mutation-test and feature-sign-off skills for detail.
---

# Backend dev (Kotlin / Spring Boot)

The playbook for any change under a `kotlin-spring` stack root. Read it first, build
test-first, and hand off to `feature-sign-off` at the end. It **links** the project's
canonical docs (`CONTEXT.md`, `docs/adr/`) and does not restate them. A project's own
domain rules live in its project skills, which the project config can require alongside
this one.

## Architecture rules

- **Rich domain model.** Invariants live in the domain type, in an `init` block or a
  factory, and behaviour lives with the data it acts on. Services orchestrate across
  aggregates and are never the home of a rule. The domain layer stays free of persistence
  and Spring types; repositories map records to domain objects at the boundary.
- **Every derived value is computed in the backend.** Domain verdicts and derived state
  ship as plain API fields. A client presents them and re-derives nothing, so a new rule is
  a backend change first.
- **Speak `CONTEXT.md`.** It is the ubiquitous language. Domain code uses exactly its
  terms, and a change to the model updates it in the same commit.
- **A guard or a label reads a projection; a write reads the aggregate.** A read that only
  checks or names something selects those columns. A read that feeds a write loads the whole
  aggregate, so its invariants run. A guard built on aggregates fails on any malformed one,
  and turns a clean refusal into a 500. Two readers of one join share one private select, so
  the predicate and the ordering live once.
- **Scoping is implicit.** When rows belong to a user or tenant, no repository signature
  carries the owner's id. An injected current-owner bean reads it from the security context,
  so there is no id to pass wrongly. A foreign id answers **exactly** as an absent one, so
  the status code never becomes an existence oracle.
- **Time is a parameter.** Domain services take the date they act on as a required
  parameter, never defaulted to `LocalDate.now()`, so a missing one is a compile error.
  Where the server does need "now", it reads an injected `Clock`.
- **Absence on the wire is an explicit `null`.** A nullable DTO field is serialized as
  `null` and described as nullable in the OpenAPI spec, derived from the Kotlin type. Never
  hand-annotate it, and never suppress it with `@JsonInclude(NON_NULL)`.
- **Config that must be right has no default.** A value nobody can guess is better as a
  boot failure than as a wrong fallback. State it in every boot path you add.
- **Doc comments are brief, present-tense and non-obvious**, and never a changelog. A KDoc
  earns its place by saying what the signature doesn't.

## Test strategy: five layers, test-first

| Layer                    | Tool · env                                 | Package          |
| ------------------------ | ------------------------------------------ | ---------------- |
| Deep domain modules      | JUnit 5 + `kotlin.test`, no Spring         | `domain/`        |
| Domain services          | JUnit 5, real collaborators                | `service/`       |
| Persistence + migrations | `@SpringBootTest` + the real database      | `persistence/`   |
| API, security, wiring    | `@SpringBootTest` + MockMvc                | `api/`, `security/` |
| The deployable artifact  | Testcontainers against the built image     | `e2e/`           |

- One test at a time, RED first (the `tdd` skill). A **deep module**, meaning an interface
  worth specifying, gets its own test. **Thin glue is covered by the integrated test**: a
  delegating controller or scheduler wiring gets no standalone test, and mocking internal
  collaborators to give it one is the anti-pattern.
- **A rule no behaviour can break still gets a RED: make the rule executable.** Some rules
  hold whether or not a path can reach them (for example, "every scoped statement names the
  owner"). No test through a public interface fails on their absence, so the TDD gate
  rightly refuses the edit. Don't ask to have it waved through. Write a guard test that
  checks the rule itself, for example by recording the SQL the persistence layer executes
  and failing on a statement that breaks it. Extend an existing guard before writing a new
  one.
- **A controller change is not done until the spec is regenerated.** If the project
  snapshots its OpenAPI spec, the snapshot test names the regeneration commands.
- Gradle commands, run in the stack root: `./gradlew build` (compile, Detekt and the fast
  suite), `detekt`, and the project's e2e, OpenAPI and mutation tasks.

## Gotchas

- **A test that the code chose a value over the database's default must start where the
  two differ.** Left alone, the database often lands on the same value by itself, and the
  test passes with the code deleted. Insert a row between a colliding pair, or take one id
  you never use first, so the default and the chosen value disagree.
- **A test database that outlives the run is shared state.** An assertion on "the first"
  row depends on what ran before. Key it by table or name, and ablate a fix on a fresh
  build directory. A test that cannot be `@Transactional` cleans up its own rows in
  `finally`; run the suite twice on one database before committing it.
- **Pin the time zone in the test run** (`TZ=Etc/UTC ./gradlew build`) when any rule reads
  a calendar day. Otherwise the suite flakes in the window where the host's day and UTC's
  day disagree.
- **A green `./gradlew build` can be a cached one.** After a config or Spring-context
  change, re-run with `--rerun-tasks` before trusting it, because CI won't have the cache.
- **`src/test/resources/application.yml` shadows main entirely** in `@SpringBootTest`. It
  does not merge, so a new main-only key must be restated there or every context fails to
  load.
- **A test reading a repo file through `java.io.File` is invisible to Gradle.** Without an
  `inputs.file` on the test task, editing only that file leaves `:test` UP-TO-DATE and the
  test silently never runs.
- **Never edit an applied migration.** Its checksum changes and the next start refuses to
  run against an existing database. Repair the stored checksum rather than wiping data.
- **An owner-first composite index retires the single-column one.** Once `(owner_id, x)`
  exists, an index on `(x)` alone is write cost no scoped query reads. Drop it in a new
  migration in the same change, and confirm with the database's query plan.
- **Widening a constraint can mean rebuilding the table.** Ask whether everything that
  references the table can be rebuilt alongside it.
- **A rule that reads the client's day needs a test where the client's and server's days
  differ.** In MockMvc the two agree, so every other test passes whichever day the code
  resolved. Extending a rule to a sibling endpoint means porting each of the sibling's
  tests.
- **A refusal message is wire, and a spec snapshot cannot see it.** Retyping what a message
  interpolates changes its text: an enum renders `RECIPE`, a sealed class renders
  `Recipe(…)`. Before changing a type, grep for the messages that interpolate it and pin
  each one in its API test first. On a **new** endpoint, every refusal test asserts the
  message as well as the status.
- **An `ORDER BY` on a name a user typed sorts case-insensitively** (`lower(name)`). A
  test of "alphabetical" seeds a lowercase-initial name, or byte order passes it.
- **Detekt's `ReturnCount` allows 2.** A guard plus a match flattens to one elvis
  `?: return null` and a `return when (val x = …)`, not a nested `?.let`.

## Refactor step: Detekt names the smell

The project's `detekt.yml` fails `./gradlew build`. Run the type-resolving `detektMain` /
`detektTest`, because plain `detekt` misses the type-resolution rules. Each hit is a smell.
Fix it with the catalog move the `tdd` skill's refactoring guide names, chosen to make the
code read better. Never fix it by shaving lines, with `@Suppress`, or with a baseline. The
commit names the move.

| Rule | Smell |
| --- | --- |
| `LongMethod` (tests exempt) | Long Function |
| `CognitiveComplexMethod`, `NestedBlockDepth`, `ComplexCondition`, `NestedScopeFunctions`, `ReturnCount` (guard clauses exempt) | Nested conditionals |
| `LongParameterList` | Long Parameter List; on a constructor, a class with more than one job (Large Class) |
| `LargeClass` (tests exempt), `TooManyFunctions` | Large Class |
| `StringLiteralDuplication` | Duplicated Code |
| `DataClassShouldBeImmutable`, `VarCouldBeVal` | Mutable Data |
| `UnusedImports`, `UnusedPrivate*` | Dead Code |
| `UnnecessaryAbstractClass` | Shallow module: Replace Superclass with Delegate |
| `UnsafeCallOnNullableType` (`!!`), `UseRequireNotNull` | Make null impossible in the type, else Introduce Assertion. Detekt cannot see the same smell in a list index, `first()` or `last { }` that only a comment keeps safe, so build the value so it exists by construction |
| `UnnecessaryLet`, `UseOrEmpty` | Inline Function / Substitute Algorithm (the idiom) |

How the moves land:

- **A bean's collaborators → Extract Class.** Move the assembly into a service, so a
  controller reads HTTP → domain → HTTP. Keep each endpoint on its controller, because the
  spec's tags and operation ids come from it. **A controller's `@Transactional` must still
  cover every read left in the controller.** Pin it by recording the transaction each
  statement runs in and asserting there is one, keyed on the resources bound to it, never
  on its name.
- **Move a private class out to a public domain type, and it owes its own test in the same
  change.** The service tests that drove it while it was private are not its spec.
- **Introduce Parameter Object onto the domain value the group already is.** A fixture
  parameter no caller varies is Change Function Declaration, not an object.
- **A flat wire DTO** that no split can shorten is built by its own secondary constructor
  from the value it presents. Don't nest it, because nesting moves the wire.
- **Pin a refusal's wording in its API test before moving the code that renders it.**
- **A signature change under the TDD gate: callers first.** Update the test call sites, let
  the build go red on the compile, then change the declaration.

## Exit

When the change works and is tested, run **`feature-sign-off`** before committing. Its
mutation gate scopes pitest to the classes the change touched, and every survivor gets a
verdict.
