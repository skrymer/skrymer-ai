#!/usr/bin/env node
/**
 * Renders every Mermaid block in the given Markdown docs, so a diagram that doesn't render
 * fails here rather than on a reader's screen. GitHub's parser accepts some diagrams that don't
 * draw, so a diagram counts only once it renders.
 *
 *   node mermaid-check.mjs <doc.md> …
 *
 * The blocks render together in one mermaid-cli run, and one by one only when that run fails,
 * to name each that doesn't render. mermaid-cli runs at a pinned version through `npx`, unless
 * `SKRYMER_AI_MERMAID_CLI` names another command. mermaid-cli drives a headless Chromium through
 * Puppeteer; `SKRYMER_AI_PUPPETEER_CONFIG` names a Puppeteer config file for it, such as one
 * pointing at a local Chromium. It fails naming each block that doesn't render by its doc, the
 * heading it sits under and the parser's words, and stops, blaming no diagram, when the renderer
 * can't start, can't be fetched, or can't start its browser.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(import.meta.url)
const CLI = ['npx', '-y', '@mermaid-js/mermaid-cli@11.17.0']

/** What Puppeteer says when it can't launch Chromium: a fault of the machine, never of a diagram. */
const BROWSER_FAILURE = /Failed to launch the browser process|Could not find (?:Chrome|Chromium|expected browser)|Browser was not found/
/** What npm says when it can't fetch mermaid-cli, offline or behind a proxy. */
const FETCH_FAILURE = /^npm (?:error|ERR!) /
/** A stack frame, with its `at` or without, as mermaid-cli echoes the browser's. */
const FRAME = /^(?:at\s|\S+ \((?:https?|file|node):)/
const PUPPETEER_HINT = 'Set SKRYMER_AI_PUPPETEER_CONFIG to a Puppeteer config file, such as {"executablePath": "<path to chrome>"} for a local Chromium, or {"args": ["--no-sandbox"]} where the system restricts its sandbox.'

class Stop extends Error {}

function main(paths, projectDir) {
  if (!paths.length) throw new Stop('usage: mermaid-check.mjs <doc.md> …')
  for (const path of paths) if (!existsSync(resolve(projectDir, path))) throw new Stop(`${path} does not exist.`)
  const diagrams = paths.flatMap((path) => diagramsIn(path, readFileSync(resolve(projectDir, path), 'utf8')))
  if (!diagrams.length) {
    process.stdout.write(`no diagrams in ${paths.join(', ')}.\n`)
    return
  }
  const scratch = mkdtempSync(join(tmpdir(), 'mermaid-check-'))
  try {
    const together = diagrams.map(({ body }) => `\`\`\`mermaid\n${body}\n\`\`\`\n`).join('\n')
    const failed =
      render(together, join(scratch, 'all'), 'md') === null
        ? []
        : diagrams.flatMap((diagram, i) => {
            const reason = render(diagram.body, join(scratch, `${i}`), 'mmd')
            return reason === null ? [] : [{ ...diagram, reason }]
          })
    if (!failed.length) {
      process.stdout.write(`${count(diagrams.length, 'diagram')} in ${paths.join(', ')} render${diagrams.length === 1 ? 's' : ''}.\n`)
      return
    }
    const lines = failed.map(({ path, heading, n, reason }) => `- ${path}, under ${heading ? `"${heading}"` : 'no heading'} (diagram ${n}): ${reason}`)
    process.stdout.write(`${failed.length} of ${count(diagrams.length, 'diagram')} ${failed.length === 1 ? 'does' : 'do'} not render:\n${lines.join('\n')}\n`)
    process.exitCode = 1
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Each Mermaid block of the doc at [path], whose text is [markdown], with the heading above it and its place in the doc. */
function diagramsIn(path, markdown) {
  const diagrams = []
  let heading = null
  let fence = null
  for (const line of markdown.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence.marker[0] && marker[1].length >= fence.marker.length && !marker[2]) {
        if (fence.mermaid) diagrams.push({ path, heading, n: diagrams.length + 1, body: fence.lines.join('\n') })
        fence = null
      } else fence.lines.push(line)
      continue
    }
    if (marker) fence = { marker: marker[1], mermaid: marker[2] === 'mermaid', lines: [] }
    else if (/^#{1,6}\s/.test(line)) heading = line.replace(/^#+\s+/, '').trim()
  }
  return diagrams
}

/**
 * Null if [text] renders, else the parser's words on why not. [stem] names its scratch files and
 * [ext] says whether [text] is one block (`mmd`) or Markdown holding them all (`md`).
 */
function render(text, stem, ext) {
  writeFileSync(`${stem}.${ext}`, `${text}\n`)
  const [command, ...prefix] = process.env.SKRYMER_AI_MERMAID_CLI?.trim().split(/\s+/).filter(Boolean) || []
  const cli = command ? [command, ...prefix] : CLI
  const config = process.env.SKRYMER_AI_PUPPETEER_CONFIG?.trim()
  const out = `${stem}.out.${ext === 'md' ? 'md' : 'svg'}`
  const args = [...cli.slice(1), '-q', '-i', `${stem}.${ext}`, '-o', out, ...(config ? ['-p', config] : [])]
  const run = spawnSync(cli[0], args, { encoding: 'utf8' })
  if (run.status === 0 && existsSync(out)) return null
  if (run.error) throw new Stop(`the renderer could not start, so no diagram was checked: ${run.error.message}`)
  const said = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !FRAME.test(line) && !line.startsWith('TROUBLESHOOTING:'))
  const launch = said.findIndex((line) => BROWSER_FAILURE.test(line))
  if (launch >= 0) {
    const why = said.slice(launch, launch + 2).map((line) => line.replace(/^Error:\s*/, '').replace(/^\[[^\]]*\]\s*/, '')).join(' ')
    throw new Stop(`mermaid-cli could not start a browser, so no diagram was checked: ${why} ${PUPPETEER_HINT}`)
  }
  const npm = said.filter((line) => FETCH_FAILURE.test(line))
  if (npm.length) throw new Stop(`the renderer could not be fetched, so no diagram was checked: ${npm.at(-1)}`)
  return said.find((line) => /^Expecting\b/.test(line)) ?? said.at(-1) ?? `the renderer exited ${run.status ?? run.signal} without a word`
}

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

if (process.argv[1] === SCRIPT) {
  try {
    main(process.argv.slice(2), process.cwd())
  } catch (error) {
    process.stdout.write(error instanceof Stop ? `STOP: ${error.message}\n` : `mermaid-check failed: ${error.stack}\n`)
    process.exitCode = 1
  }
}
