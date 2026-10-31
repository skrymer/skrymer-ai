import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runScript } from './git-fixture.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'mermaid-check.mjs')

/** What mermaid-cli prints when Puppeteer can't launch Chromium. */
const NO_BROWSER = 'Error: Failed to launch the browser process!\n[0101/000000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!\n\nTROUBLESHOOTING: https://pptr.dev/troubleshooting\n    at ChildProcess.onClose (launch.js:346:24)'

/**
 * A stand-in for mermaid-cli: it logs its arguments, fails like the real one on a block holding
 * BROKEN, and otherwise writes the output file.
 */
function stubCli() {
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-cli-'))
  const log = join(dir, 'calls.log')
  writeFileSync(
    join(dir, 'mmdc.mjs'),
    `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const at = (flag) => args[args.indexOf(flag) + 1]
appendFileSync(${JSON.stringify(log)}, args.filter((a) => !a.includes('/')).join(' ') + '\\n')
if (process.env.STUB_NO_BROWSER) {
  console.error(${JSON.stringify(NO_BROWSER)})
  process.exit(1)
}
if (readFileSync(at('-i'), 'utf8').includes('BROKEN')) {
  console.error('Error: Parse error on line 2:\\n...b[[[\\n------^\\nExpecting SQE, got EOF')
  process.exit(1)
}
writeFileSync(at('-o'), '<svg/>')
`
  )
  return { env: { SKRYMER_AI_MERMAID_CLI: `node ${join(dir, 'mmdc.mjs')}` }, calls: () => readFileSync(log, 'utf8') }
}

/** A temp dir holding [files], each path to its content. */
function docs(files) {
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-docs-'))
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content)
  return dir
}

const block = (body) => `\`\`\`mermaid\n${body}\n\`\`\`\n`

test('every Mermaid block in a doc that renders passes, each rendered once', () => {
  // Given a doc with two diagrams under their headings, and a code block that isn't Mermaid
  const cli = stubCli()
  const dir = docs({ 'ARCHITECTURE.md': `# Acme\n\n## Orders\n\n${block('flowchart LR\n  cart --> order')}\n\`\`\`js\nconst x = 1\n\`\`\`\n\n## Billing\n\n${block('flowchart LR\n  order --> invoice')}` })

  // When the docs are checked
  const { status, stdout } = runScript(SCRIPT, dir, ['ARCHITECTURE.md'], cli.env)

  // Then it passes and the renderer ran once per diagram
  assert.deepEqual([status, stdout], [0, '2 diagrams in ARCHITECTURE.md render.\n'])
  assert.equal(cli.calls().trim().split('\n').length, 2)
})

test('a block that does not render fails, naming its doc, its heading and the renderer’s reason', () => {
  // Given a doc whose second diagram is broken, and a doc whose only diagram renders
  const cli = stubCli()
  const dir = docs({
    'ARCHITECTURE.md': `## Orders\n\n${block('flowchart LR\n  cart --> order')}\n## Billing flow\n\n${block('flowchart LR\n  BROKEN b[[[')}`,
    'README.md': `## Sign-off\n\n${block('flowchart TD\n  a --> b')}`,
  })

  // When both docs are checked
  const { status, stdout } = runScript(SCRIPT, dir, ['ARCHITECTURE.md', 'README.md'], cli.env)

  // Then it fails on the broken block alone, with the heading it sits under and the parse error
  assert.equal(status, 1)
  assert.equal(
    stdout,
    '1 of 3 diagrams does not render:\n- ARCHITECTURE.md, under "Billing flow" (diagram 2): Expecting SQE, got EOF\n'
  )
})

test('a doc with no diagram is no failure, and a doc that does not exist is', () => {
  // Given a doc with no Mermaid block
  const cli = stubCli()
  const dir = docs({ 'NOTES.md': '# Notes\n\nNothing drawn.\n' })

  // When it is checked, then a doc that isn't there
  const empty = runScript(SCRIPT, dir, ['NOTES.md'], cli.env)
  const gone = runScript(SCRIPT, dir, ['GONE.md'], cli.env)

  // Then the first passes saying so, and the second fails naming it
  assert.deepEqual([empty.status, empty.stdout], [0, 'no diagrams in NOTES.md.\n'])
  assert.deepEqual([gone.status, gone.stdout], [1, 'STOP: GONE.md does not exist.\n'])
})

test('a Puppeteer config named in the environment reaches the renderer', () => {
  // Given a doc with one diagram and a Puppeteer config for a browser that needs flags
  const cli = stubCli()
  const dir = docs({ 'README.md': `## Flow\n\n${block('flowchart LR\n  a --> b')}`, 'pup.json': '{"args":[]}' })

  // When it is checked with the config named
  runScript(SCRIPT, dir, ['README.md'], { ...cli.env, SKRYMER_AI_PUPPETEER_CONFIG: join(dir, 'pup.json') })

  // Then the renderer got the config through -p
  assert.match(cli.calls(), /-p/)
})

test('a browser that will not start stops the check instead of failing a diagram', () => {
  // Given a doc with a valid diagram, and a renderer whose Chromium can't launch
  const cli = stubCli()
  const dir = docs({ 'README.md': `## Flow\n\n${block('flowchart LR\n  a --> b')}` })

  // When it is checked
  const { status, stdout } = runScript(SCRIPT, dir, ['README.md'], { ...cli.env, STUB_NO_BROWSER: '1' })

  // Then it stops on the browser, with Puppeteer's reason and how to point it at a Chromium
  assert.equal(status, 1)
  assert.equal(
    stdout,
    'STOP: mermaid-cli could not start a browser, so no diagram was checked: Failed to launch the browser process! No usable sandbox! Set SKRYMER_AI_PUPPETEER_CONFIG to a Puppeteer config file, such as {"executablePath": "<path to chrome>"} for a local Chromium, or {"args": ["--no-sandbox"]} where the system restricts its sandbox.\n'
  )
})
