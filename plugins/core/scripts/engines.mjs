/**
 * The parsing of each mutation engine more than one pack runs, keyed by the `engine` a pack's
 * `mutation` block names. Core fills a pack's `targets`, `mutants` and `survivors` from here, and
 * a pack that gives its own keeps them (ADR 0010: the parsing is the engine's).
 */

/** Stryker's statuses for a mutant no test detected; Timeout counts as a kill. */
const UNDETECTED = new Set(['Survived', 'NoCoverage'])
/** Stryker's statuses for a mutant that never ran against the tests, so measured nothing. */
const INVALID = new Set(['CompileError', 'RuntimeError', 'Ignored'])
const REPLACEMENT_CAP = 80

let parsed = { json: null, mutants: [] }

/** Every mutant in a Stryker `mutation.json` [json], with the file it is in; the sweep counts and then lists them, so the last report is kept parsed. */
function strykerMutants(json) {
  if (parsed.json !== json) parsed = { json, mutants: Object.entries(JSON.parse(json).files).flatMap(([file, { mutants }]) => mutants.map((mutant) => ({ file, ...mutant }))) }
  return parsed.mutants
}

export const ENGINES = {
  stryker: {
    /** Each scoped file as its own `--mutate` pattern, its `[` escaped, as a route like `[slug]` is a glob class to Stryker. */
    targets: (files) => files.map((file) => file.replaceAll('[', '[[]')),
    /** The mutants that ran against the tests, detected or not. */
    mutants: (json) => strykerMutants(json).filter(({ status }) => !INVALID.has(status)).length,
    /**
     * Every mutant no test detected, keyed to the report's file (relative to the stack root, where
     * Stryker runs) and starting line. A replacement is folded onto one line and capped, so it
     * fits one row of the survivors file.
     */
    survivors: (json) =>
      strykerMutants(json)
        .filter(({ status }) => UNDETECTED.has(status))
        .map(({ file, location, mutatorName, replacement = '', status }) => ({
          file,
          line: location.start.line,
          mutator: mutatorName,
          replacement: oneLine(replacement),
          status,
        })),
  },
}

function oneLine(text) {
  const folded = text.replace(/\s+/g, ' ').trim()
  return folded.length > REPLACEMENT_CAP ? `${folded.slice(0, REPLACEMENT_CAP - 1)}…` : folded
}
