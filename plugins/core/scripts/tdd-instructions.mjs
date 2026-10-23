/**
 * Probity's default rule that gates production code on an observed failing test is worded
 * loosely enough that the validator applies it to the write adding the test, and refuses a
 * red step for not having failed before it exists (nizos/probity#51). This is the wording of
 * the upstream fix, nizos/probity#52; drop it once a release ships that fix. If the text it
 * replaces is gone, the defaults pass through unchanged.
 */
const OBSERVED_FAILURE_RULE = {
  loose: `  - A test added to drive new behavior must be observed failing for
    the right reason (an assertion, not a syntax or import error) in
    a prior test run before production code may be written to satisfy
    it.`,
  scoped: `  - Production code that satisfies a new test may not be written until
    that test has been observed failing for the right reason (an
    assertion, not a syntax or import error) in a prior test run. This
    gates the production write, never the write that adds the test: a
    test cannot fail before it exists, so "no failing run yet" is never
    a reason to block adding one.`,
}

export const scopeObservedFailureToProductionWrites = (defaults) =>
  defaults.replace(OBSERVED_FAILURE_RULE.loose, OBSERVED_FAILURE_RULE.scoped)
