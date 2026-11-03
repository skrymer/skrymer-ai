import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unifiedDiff } from './unified-diff.mjs'
import { tempDir } from './temp-dir.mjs'

test('diffs two texts under the paths given, from the first hunk header on', () => {
  // Given two versions of a file

  // When they are diffed
  const diff = unifiedDiff({ from: 'a/notes.md', before: 'one\ntwo\n', to: 'b/notes.md', after: 'one\nthree\n' })

  // Then the diff starts at its file header, under the paths given
  assert.equal(diff, '--- a/notes.md\n+++ b/notes.md\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n')
})

test('a missing side is /dev/null', () => {
  // Given a file that only exists after

  // When it is diffed against nothing
  const diff = unifiedDiff({ from: 'a/new.md', before: null, to: 'b/new.md', after: 'hi\n' })

  // Then the before side is /dev/null
  assert.match(diff, /^--- \/dev\/null\n\+\+\+ b\/new\.md\n/)
})

test("a developer's external diff tool doesn't change the diff", (t) => {
  // Given a git config that sends diffs to an external tool
  const config = join(tempDir('unified-diff-config-'), 'gitconfig')
  writeFileSync(config, '[diff]\n\texternal = echo external\n')
  const saved = process.env.GIT_CONFIG_GLOBAL
  process.env.GIT_CONFIG_GLOBAL = config
  t.after(() => (saved === undefined ? delete process.env.GIT_CONFIG_GLOBAL : (process.env.GIT_CONFIG_GLOBAL = saved)))

  // When two texts are diffed
  const diff = unifiedDiff({ from: 'rendered', before: 'a\n', to: 'sent', after: 'b\n' })

  // Then it is still git's own unified diff
  assert.equal(diff, '--- rendered\n+++ sent\n@@ -1 +1 @@\n-a\n+b\n')
})
