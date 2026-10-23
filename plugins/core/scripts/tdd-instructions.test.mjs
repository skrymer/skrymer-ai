import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scopeObservedFailureToProductionWrites } from './tdd-instructions.mjs'

const LOOSE = `  - A test added to drive new behavior must be observed failing for
    the right reason (an assertion, not a syntax or import error) in
    a prior test run before production code may be written to satisfy
    it.`

test('the observed-failure rule is scoped to the production write, never the write adding the test', () => {
  // Given
  const defaults = `### Red phase\n${LOOSE}\n  - Another rule.`

  // When
  const instructions = scopeObservedFailureToProductionWrites(defaults)

  // Then
  assert.doesNotMatch(instructions, /A test added to drive new behavior must be observed failing/)
  assert.match(instructions, /This\n    gates the production write, never the write that adds the test/)
  assert.match(instructions, /^### Red phase\n[\s\S]*\n  - Another rule\.$/)
})

test('defaults without the loose wording pass through unchanged', () => {
  // Given
  const defaults = '### Red phase\n  - A rule upstream has reworded.'

  // When
  const instructions = scopeObservedFailureToProductionWrites(defaults)

  // Then
  assert.equal(instructions, defaults)
})
