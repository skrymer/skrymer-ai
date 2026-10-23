import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findLeaks, checkRepo } from './leak-check.mjs'

test('reports a denylisted project name with its file and line', () => {
  // Given
  const files = [{ path: 'plugins/core/skills/tdd/SKILL.md', content: 'Intro\nAs Acme does it.\n' }]

  // When
  const leaks = findLeaks(files, ['acme'])

  // Then
  assert.deepEqual(leaks, [{ path: 'plugins/core/skills/tdd/SKILL.md', line: 2, term: 'acme' }])
})

test('matches a denylist term regardless of its case', () => {
  // Given
  const files = [{ path: 'README.md', content: 'Ported from GLOBEX.' }]

  // When
  const leaks = findLeaks(files, ['Globex'])

  // Then
  assert.deepEqual(leaks, [{ path: 'README.md', line: 1, term: 'Globex' }])
})

test('reads the denylist one term per line, skipping comments and blanks, and never flags the denylist itself', () => {
  // Given
  const denylist = '# project names\nacme\n\ninitech\n'
  const files = [
    { path: 'leak-denylist.txt', content: denylist },
    { path: 'plugins/core/hooks/x.mjs', content: '// see initech' }
  ]

  // When
  const leaks = checkRepo(files, 'leak-denylist.txt')

  // Then
  assert.deepEqual(leaks, [{ path: 'plugins/core/hooks/x.mjs', line: 1, term: 'initech' }])
})

test('a term written as "term :: path" is flagged everywhere except that one path', () => {
  // Given
  const denylist = 'acme corp :: NOTICES.md\n'
  const files = [
    { path: 'leak-denylist.txt', content: denylist },
    { path: 'NOTICES.md', content: 'Copyright Acme Corp' },
    { path: 'plugins/core/skills/tdd/SKILL.md', content: 'Forked from Acme Corp.' }
  ]

  // When
  const leaks = checkRepo(files, 'leak-denylist.txt')

  // Then
  assert.deepEqual(leaks, [{ path: 'plugins/core/skills/tdd/SKILL.md', line: 1, term: 'acme corp' }])
})
