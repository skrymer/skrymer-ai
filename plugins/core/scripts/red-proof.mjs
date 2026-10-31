#!/usr/bin/env node
/**
 * Proves a fix is pinned: applies the mutation that undoes it to a throwaway copy of the
 * project, runs the named test there, and records the red the resolutions pack cites. The
 * source tree is never touched.
 *
 *   node red-proof.mjs <label> --file <path> --find <text> --replace <text> --test <name>
 *
 * The mutation replaces text that is in the file exactly once. The test runs through the `test`
 * command of the stack whose root holds the file, with `{test}` standing for the name. A run
 * where the test fails is the red: its log, with the HEAD and `git status` it ran on, goes to
 * `skrymer-ai/red/<label>.log` in the repo's git dir, and the script prints the FIXED cell that
 * cites it. A test that passes with the mutation applied doesn't pin the fix, and the run fails.
 *
 * The copy holds what git tracks and what it would track, and links each `node_modules` in the
 * project root and the stack root, so a JavaScript stack's tests can run without a reinstall.
 */

import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadConfig } from './config.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
const PLUGIN_ROOT = join(dirname(SCRIPT), '..')

class Stop extends Error {}

async function main(argv, projectDir) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { file: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, test: { type: 'string' } },
  })
  const { file, find, replace, test } = values
  if (positionals.length !== 1 || [file, find, replace, test].includes(undefined)) {
    throw new Stop('usage: red-proof.mjs <label> --file <path> --find <text> --replace <text> --test <name>')
  }
  const [label] = positionals
  if (!/^[\w.-]+$/.test(label)) throw new Stop(`"${label}" is not a label: use letters, digits, dots and dashes, such as CR-1.`)
  const { config, errors } = await loadConfig(projectDir, PLUGIN_ROOT)
  if (errors) throw new Stop(`the project config has errors:\n${errors.map((error) => `  ${error}`).join('\n')}`)
  const stack = (config?.test ?? []).filter(({ root }) => !root || file.startsWith(`${root}/`)).sort((a, b) => b.root.length - a.root.length)[0]
  if (!stack) throw new Stop(`no stack whose root holds ${file} has a test command. A pack's \`test\`, or a stack's own, names one.`)
  const source = readFileSync(resolve(projectDir, file), 'utf8')
  const times = source.split(find).length - 1
  if (times !== 1) throw new Stop(`"${find}" is in ${file} ${times} times; a mutation replaces text that is there exactly once.`)

  const top = git(projectDir, 'rev-parse', '--show-toplevel')
  const copy = mkdtempSync(join(tmpdir(), 'red-proof-'))
  try {
    for (const path of git(top, 'ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(Boolean)) {
      if (!existsSync(join(top, path))) continue
      mkdirSync(dirname(join(copy, path)), { recursive: true })
      copyFileSync(join(top, path), join(copy, path))
    }
    for (const dir of new Set(['', stack.root])) {
      const modules = join(top, dir, 'node_modules')
      if (existsSync(modules) && !existsSync(join(copy, dir, 'node_modules'))) symlinkSync(modules, join(copy, dir, 'node_modules'), 'dir')
    }
    const inTop = resolve(projectDir, file).slice(top.length + 1)
    writeFileSync(join(copy, inTop), source.replace(find, replace))

    const [command, ...args] = stack.run.map((word) => word.replaceAll('{test}', test))
    const out = resolve(top, git(projectDir, 'rev-parse', '--git-path', 'skrymer-ai/red'))
    mkdirSync(out, { recursive: true })
    const logPath = join(out, `${label}.log`)
    const log = openSync(logPath, 'w')
    writeSync(log, `HEAD: ${git(top, 'rev-parse', 'HEAD')}\ngit status:\n${git(top, 'status', '--short') || '(clean)'}\nmutation: ${file}: "${find}" → "${replace}"\n$ ${[command, ...args].join(' ')}\n`)
    // A runner started inside another, as this script's tests start it, would skip its files.
    const { NODE_TEST_CONTEXT, ...env } = process.env
    const run = spawnSync(command, args, { cwd: join(copy, stack.root), env, stdio: ['ignore', log, log] })
    writeSync(log, `exit: ${run.error?.message ?? run.status ?? run.signal}\n`)
    closeSync(log)
    if (run.status === 0) throw new Stop(`"${test}" passes with the mutation applied, so it doesn't pin the fix. Log: ${logPath}`)
    if (run.error) throw new Stop(`the test command could not start (${run.error.message}). Log: ${logPath}`)
    process.stdout.write(`red: "${test}" fails against the mutant.\nFIXED: ${test} — red ${logPath}\n`)
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}

function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) throw new Stop(`git ${args[0]}: ${run.stderr.trim().split('\n').at(-1)}`)
  return run.stdout.replace(/\n$/, '')
}

if (process.argv[1] === SCRIPT) {
  main(process.argv.slice(2), process.cwd()).catch((error) => {
    process.stdout.write(error instanceof Stop ? `STOP: ${error.message}\n` : `red-proof failed: ${error.stack}\n`)
    process.exitCode = 1
  })
}
