import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GATES } from '../plugins/core/scripts/config.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

test('the README’s sign-off diagram draws the selectable gates in core’s order', () => {
  // Given the sign-off diagram, the first mermaid block under its heading
  const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
  const diagram = /### The sign-off\n[\s\S]*?```mermaid\n([\s\S]*?)```/.exec(readme)?.[1] ?? ''

  // When its gate nodes are read in the order they are drawn
  const gates = [...diagram.matchAll(/\["([a-z-]+)<br\/>[^\]]*\]:::gate/g)].map((match) => match[1])

  // Then they are exactly core's gates, in core's order
  assert.deepEqual(gates, GATES)
})
