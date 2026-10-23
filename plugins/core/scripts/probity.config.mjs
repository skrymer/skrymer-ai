/**
 * The Probity config the TDD gate runs Probity with. The gate hands Probity only writes to
 * gated files, so `enforceTdd` applies to every write it sees. Loaded by Probity's own
 * loader, which resolves `@nizos/probity` to itself.
 *
 * The validator sees only the last `maxEvents` tool calls, so a red run has to stay inside
 * that window, not merely have happened. Every Read, Grep and subagent report takes a slot,
 * and once the run is pushed out the validator refuses a legitimate red, then the production
 * write too. Twenty leaves about one TDD cycle of interleaved reads as headroom. Going higher
 * crowds the prompt, and the validator then misses recent events, which fails as a false pass.
 * Gradle and Vitest runs are verbose, and the assertion line the validator needs sits deep
 * in them; the default 6000 characters truncate a failing Gradle run before it.
 */
import { enforceTdd } from '@nizos/probity'
import { scopeObservedFailureToProductionWrites } from './tdd-instructions.mjs'

export default {
  rules: [
    enforceTdd({
      maxEvents: 20,
      maxContentChars: 10000,
      instructions: scopeObservedFailureToProductionWrites,
    }),
  ],
}
