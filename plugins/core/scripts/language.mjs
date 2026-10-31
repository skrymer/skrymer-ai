#!/usr/bin/env node
/**
 * The language gate's extraction: the domain names a branch brings in, set against the glossary
 * of the context each lands in, so the language judge rules on a list rather than on whatever it
 * happens to notice.
 *
 *   node language.mjs [--prd <file>]
 *
 * A new identifier is a type (class, interface, enum, object, type alias, record, struct, trait)
 * declared on a line the branch added, in a code file that isn't a test. It belongs to the
 * innermost domain context holding its file. A type named only in technical words (`HttpClient`,
 * `OrderService` minus `Order`) is left out. Each identifier, and with `--prd` each term the PRD
 * puts in bold, is matched by its words against the glossary's terms (`**Term**:`) and their
 * `_Avoid_:` lists. A MISMATCH line is either a name using a term the glossary avoids or a name no
 * term covers; the language judge rules each one a missing term or a misnamed concept.
 *
 * The branch is measured as the other sign-off scripts measure it: every file changed since the
 * merge base with origin's default branch, committed or not. A project with no config is one
 * context at the root.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { changedOnBranch } from './branch.mjs'
import { loadConfig, trimRoot } from './config.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
const PLUGIN_ROOT = join(dirname(SCRIPT), '..')
const CODE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.kt', '.kts', '.java', '.scala', '.py', '.go', '.rs', '.swift', '.cs', '.rb'])
const TEST_FILE = /(^|\/)(tests?|__tests__|e2e)\/|[._-](test|spec)\.\w+$|Tests?\.\w+$/
const DECLARATION = /\b(?:class|interface|enum|object|type|record|struct|trait)\s+([A-Z][A-Za-z0-9]*)/g

/** Words that name a technical role rather than a domain concept. */
const TECHNICAL = new Set(
  'abstract adapter api base builder cache client component composable config context controller dto error event exception factory handler helper http impl json listener manager mapper model module options page props provider repository request response service settings spec state store test util utils view'.split(' ')
)

class Stop extends Error {}

async function main(argv, projectDir) {
  const { values } = parseArgs({ args: argv, options: { prd: { type: 'string' } } })
  const { config, errors } = await loadConfig(projectDir, PLUGIN_ROOT)
  if (errors) throw new Stop(`the project config has errors:\n${errors.map((error) => `  ${error}`).join('\n')}`)
  const contexts = (config?.domain.contexts ?? ['.']).map(trimRoot).sort((a, b) => b.length - a.length)
  let branch
  try {
    branch = changedOnBranch(projectDir, (warning) => process.stdout.write(`warning: ${warning}\n`))
  } catch (error) {
    throw new Stop(`the base is unresolved: ${error.message}`)
  }
  const { base, changed, git } = branch
  if (!changed.length) throw new Stop(`the branch holds no change since ${base.slice(0, 7)}. Nothing was measured.`)

  const contextOf = (file) => contexts.find((context) => !context || file.startsWith(`${context}/`))
  const touched = [...new Set(changed.map(contextOf).filter((context) => context !== undefined))].sort()
  const identifiers = changed.filter((file) => CODE.has(extname(file)) && !TEST_FILE.test(file) && existsSync(join(projectDir, file))).flatMap((file) => declaredIn(file, addedLines(git, base, projectDir, file)))

  const lines = [`base ${base.slice(0, 7)}: ${changed.length} file${changed.length === 1 ? '' : 's'} changed on the branch`]
  let mismatches = 0
  const glossaries = []
  for (const context of touched) {
    const doc = join(context, 'CONTEXT.md')
    const glossary = existsSync(join(projectDir, doc)) ? glossaryOf(readFileSync(join(projectDir, doc), 'utf8')) : null
    if (glossary) glossaries.push(...glossary)
    const mine = identifiers.filter(({ file }) => contextOf(file) === context)
    lines.push(`context ${context || '.'} (${glossary ? doc : 'no CONTEXT.md'}):`)
    if (!mine.length) lines.push('  no new identifiers')
    mismatches += judge(mine.map(({ name, file, line }) => ({ name, where: `${file}:${line}` })), glossary, lines)
  }
  let prdTerms = []
  if (values.prd) {
    const path = resolve(projectDir, values.prd)
    if (!existsSync(path)) throw new Stop(`no PRD at ${values.prd}.`)
    prdTerms = [...new Set([...readFileSync(path, 'utf8').matchAll(/\*\*([^*\n]+?)\*\*/g)].map((match) => match[1].trim()))].filter((term) => term.split(/\s+/).length <= 4)
    lines.push(`PRD (${values.prd}):`)
    mismatches += judge(prdTerms.map((name) => ({ name, where: values.prd, prd: true })), glossaries, lines)
  }
  const checked = values.prd ? `${count(identifiers.length, 'new identifier')} and ${count(prdTerms.length, 'PRD term')}` : count(identifiers.length, 'new identifier')
  lines.push(`${checked} checked: ${count(mismatches, 'mismatch', 'mismatches')}${mismatches ? ', each for the language judge' : ''}.`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

/** Adds a line to [lines] per mismatch among [names] against [glossary] (null when the context has none), then the matches. The mismatch count. */
function judge(names, glossary, lines) {
  let mismatches = 0
  const matches = []
  for (const { name, where, prd } of names) {
    const words = wordsOf(name)
    if (glossary === null) {
      lines.push(`  MISMATCH ${name}  ${where}  the context has no glossary`)
      mismatches++
      continue
    }
    const covered = new Set(glossary.flatMap(({ term }) => runsOf(words, wordsOf(term))))
    const avoided = glossary.flatMap(({ term, avoid }) => avoid.filter((phrase) => runsOf(words, wordsOf(phrase)).some((i) => !covered.has(i))).map((phrase) => ({ term, phrase })))[0]
    const term = glossary.find(({ term }) => contains(words, wordsOf(term)))
    if (avoided) {
      lines.push(`  MISMATCH ${name}  ${where}  uses "${avoided.phrase}", which the glossary’s **${avoided.term}** avoids`)
      mismatches++
    } else if (term) matches.push(`${prd ? name : `${name} (${where})`} → **${term.term}**`)
    else {
      lines.push(`  MISMATCH ${name}  ${where}  names no term in the glossary`)
      mismatches++
    }
  }
  if (matches.length) lines.push(`  matches: ${matches.join(', ')}`)
  return mismatches
}

/** Each type declared on [added] lines of [file], `{ name, file, line }`, unless only technical words name it. */
function declaredIn(file, added) {
  return added.flatMap(({ line, text }) =>
    [...text.matchAll(DECLARATION)].map((match) => match[1]).filter((name) => wordsOf(name).some((word) => !TECHNICAL.has(word))).map((name) => ({ name, file, line }))
  )
}

/** The lines the branch added to [file], each `{ line, text }`: every line of an untracked file, else each hunk's new lines. */
function addedLines(git, base, projectDir, file) {
  const text = readFileSync(join(projectDir, file), 'utf8').split('\n')
  const tracked = git('ls-files', '--', resolve(projectDir, file)) !== ''
  if (!tracked) return text.map((line, i) => ({ line: i + 1, text: line }))
  const hunks = [...git('diff', '-U0', '--no-color', base, '--', resolve(projectDir, file)).matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)]
  return hunks.flatMap(([, start, length = '1']) => Array.from({ length: Number(length) }, (_, i) => ({ line: Number(start) + i, text: text[Number(start) + i - 1] ?? '' })))
}

/** The terms of a CONTEXT.md, each `{ term, avoid }`, its _Avoid_ list kept to the short phrases a name could use. */
function glossaryOf(markdown) {
  const terms = []
  for (const line of markdown.split('\n')) {
    const term = /^\*\*([^*]+)\*\*:\s*$/.exec(line.trim())
    if (term) terms.push({ term: term[1].trim(), avoid: [] })
    const avoid = /^_Avoid_:\s*(.+)$/.exec(line.trim())
    if (avoid && terms.length) {
      terms.at(-1).avoid = avoid[1]
        .split(/[;,]/)
        .map((phrase) => phrase.trim().replace(/^["“'`]|["”'`.]$/g, '').replace(/^(?:a|an|the)\s+/i, ''))
        .filter((phrase) => /^[A-Za-z][A-Za-z -]*$/.test(phrase) && phrase.split(/\s+/).length <= 3)
    }
  }
  return terms
}

/** The words of a name or phrase, lowercased and singular: `CartRows` and "cart row" both give cart, row. */
function wordsOf(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))
}

/** Whether [words] hold [phrase] as a run. */
const contains = (words, phrase) => runsOf(words, phrase).length > 0

/** The positions in [words] that a run of [phrase] covers: an avoided word inside a term's own run is the term, not the word. */
const runsOf = (words, phrase) =>
  phrase.length ? words.flatMap((_, i) => (phrase.every((word, j) => words[i + j] === word) ? phrase.map((_, j) => i + j) : [])) : []

const count = (n, noun, plural = `${noun}s`) => `${n} ${n === 1 ? noun : plural}`

if (process.argv[1] === SCRIPT) {
  main(process.argv.slice(2), process.cwd()).catch((error) => {
    process.stdout.write(error instanceof Stop ? `STOP: ${error.message}\n` : `language failed: ${error.stack}\n`)
    process.exitCode = 1
  })
}
