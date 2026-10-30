import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runScript as runCoreScript, stackProject } from '../../core/scripts/verify-fixtures.mjs'

/**
 * A stand-in for playwright-cli. It appends each call's arguments, and for `open` the config it
 * was given, to `cli.log` as JSON lines. `open` fails for a session named in `FAIL_OPEN`, and
 * `run-code` prints `LAYOUT` as its raw result.
 */
const CLI = `
import { appendFileSync, readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const session = args.find((arg) => arg.startsWith('-s='))?.slice(3)
const config = args.find((arg) => arg.startsWith('--config='))?.slice(9)
appendFileSync('cli.log', JSON.stringify({ args, config: config && JSON.parse(readFileSync(config, 'utf8')) }) + '\\n')
if (args.includes('open') && session.endsWith(process.env.FAIL_OPEN ?? '\\0')) {
  console.error('Error: browserType.launch: Executable doesn\\'t exist at /home/eval/.cache/ms-playwright/chromium-1200/chrome')
  process.exit(1)
}
if (args.includes('run-code')) process.stdout.write(process.env.LAYOUT ?? '[]')
`

/** A verify project whose web-e2e stack walks at [targets], with the stand-in CLI. */
function project(targets = { desktop: [1440, 900], phone: [390, 844] }) {
  return stackProject({ config: `{ targets: ${JSON.stringify(targets)} }`, files: { 'cli.mjs': CLI, '.gitignore': 'cli.log\n' } })
}

/** Runs the browser script in [dir] with [args], through the stand-in CLI. */
const browser = (dir, args, env = {}) =>
  runCoreScript(join('..', '..', 'web-e2e', 'scripts', 'verify-browser.mjs'), dir, args, { SKRYMER_AI_PLAYWRIGHT_CLI: `node ${join(dir, 'cli.mjs')}`, ...env })

/** The stand-in CLI's calls in [dir]. */
const calls = (dir) => (existsSync(join(dir, 'cli.log')) ? readFileSync(join(dir, 'cli.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [])

const browserDir = (dir) => join(dir, '.git', 'skrymer-ai', 'verify', 'browser')

test('open starts one headless session per target at the URL, each emulating its viewport', () => {
  // Given a stack that walks at desktop and phone
  const dir = project()

  // When the browser opens at the dev server's URL
  const { status, out } = browser(dir, ['open', 'http://127.0.0.1:3000/reports'])

  // Then each target got its own session, opened headless at that URL with its viewport, scale and touch
  assert.equal(status, 0, out)
  const opens = calls(dir)
  assert.equal(opens.length, 2)
  const [desktop, phone] = opens
  assert.ok(desktop.args.includes('open') && desktop.args.at(-1) === 'http://127.0.0.1:3000/reports')
  assert.ok(!desktop.args.includes('--headed'))
  assert.deepEqual(desktop.config.browser.contextOptions, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false })
  assert.deepEqual(phone.config.browser.contextOptions, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  assert.notEqual(desktop.args.find((arg) => arg.startsWith('-s=')), phone.args.find((arg) => arg.startsWith('-s=')))
  assert.equal(phone.config.outputDir, join(browserDir(dir), 'phone'))
})

test('open prints the command that drives each target', () => {
  // Given a stack with one target
  const dir = project({ tablet: [820, 1180] })

  // When the browser opens
  const { out } = browser(dir, ['open', 'http://127.0.0.1:3000/'])

  // Then it names the target, its size and the session to drive it with, and where screenshots go
  const session = calls(dir)[0].args.find((arg) => arg.startsWith('-s='))
  assert.match(out, new RegExp(`tablet 820x1180: node \\S+cli\\.mjs ${session} <command>`))
  assert.ok(out.includes(`Save screenshots under ${browserDir(dir)}/<target>/`), out)
  assert.equal(calls(dir)[0].config.browser.contextOptions.deviceScaleFactor, 2)
})

test('open --headed shows each browser', () => {
  // Given a stack that walks at desktop and phone
  const dir = project()

  // When the browser opens headed
  const { status, out } = browser(dir, ['open', '--headed', 'http://127.0.0.1:3000/'])

  // Then every session opens headed
  assert.equal(status, 0, out)
  assert.deepEqual(calls(dir).map((call) => call.args.includes('--headed')), [true, true])
})

test('open stops with the cause when a browser cannot start, and closes the sessions it opened', () => {
  // Given a phone session whose browser cannot launch
  const dir = project()

  // When the browser opens
  const { status, out } = browser(dir, ['open', 'http://127.0.0.1:3000/'], { FAIL_OPEN: 'phone' })

  // Then it stops on the launch error, and the desktop session it opened is closed again
  assert.equal(status, 1)
  assert.match(out, /^STOP: .*phone.*Executable doesn't exist/m)
  const closes = calls(dir).filter((call) => call.args.includes('close'))
  assert.deepEqual(closes.map((call) => call.args.find((arg) => arg.startsWith('-s='))), [calls(dir)[0].args.find((arg) => arg.startsWith('-s='))])
})

test('layout runs the layout checks in the target session and fails on any finding', () => {
  // Given an open browser whose phone page has a control off screen
  const dir = project()
  browser(dir, ['open', 'http://127.0.0.1:3000/'])
  const finding = [{ check: 'offscreen', element: 'button "Submit"', detail: 'right edge at 412px, past the 390px viewport' }]

  // When the layout of the phone target is checked
  const { status, out } = browser(dir, ['layout', 'phone'], { LAYOUT: JSON.stringify(finding) })

  // Then the check ran the shipped script in the phone session, and the finding fails it
  const run = calls(dir).at(-1)
  assert.equal(run.args.find((arg) => arg.startsWith('-s=')), calls(dir)[1].args.find((arg) => arg.startsWith('-s=')))
  assert.ok(run.args.includes('--raw'))
  assert.ok(existsSync(run.args.find((arg) => arg.startsWith('--filename=')).slice(11)))
  assert.equal(status, 1)
  assert.match(out, /phone: 1 layout finding\n {2}offscreen {2}button "Submit": right edge at 412px, past the 390px viewport/)
})

test('layout passes a clean page', () => {
  // Given an open browser with a clean page
  const dir = project()
  browser(dir, ['open', 'http://127.0.0.1:3000/'])

  // When the desktop layout is checked
  const { status, out } = browser(dir, ['layout', 'desktop'])

  // Then it passes and says so
  assert.equal(status, 0, out)
  assert.match(out, /desktop: no layout findings/)
})

test('layout stops for a target with no open session', () => {
  // Given a browser that was never opened
  const dir = project()

  // When a target's layout is checked
  const { status, out } = browser(dir, ['layout', 'phone'])

  // Then it stops and says how to open one
  assert.equal(status, 1)
  assert.match(out, /^STOP: no browser is open for "phone"\..*verify-browser\.mjs open <url>/m)
  assert.deepEqual(calls(dir), [])
})

test('close closes every session open opened, and forgets them', () => {
  // Given an open browser at two targets
  const dir = project()
  browser(dir, ['open', 'http://127.0.0.1:3000/'])
  const sessions = calls(dir).map((call) => call.args.find((arg) => arg.startsWith('-s=')))

  // When it is closed, twice
  writeFileSync(join(dir, 'cli.log'), '')
  const first = browser(dir, ['close'])
  const second = browser(dir, ['close'])

  // Then the first closes both sessions and the second has nothing left to close
  assert.equal(first.status, 0, first.out)
  assert.deepEqual(calls(dir).map((call) => [call.args.find((arg) => arg.startsWith('-s=')), call.args.includes('close')]), sessions.map((s) => [s, true]))
  assert.match(second.out, /no browser is open/)
})
