import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesGlob } from 'node:path'
import pack from './skrymer-ai.pack.mjs'
import nuxt from '../nuxt/skrymer-ai.pack.mjs'

/** The skills the fragment's file rules require for [path] under a web-e2e root at web/, anchored there as the config anchors them. */
const skillsFor = (path) => [
  ...new Set(pack.skills.files.filter((rule) => new RegExp(`(^|/)web/(?:${rule.path.source})`).test(`web/${path}`)).flatMap((rule) => rule.skills)),
]

test('editing a mock handler requires the MSW skill', () => {
  // Given handler files at the usual depths, and a Vitest manual mock that is not one
  const handlers = ['test/mocks/handlers/invoices.ts', 'mocks/handlers.ts', 'test/mocks/node.ts']

  // When the rules are read for each
  const required = handlers.map(skillsFor)

  // Then each handler needs web-e2e:msw, and __mocks__ does not
  for (const skills of required) assert.ok(skills.includes('web-e2e:msw'))
  assert.ok(!skillsFor('app/__mocks__/clock.ts').includes('web-e2e:msw'))
})

test('writing a unit, component or e2e test requires the MSW skill', () => {
  // Given a Vitest component test, a server test and a Playwright spec
  const tests = ['app/components/InvoiceList.test.ts', 'server/api/invoices.spec.ts', 'e2e/invoices.spec.ts']

  // When the rules are read for each
  const required = tests.map(skillsFor)

  // Then each needs web-e2e:msw, and the spec keeps the Playwright skill
  for (const skills of required) assert.ok(skills.includes('web-e2e:msw'))
  assert.ok(required[2].includes('web-e2e:playwright-best-practices'))
})

test('a prompt about faking an API response asks for the MSW skill, and one about the clock does not', () => {
  // Given the fragment's prompt rules
  const fires = (words) => pack.skills.prompts.some((rule) => rule.skills.includes('web-e2e:msw') && rule.pattern.test(words))

  // When prompts about API mocks and about time are matched
  // Then only the API ones fire
  assert.ok(fires('mock the users API in this test'))
  assert.ok(fires('why does vi.mock of ofetch break here?'))
  assert.ok(fires('add an MSW handler for invoices'))
  assert.ok(!fires('freeze the clock with vi.useFakeTimers'))
})

test('handlers under test/mocks are outside the nuxt mutation sweep and the TDD gate', () => {
  // Given a handler and the nuxt fragment's mutation and TDD globs
  const handler = 'test/mocks/handlers/invoices.ts'
  const globs = [...nuxt.mutation.source, ...nuxt.tdd.files]

  // When the handler is matched against them
  const matched = globs.filter((glob) => matchesGlob(handler, glob))

  // Then none matches
  assert.deepEqual(matched, [])
})
