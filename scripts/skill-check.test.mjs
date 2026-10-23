import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { findSkillProblems } from './skill-check.mjs'

test('a SKILL.md whose name differs from its directory is a problem', () => {
  // Given
  const files = [{ path: 'plugins/acme/skills/billing/SKILL.md', content: '---\nname: invoicing\ndescription: Bills.\n---\n' }]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, ['plugins/acme/skills/billing/SKILL.md: name "invoicing" should be "billing"'])
})

test('a relative markdown link to a file that does not exist is a problem, and one that does is not', () => {
  // Given
  const files = [
    { path: 'plugins/acme/skills/billing/SKILL.md', content: '---\nname: billing\n---\nSee [rounding](ROUNDING.md) and [tax](../tax/TAX.md).\n' },
    { path: 'plugins/acme/skills/billing/ROUNDING.md', content: 'Round half up. [Site](https://example.com) [Top](#top)\n' }
  ]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, ['plugins/acme/skills/billing/SKILL.md:4: link "../tax/TAX.md" points at no file'])
})

test('a link inside a fenced code block is an example, not a link', () => {
  // Given
  const files = [{ path: 'plugins/acme/skills/billing/SKILL.md', content: '---\nname: billing\n---\n```md\n[Globex](./src/globex/CONTEXT.md)\n```\n' }]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, [])
})

test('every skill shipped in this repo is named for its directory and links only to files that exist', () => {
  // Given
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'plugins'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((path) => ({ path, content: readFileSync(path, 'utf8') }))

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, [])
})
