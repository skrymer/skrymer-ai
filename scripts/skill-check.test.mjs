import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findSkillProblems } from './skill-check.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

test('a SKILL.md whose name differs from its directory is a problem', () => {
  // Given
  const files = [{ path: 'plugins/acme/skills/billing/SKILL.md', content: '---\nname: invoicing\ndescription: Bills.\n---\n' }]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, ['plugins/acme/skills/billing/SKILL.md: name "invoicing" should be "billing"'])
})

test('the name is read from the frontmatter only, with its quotes stripped', () => {
  // Given
  const files = [{ path: 'plugins/acme/skills/billing/SKILL.md', content: '---\nname: "billing"\n---\nname: invoicing\n' }]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, [])
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

test('a link inside an inline code span is an example, and a link to a directory resolves when the directory holds a file', () => {
  // Given
  const files = [
    { path: 'plugins/acme/skills/billing/SKILL.md', content: '---\nname: billing\n---\nWrite `[Globex](./CONTEXT.md)`. Scripts in [scripts](scripts/).\n' },
    { path: 'plugins/acme/skills/billing/scripts/round.sh', content: 'echo' }
  ]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, [])
})

test('a four-backtick fence holding a three-backtick block stays an example to its own closing fence, as does a tilde fence', () => {
  // Given
  const example = '````md\n```\ncode\n```\n[Ref](REFERENCE.md)\n````\n~~~\n[Ref](REFERENCE.md)\n~~~\n'
  const files = [{ path: 'plugins/acme/skills/billing/SKILL.md', content: `---\nname: billing\n---\n${example}[Gone](GONE.md)\n` }]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, ['plugins/acme/skills/billing/SKILL.md:13: link "GONE.md" points at no file'])
})

test('links in a plugin reference file are checked too, and a root-absolute link is left alone', () => {
  // Given
  const files = [{ path: 'plugins/acme/reference/tracker.md', content: 'See [docs](/docs/adr/) and [labels](LABELS.md).\n' }]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, ['plugins/acme/reference/tracker.md:1: link "LABELS.md" points at no file'])
})

test('every skill shipped in this repo is named for its directory and links only to files that exist', () => {
  // Given
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'plugins'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path && existsSync(join(REPO, path)))
    .map((path) => ({ path, content: readFileSync(join(REPO, path), 'utf8') }))

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, [])
})
