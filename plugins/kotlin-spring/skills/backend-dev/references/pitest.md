# pitest: engine notes

`core:mutation-test` runs these through `mutation.mjs`. This page covers what the sweep
expects of the build, and the places pitest is blind.

## What the sweep runs

By default it runs `./gradlew mutationTest -PmutationTargets=<targets>` in the stack root and
reads `build/reports/pitest/mutations.xml`. The targets are worked out from each scoped file's
text, because a Kotlin file's declarations don't follow its name. Each top-level type `Foo` is
named as `Foo` plus `Foo$*`, which covers its companion and nested types. A bare `Foo*` would
also drag in every sibling whose name starts with `Foo`. The file's `…Kt` facade is named too,
for its top-level functions.

The Gradle plugin for pitest lags Gradle releases, so the task is a `JavaExec` against pitest's
own CLI:

```kotlin
val pitest: Configuration by configurations.creating
dependencies {
    "pitest"("org.pitest:pitest-command-line:<version>")
    "pitest"("org.pitest:pitest-junit5-plugin:<version>")
}

tasks.register<JavaExec>("mutationTest") {
    group = "verification"
    dependsOn("testClasses")
    classpath = pitest
    mainClass.set("org.pitest.mutationtest.commandline.MutationCoverageReport")
    val reportDir = layout.buildDirectory.dir("reports/pitest").get().asFile
    args(
        "--reportDir", reportDir.absolutePath,
        "--targetClasses", providers.gradleProperty("mutationTargets").get(),
        "--targetTests", "com.acme.*",
        "--excludedGroups", "e2e",
        "--excludedClasses", "com.acme.*\$\$inlined\$*",
        "--avoidCallsTo", "kotlin.jvm.internal.Intrinsics,java.util.logging,org.apache.log4j,org.slf4j,org.apache.commons.logging",
        "--sourceDirs", file("src/main/kotlin").absolutePath,
        "--classPath", sourceSets["test"].runtimeClasspath.joinToString(","),
        "--mutableCodePaths", sourceSets["main"].output.classesDirs.joinToString(","),
        "--outputFormats", "HTML,XML",
        "--timestampedReports", "false",
        "--threads", "1",
        "--jvmArgs", "-Xmx1g",
    )
    if (providers.gradleProperty("mutationFullMatrix").isPresent) args("--fullMutationMatrix", "true")
    maxHeapSize = "1g"
}
```

A project whose task differs names it in the config:
`stacks: { 'kotlin-spring': { roots: [...], mutation: { run: [...'{targets}'...], report } } }`.
Cap the heaps too: `org.gradle.jvmargs=-Xmx2g`, minions at `-Xmx1g` (unset, each inherits a
quarter of physical RAM), and the JavaExec parent at 1 GB. The sweep's systemd cap
(`memory`, 8G by default) is the backstop, not the budget.

## Budget

Each run spends a fixed ~10–15 s, because pitest runs the whole suite once for coverage before it
makes a single mutant. A small scope can't get below ~35 s, and there's nothing to tune. Past
that, cost follows what covers the class rather than how many mutants it has: about 0.8 s
per mutant for domain code, and ~1.6 s for anything a `@SpringBootTest` covers. A bare
`./gradlew mutationTest` sweeps everything and takes minutes, so always go through the scope.

## Gotchas

- **Keep the Kotlin noise filters.** pitest's own Kotlin junk filter (`FKOTLIN`) is on by
  default. Two gaps are closed by hand. One is `*$$inlined$*`, the classes the compiler emits
  for an inlined lambda. The other is calls to `kotlin.jvm.internal.Intrinsics`, the null
  assertion on every platform-type access. `--avoidCallsTo` **replaces** pitest's default list,
  so the logging frameworks are restated. Drop them and every deleted log line comes back as a
  survivor.
- **Generated code is excluded by output directory, not by name.** If jOOQ (or any generator)
  writes Java while hand-written code is Kotlin, pass only the Kotlin output to
  `--mutableCodePaths`.
- **`--threads 1` is on purpose.** If the tests share one database file, parallel minions
  contend for it and report mutants as killed by lock timeouts rather than by assertions.
- **A `ConditionalsBoundary` survivor in an `init` block is usually a real gap.** It means a
  `require(x > 0)` was relaxed to `>= 0` and no test builds the value exactly at the boundary.
- **Spring code that runs at context startup gives false survivors.** pitest picks which tests
  to re-run from line coverage. A `@Bean` method runs once, while the first test class builds
  the context, so pitest credits whichever test came first and never runs the tests that
  observe it. Security config, `@ConfigurationProperties` accessors and model converters can
  all score 0% while hand-deleting a line fails dozens of tests. Hand-mutate before you believe
  a 0%.
- **The caching wall isn't only Spring's.** Anything read only during serialisation or startup,
  such as a `@JsonValue` accessor or a converter behind a cached OpenAPI spec, can report
  NO_COVERAGE. Where the class holds real logic, test it directly without Spring, and then it
  becomes killable for real.
- **`mutations.xml` names one killing test per mutant.** Add `-PmutationFullMatrix` to the
  engine command when re-running by hand, and each mutant's `killingTests` then lists every
  test that kills it. The sweep is longer.
- **Exclude a class only when none of its mutants are visible**, and only after a
  hand-mutation proves the tests do catch it. A class where some mutants die stays in.
- **pitest never mutates a constant** (no `INLINE_CONSTS` by default). A tuning constant needs
  a test asserting the number it produces.
- **Nor a jOOQ predicate, a `java.time` guard, a builder argument, an annotation or SQL.** `le`
  versus `lt` is a call returning a `Condition`, and `isAfter` versus `isBefore` isn't a `<`.
  Pin each bound with a test at the boundary, a row dated exactly on it. Pin
  `@Transactional`, a migration term or an `insertInto(...).values(...)` argument by
  hand-ablation on a copy.

## Hand-mutating a copy

To settle a false survivor, copy the stack root into a scratch directory, with any sibling
directories its build reads symlinked beside it. Apply the one mutation there, `rm -rf build`
and run with `--no-build-cache`. A surviving `build/` or Gradle's shared cache replays the
unmutated result. Spell the copy's path literally, or put the mutation in a script file: the
write guard reads the command text and refuses a `src/main/…` path inside the project. Save the
copy's `diff -u` beside the red.
