import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PRESET = join(dirname(fileURLToPath(import.meta.url)), 'eslint-msw.mjs')
const ESLINT = 'eslint@10.13.0'

// The tests run the real ESLint through npx, so its first download happens before them.
before(() => execFileSync('npx', ['-y', ESLINT, '--version'], { stdio: 'ignore' }))

/** A temp project holding [files] and an eslint.config.mjs spreading the preset with [options]. */
function fixture(files, options = '') {
  const dir = mkdtempSync(join(tmpdir(), 'eslint-msw-'))
  const config = `import { mswBans } from ${JSON.stringify(pathToFileURL(PRESET).href)}\n\nexport default [...mswBans(${options})]\n`
  for (const [path, content] of Object.entries({ 'eslint.config.mjs': config, ...files })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

/** The line and message of each problem ESLint reports in [dir], per file other than the config. */
function lint(dir) {
  const { stdout, stderr } = spawnSync('npx', ['-y', ESLINT, '--format', 'json', '.'], { cwd: dir, encoding: 'utf8' })
  assert.ok(stdout, stderr)
  return Object.fromEntries(
    JSON.parse(stdout)
      .filter(({ filePath }) => !filePath.endsWith('eslint.config.mjs'))
      .map(({ filePath, messages }) => [filePath.slice(dir.length + 1), messages.map(({ line, message }) => ({ line, message }))]),
  )
}

const linesOf = (problems) => problems.map(({ line }) => line)

test('a test that mocks an HTTP client or stubs fetch is refused, with the handlers named', () => {
  // Given a component test mocking ofetch, axios and Apollo, and stubbing fetch three ways
  const dir = fixture({
    'src/invoices.test.js': [
      "vi.mock('ofetch')",
      "vi.doMock('axios', () => ({}))",
      "vi.mock('@apollo/client')",
      "vi.stubGlobal('fetch', vi.fn())",
      "vi.spyOn(globalThis, 'fetch')",
      'window.$fetch = vi.fn()',
      '',
    ].join('\n'),
  })

  // When it is linted
  const problems = lint(dir)['src/invoices.test.js']

  // Then every line is refused, each message pointing at the MSW handlers
  assert.deepEqual(linesOf(problems), [1, 2, 3, 4, 5, 6])
  for (const { message } of problems) assert.match(message, /MSW handlers/)
})

test('a spec routing the app API, a catch-all or a pattern the ban cannot read is refused', () => {
  // Given a Playwright spec routing /api by string and by regex, everything, and a variable
  const dir = fixture({
    'e2e/invoices.spec.js': [
      "await page.route('**/api/invoices', (route) => route.fulfill({ json: [] }))",
      'await context.route(/\\/api\\//, (route) => route.abort())',
      "await page.route('**/*', (route) => route.continue())",
      'await page.route(pattern, (route) => route.abort())',
      '',
    ].join('\n'),
  })

  // When it is linted
  const problems = lint(dir)['e2e/invoices.spec.js']

  // Then all four are refused
  assert.deepEqual(linesOf(problems), [1, 2, 3, 4])
})

test('third-party routes, non-HTTP mocks and MSW overrides stay legal', () => {
  // Given a spec aborting a CDN, a test mocking a clock module, and an MSW override
  const dir = fixture({
    'e2e/scanner.spec.js': "await page.route('https://cdn.acme.test/**', (route) => route.abort())\n",
    'src/reminder.test.js': [
      "vi.mock('./clock')",
      'vi.useFakeTimers()',
      "server.use(http.get('*/api/invoices', () => HttpResponse.json([])))",
      '',
    ].join('\n'),
    'src/fetcher.js': 'globalThis.fetch = wrapped\n',
  })

  // When it is linted
  const problems = lint(dir)

  // Then nothing is reported, and source outside tests is not judged
  assert.deepEqual(problems, { 'e2e/scanner.spec.js': [], 'src/reminder.test.js': [], 'src/fetcher.js': [] })
})

test("the project's own API module and its extra clients are refused too, and registerEndpoint always", () => {
  // Given options naming the project's API module and a client of its own, and a Nuxt test using registerEndpoint
  const dir = fixture(
    {
      'app/invoices.test.js': ["vi.mock('~/api/client')", "vi.mock('@acme/http')", "registerEndpoint('/api/invoices', () => [])", ''].join('\n'),
    },
    "{ clients: ['@acme/http'], apiModules: ['~/api/client'] }",
  )

  // When it is linted
  const problems = lint(dir)['app/invoices.test.js']

  // Then all three are refused
  assert.deepEqual(linesOf(problems), [1, 2, 3])
})
