#!/usr/bin/env node
/**
 * The mutation sweep, scripted so that no step of it is a prose recipe a session retypes. A
 * mis-quoted shell variable once gave a silent zero-scope run, and survivors were copied into
 * the log by hand.
 *
 *   node mutation.mjs                    the plan: each enabled stack's scope, or why it is skipped
 *   node mutation.mjs run <pack> [root]  one stack's sweep
 *
 * The scope is every file the branch changed since its merge base with origin's default branch,
 * committed or not, that the pack's mutation `source` globs match and its test globs don't. A
 * branch with no change, or no base to measure from, stops the plan; a stack with nothing in
 * scope is skipped with a note, and a sweep asked to run over nothing fails.
 *
 * A sweep runs the pack's engine in the stack root, under a systemd memory cap where there is
 * one, with HEAD and `git status` stamped into its log. Every mutant no test detected becomes
 * one line of the survivors file: `file:line<TAB>mutator → replacement<TAB>status`, no header,
 * so its line count is the survivor count. Both files sit in the repo's git dir, under
 * `skrymer-ai/mutation/`, named for the stack.
 *
 * `SKRYMER_AI_MUTATION_CAP=off` runs the engine without the memory cap.
 */

import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { branchOf } from './branch.mjs'
import { loadConfig } from './config.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
const PLUGIN_ROOT = join(dirname(SCRIPT), '..')
const FETCH_TIMEOUT_MS = 60_000

class Stop extends Error {}

async function main([command, pack, root], projectDir) {
  const { config, errors } = await loadConfig(projectDir, PLUGIN_ROOT)
  if (errors) throw new Stop(`the project config has errors:\n${errors.map((error) => `  ${error}`).join('\n')}`)
  if (!config) throw new Stop('the project has no skrymer-ai config. /core:setup writes one.')
  if (!config.mutation.length) throw new Stop('no stack in the project config has a mutation engine.')
  const branch = measure(projectDir)
  if (command === undefined) return plan(config.mutation, branch)
  if (command === 'run') return sweep(stackOf(config.mutation, pack, root), branch, projectDir)
  throw new Stop(`unknown command "${command}". Usage: mutation.mjs [run <pack> [root]]`)
}

/**
 * The branch as `{ top, base, git, changed, scopeOf }`: its changed files, project-relative
 * (deleted ones included, since a deletion is a change), and each stack's scope among those
 * still on disk. Fetches origin first, because an unfetched origin anchors the merge base
 * wherever this clone last looked.
 */
function measure(projectDir) {
  const fetch = spawnSync('git', ['fetch', '-q', 'origin'], { cwd: projectDir, encoding: 'utf8', timeout: FETCH_TIMEOUT_MS })
  if (fetch.status !== 0) {
    const why = fetch.error?.message ?? fetch.stderr.trim().split('\n').at(-1)
    process.stdout.write(`warning: could not fetch origin (${why}); the base is where this clone last looked.\n`)
  }
  let branch
  try {
    branch = branchOf(projectDir)
  } catch (error) {
    throw new Stop(`the base is unresolved: ${error.message}`)
  }
  const { top, base, git, untracked } = branch
  const changed = [...new Set([...git('-c', 'core.quotePath=false', 'diff', '--name-only', base).split('\n'), ...untracked()])]
    .filter(Boolean)
    .map((file) => relative(projectDir, join(top, file)))
    .filter((file) => !file.startsWith('..') && !isAbsolute(file))
    .sort()
  if (!changed.length) throw new Stop(`the branch holds no change since ${base.slice(0, 7)}. Nothing was measured, so this is not a skip.`)
  const onDisk = changed.filter((file) => existsSync(join(projectDir, file)))
  const scopeOf = (stack) =>
    onDisk.filter((file) => stack.source.some((glob) => matchesGlob(file, glob)) && !stack.tests.some((glob) => matchesGlob(file, glob)))
  return { ...branch, changed, scopeOf }
}

function plan(stacks, { base, changed, scopeOf }) {
  const lines = [`base ${base.slice(0, 7)}: ${count(changed.length, 'file')} changed on the branch`]
  for (const stack of stacks) {
    const scope = scopeOf(stack)
    if (!scope.length) {
      lines.push(`${label(stack)}: SKIP — none of the ${changed.length} files the branch changed is mutable source`)
      continue
    }
    lines.push(`${label(stack)}: ${count(scope.length, 'file')}, ${stack.engine}`, ...scope.map((file) => `  ${file}`))
    lines.push(`  run: node ${SCRIPT} run ${stack.pack} ${stack.root || '.'}`)
    if (stack.notes) lines.push(`  engine notes: ${stack.notes}`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

/** The stack [pack] names, under [root] when the pack has several. */
function stackOf(stacks, pack, root) {
  const matches = stacks.filter((stack) => stack.pack === pack && (root === undefined || stack.root === trimRoot(root)))
  if (matches.length === 1) return matches[0]
  const known = stacks.map(label).join(', ')
  if (!matches.length) throw new Stop(`there is no stack "${[pack, root].filter(Boolean).join(' ')}" with a mutation engine. Stacks: ${known}.`)
  throw new Stop(`${pack} has several roots; name one. Stacks: ${known}.`)
}

function sweep(stack, { top, base, git, scopeOf }, projectDir) {
  const scope = scopeOf(stack)
  if (!scope.length) throw new Stop(`${label(stack)}: the scope resolved to no files, so there is nothing to mutate. The plan says why.`)
  const rootDir = join(projectDir, stack.root)
  const files = scope.map((file) => relative(rootDir, join(projectDir, file)))
  const read = (file) => readFileSync(join(rootDir, file), 'utf8')
  const targets = stack.targets(files, read).join(',')
  const { argv, cap } = capped(stack.run.map((word) => word.replaceAll('{targets}', targets)), stack.memory)

  const out = resolve(top, git('rev-parse', '--git-path', 'skrymer-ai/mutation'))
  mkdirSync(out, { recursive: true })
  const name = [stack.pack, stack.root.replaceAll('/', '-')].filter(Boolean).join('-')
  const logPath = join(out, `${name}.log`)
  const survivorsPath = join(out, `${name}.survivors.tsv`)
  const reportPath = join(rootDir, stack.report)
  const reportName = relative(projectDir, reportPath)
  rmSync(reportPath, { force: true })
  rmSync(survivorsPath, { force: true })

  const log = openSync(logPath, 'w')
  writeSync(
    log,
    [
      `${label(stack)} mutation sweep, ${new Date().toISOString()}`,
      `HEAD: ${git('rev-parse', 'HEAD')}`,
      `base: ${base}`,
      'git status:',
      git('status', '--short', '--branch'),
      `scope: ${scope.join(', ')}`,
      `memory: ${cap}`,
      `command (in ${stack.root || '.'}): ${argv.join(' ')}`,
      '',
      '',
    ].join('\n')
  )
  const run = spawnSync(argv[0], argv.slice(1), { cwd: rootDir, stdio: ['ignore', log, log] })
  const exit = run.error?.message ?? run.status ?? run.signal
  writeSync(log, `\nexit: ${exit}\n`)
  closeSync(log)

  if (!existsSync(reportPath)) throw new Stop(`${label(stack)}: the engine wrote no report at ${reportName} (exit: ${exit}). Its output is in ${logPath}.`)
  const report = readFileSync(reportPath, 'utf8')
  const total = stack.mutants(report)
  if (!total) throw new Stop(`${label(stack)}: the engine made no mutants over ${count(files.length, 'file')}, so nothing was measured. Its output is in ${logPath}.`)
  const survivors = stack.survivors(report, files, read).map((survivor) => ({
    ...survivor,
    file: existsSync(join(rootDir, survivor.file)) ? relative(projectDir, join(rootDir, survivor.file)) : survivor.file,
  }))
  writeFileSync(survivorsPath, survivors.map(({ file, line, mutator, replacement, status }) => `${file}:${line}\t${mutator} → ${replacement}\t${status}\n`).join(''))
  const lines = [
    `${label(stack)}: ${count(total, 'mutant')}, ${total - survivors.length} detected, ${survivors.length} undetected`,
    `  survivors: ${survivorsPath}`,
    `  report: ${reportName}`,
    `  log: ${logPath}`,
  ]
  if (run.status !== 0) lines.push(`  the engine exited ${exit}; the report was read all the same`)
  if (cap.startsWith('unbounded')) lines.push(`  warning: ${cap}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

/**
 * [command] inside a memory-capped systemd scope of [memory], with a line saying so. Without the
 * cap, an engine that grows takes down the whole user slice — the terminal and the session in
 * it — rather than failing alone.
 */
function capped(command, memory) {
  if (process.env.SKRYMER_AI_MUTATION_CAP === 'off') return { argv: command, cap: 'unbounded (SKRYMER_AI_MUTATION_CAP=off)' }
  const scope = ['systemd-run', '--user', '--scope', '--quiet', '-p', `MemoryMax=${memory}`, '-p', 'MemorySwapMax=0', '--']
  if (process.platform === 'linux' && spawnSync(scope[0], [...scope.slice(1), 'true'], { stdio: 'ignore' }).status === 0) {
    return { argv: [...scope, ...command], cap: `capped at ${memory} in a systemd scope` }
  }
  return { argv: command, cap: 'unbounded: no systemd user manager here, so only the engine’s own config caps its memory' }
}

const label = (stack) => `${stack.pack} (${stack.root || '.'})`
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`
const trimRoot = (root) => root.replace(/^\.\/+/, '').replace(/\/+$/, '').replace(/^\.$/, '')

if (process.argv[1] === SCRIPT) {
  main(process.argv.slice(2), process.cwd()).catch((error) => {
    process.stdout.write(error instanceof Stop ? `STOP: ${error.message}\n` : `mutation sweep failed: ${error.stack}\n`)
    process.exitCode = 1
  })
}
