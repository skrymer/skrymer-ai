#!/usr/bin/env node
/**
 * The recorded decisions a branch's change answers to, for check-adrs. A doc is in scope when a
 * file the branch changed puts it there:
 *
 *   docs/adr/                  always, the project's own decisions
 *   <context>/CONTEXT.md       for each domain context holding a changed file
 *   <context>/docs/adr/        likewise; the root context '.' holds every file
 *
 * Each doc is printed with the changed files that selected it, and a doc a context should hold
 * but doesn't is named as absent. The last line is the pathspec the doc-drift greps run over:
 * CLAUDE.md, README.md, docs/, the glossaries in scope and the project's `signOff.docs`.
 *
 * The branch is measured as the mutation sweep measures it: every file changed since the merge
 * base with origin's default branch, committed or not. A project with no config is one context
 * at the root.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changedOnBranch } from './branch.mjs'
import { loadConfig, trimRoot } from './config.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
const PLUGIN_ROOT = join(dirname(SCRIPT), '..')
const DRIFT_ROOTS = ['CLAUDE.md', 'README.md', 'docs/']
const ALWAYS = '(always in scope)'

class Stop extends Error {}

async function main(projectDir) {
  const { contexts, docs } = await scopeConfig(projectDir)
  let branch
  try {
    branch = changedOnBranch(projectDir, (warning) => process.stdout.write(`warning: ${warning}\n`))
  } catch (error) {
    throw new Stop(`the base is unresolved: ${error.message}`)
  }
  const { base, changed } = branch
  if (!changed.length) throw new Stop(`the branch holds no change since ${base.slice(0, 7)}. Nothing was measured.`)

  const selected = new Map([['docs/adr/', []]])
  for (const context of contexts) {
    const held = changed.filter((file) => !context || file.startsWith(`${context}/`))
    if (!held.length) continue
    for (const doc of [join(context, 'CONTEXT.md'), `${join(context, 'docs', 'adr')}/`]) {
      selected.set(doc, [...new Set([...(selected.get(doc) ?? []), ...held])].sort())
    }
  }
  const present = [...selected].filter(([doc]) => existsSync(join(projectDir, doc)))
  const absent = [...selected.keys()].filter((doc) => !existsSync(join(projectDir, doc)))
  const glossaries = present.map(([doc]) => doc).filter((doc) => doc.endsWith('CONTEXT.md'))
  const pathspec = [...DRIFT_ROOTS.filter((path) => existsSync(join(projectDir, path))), ...glossaries, ...docs.map((glob) => `':(glob)${glob}'`)]

  const lines = [`base ${base.slice(0, 7)}: ${changed.length} file${changed.length === 1 ? '' : 's'} changed on the branch`, 'docs in scope:']
  for (const [doc, files] of present) lines.push(`  ${doc}  ← ${files.length ? files.join(', ') : ALWAYS}`)
  for (const doc of absent) lines.push(`absent: ${doc}`)
  lines.push(`drift: git grep -n -E '<pattern>' -- ${pathspec.join(' ')}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

/** The domain contexts, as project-relative directories with `''` for the root, and the sign-off docs. */
async function scopeConfig(projectDir) {
  const { config, errors } = await loadConfig(projectDir, PLUGIN_ROOT)
  if (errors) throw new Stop(`the project config has errors:\n${errors.map((error) => `  ${error}`).join('\n')}`)
  if (!config) return { contexts: [''], docs: [] }
  const domainErrors = config.contextErrors.filter((error) => error.startsWith('domain.'))
  if (domainErrors.length) throw new Stop(`the project config's domain has errors:\n${domainErrors.map((error) => `  ${error}`).join('\n')}`)
  return { contexts: config.domain.contexts.map(trimRoot), docs: config.signOff.docs }
}

if (process.argv[1] === SCRIPT) {
  main(process.cwd()).catch((error) => {
    process.stdout.write(error instanceof Stop ? `STOP: ${error.message}\n` : `adr scope failed: ${error.stack}\n`)
    process.exitCode = 1
  })
}
