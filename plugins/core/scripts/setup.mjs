#!/usr/bin/env node
/**
 * The planner `/core:setup` drives. It detects the project's stacks from each available
 * pack's `detect` data and computes the files adopting the workflow would create or change.
 *
 *   setup.mjs plan [--json]   prints the stacks found and the change to each file
 *   setup.mjs apply           writes those changes, except to the protected settings
 *   setup.mjs check           reports drift without writing, and exits 1 when there is any
 *
 * It runs in the project's root, the directory the session works in.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CONFIG_PATH, PACK_FILE, STAGED, availablePacks, loadConfig, mergeConfig, packDir } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MARKETPLACE = 'skrymer-ai'
const MARKETPLACE_SOURCE = { source: 'github', repo: 'skrymer/skrymer-ai' }
const SETTINGS_PATH = join('.claude', 'settings.json')

/** Files Claude Code lets no script write; the session writes them with a tool the user approves (ADR 0009). */
const PROTECTED = new Set([SETTINGS_PATH])

const SECTION_START = '<!-- skrymer-ai:start -->'
const SECTION_END = '<!-- skrymer-ai:end -->'

/** The CLAUDE.md section setup owns: everything between its markers is rewritten on each run. */
const WORKFLOW_SECTION = `${SECTION_START}
## Workflow

This project follows the skrymer-ai workflow. Its specifics (stack roots, TDD-gated trees, skill rules) live in \`.claude/skrymer-ai.config.mjs\`, never in the plugins.

- Build test-first, one red-green cycle at a time (\`/core:tdd\`). The TDD gate judges every write to a gated file.
- Settle a plan by talking it through (\`/core:grill-with-docs\`), not with plan mode. Terms go in \`CONTEXT.md\`, decisions in \`docs/adr/\`.
- Turn a settled plan into a PRD (\`/core:to-prd\`) and vertical-slice issues (\`/core:to-issues\`).
- Fix a bug by reproducing it first (\`/core:diagnose\`), and hand work over with \`/core:handoff\`.
${SECTION_END}
`

/**
 * The committed hook and CI workflow can't call into the plugin, whose path differs on every
 * machine and which CI doesn't have, so each stack root's commands are baked into them. Each
 * holds a generated block between these markers, rewritten on each run.
 */
const BLOCK_START = '# skrymer-ai:start'
const BLOCK_END = '# skrymer-ai:end'
const HOOKS_DIR = '.githooks'
const HOOK_PATH = join(HOOKS_DIR, 'pre-commit')
const HOOK_LINE = `sh ${HOOK_PATH}`
const WORKFLOW_PATH = join('.github', 'workflows', 'skrymer-ai.yml')

const HOOK_HEADER = `#!/bin/sh
# The skrymer-ai pre-commit hook: each stack root with staged files runs its lint.
# /core:setup rewrites the lines between the skrymer-ai markers; edits outside them are kept.
`

const workflowHeader = (branch) => `# The skrymer-ai checks: one job per stack root, running its check.
# /core:setup rewrites the jobs between the skrymer-ai markers; edits outside them are kept.
name: skrymer-ai

on:
  push:
    branches: [${branch}]
  pull_request:

jobs:
`

/** A project's own Probity setup, which would judge each write a second time (ADR 0005). */
const PROBITY_PACKAGE = '@nizos/probity'
const PROBITY_CONFIG = /^probity\.config\.[cm]?[jt]s$/
const PROBITY_COMMAND = /\bprobity\b/

/** A problem in the project that stops the run, worded for the person running setup. */
class SetupError extends Error {}

/** A file that exists but cannot be read, as when Claude Code's Bash sandbox hides a protected one. */
class Unreadable extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

/** Directories no stack root sits inside. */
const SKIPPED = new Set(['node_modules', 'build', 'dist', 'target', 'out'])

/** Each available pack's name and default rule fragment. */
async function loadPacks() {
  const packs = []
  for (const name of availablePacks(PLUGIN_ROOT)) {
    const fragment = (await import(pathToFileURL(join(packDir(PLUGIN_ROOT, name), PACK_FILE)).href)).default
    packs.push({ name, fragment })
  }
  return packs
}

/** Every file under [dir], as project-relative paths, outside hidden and build directories. */
function projectFiles(projectDir, dir = projectDir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name.startsWith('.') || SKIPPED.has(entry.name) ? [] : projectFiles(projectDir, path)
    return entry.isFile() ? [relative(projectDir, path)] : []
  })
}

/** The stacks found in [projectDir]: each pack whose `detect` matches a file, with that file's directory as a root. */
function detectStacks(projectDir, files, packs) {
  const stacks = []
  for (const { name, fragment } of packs) {
    const detect = fragment.detect
    if (!detect) continue
    const roots = files
      .filter((file) => detect.files.includes(basename(file)))
      .filter((file) => !detect.contains || detect.contains.test(readFileSync(join(projectDir, file), 'utf8')))
      .map((file) => dirname(file))
      .sort()
    if (roots.length) stacks.push({ pack: name, roots, lsp: fragment.lsp ?? [] })
  }
  return stacks
}

function projectConfig(stacks) {
  const entries = stacks.map(({ pack, roots }) => `    '${pack}': { roots: [${roots.map((root) => `'${root}'`).join(', ')}] },`)
  return ["import { defineConfig } from 'skrymer-ai'", '', 'export default defineConfig({', '  stacks: {', ...entries, '  },', '})', ''].join('\n')
}

/**
 * [before], the project's settings or null, with the marketplace known, core, the packs and
 * their code-intelligence plugins enabled, and no Probity hook.
 */
function settings(stacks, before) {
  const current = before === null ? {} : JSON.parse(before)
  const plugins = ['core', ...stacks.map(({ pack }) => pack)].map((plugin) => `${plugin}@${MARKETPLACE}`)
  plugins.push(...new Set(stacks.flatMap(({ lsp }) => lsp)))
  const merged = {
    ...current,
    hooks: withoutProbity(current.hooks),
    extraKnownMarketplaces: { ...current.extraKnownMarketplaces, [MARKETPLACE]: { source: MARKETPLACE_SOURCE } },
    enabledPlugins: { ...current.enabledPlugins, ...Object.fromEntries(plugins.map((plugin) => [plugin, true])) },
  }
  return JSON.stringify(merged) === JSON.stringify(current) ? before : `${JSON.stringify(merged, null, 2)}\n`
}

/** Settings [hooks] without the groups that run Probity, or undefined when none are left. */
function withoutProbity(hooks) {
  if (!hooks) return hooks
  const events = Object.entries(hooks)
    .map(([event, groups]) => [
      event,
      groups
        .map((group) => ({ ...group, hooks: group.hooks.filter((hook) => !PROBITY_COMMAND.test(hook.command ?? '')) }))
        .filter((group) => group.hooks.length),
    ])
    .filter(([, groups]) => groups.length)
  return events.length ? Object.fromEntries(events) : undefined
}

/** [before], a package.json, without Probity among its dependencies. */
function packageJson(before) {
  const pkg = JSON.parse(before)
  for (const key of ['dependencies', 'devDependencies']) delete pkg[key]?.[PROBITY_PACKAGE]
  const after = `${JSON.stringify(pkg, null, 2)}\n`
  return JSON.stringify(pkg) === JSON.stringify(JSON.parse(before)) ? before : after
}

/** The project config's own `stacks`, or {} when it does not load. */
async function listedStacks(projectDir) {
  try {
    return (await import(pathToFileURL(join(projectDir, CONFIG_PATH)).href)).default?.stacks ?? {}
  } catch {
    return {}
  }
}

/** For each detected root an existing config does not list, the stacks entry that would list it. */
async function unlistedRoots(projectDir, stacks) {
  if (!existsSync(join(projectDir, CONFIG_PATH))) return []
  const listed = await listedStacks(projectDir)
  return stacks.flatMap(({ pack, roots }) => {
    const current = Array.isArray(listed[pack]?.roots) ? listed[pack].roots : []
    const missing = roots.filter((root) => !current.includes(root))
    if (!missing.length) return []
    const all = [...new Set([...missing, ...current])].sort()
    const where = missing.map((root) => `"${root}"`).join(', ')
    return [`${pack} is detected in ${where}${current.length ? ' too' : ''}. List it: '${pack}': { roots: [${all.map((root) => `'${root}'`).join(', ')}] }`]
  })
}

/** [before], CLAUDE.md or null, with the workflow section in place of any older copy, or appended. */
function claudeMd(before) {
  if (before === null) return WORKFLOW_SECTION
  return replaceSection(before, WORKFLOW_SECTION, SECTION_START, SECTION_END) ?? `${before.trimEnd()}\n\n${WORKFLOW_SECTION}`
}

/** [before] with the lines from the [start] marker to the [end] marker replaced by [section], or null when it holds no such pair. */
function replaceSection(before, section, start, end) {
  const lines = before.split('\n')
  const from = lines.findIndex((line) => line.trim() === start)
  const to = lines.findIndex((line, i) => i > from && line.trim() === end)
  if (from === -1 || to === -1) return null
  return [...lines.slice(0, from), section.replace(/\n$/, ''), ...lines.slice(to + 1)].join('\n')
}

/**
 * The merged config the hook and workflow are rendered from: the project's own, or, before it
 * has one, the config setup is about to write for the detected [stacks]. Null when it has errors,
 * which `check` reports.
 */
async function mergedConfig(projectDir, stacks) {
  if (existsSync(join(projectDir, CONFIG_PATH))) return (await loadConfig(projectDir, PLUGIN_ROOT)).config ?? null
  const project = { stacks: Object.fromEntries(stacks.map(({ pack, roots }) => [pack, { roots }])) }
  return (await mergeConfig(projectDir, PLUGIN_ROOT, project)).config ?? null
}

/** [before], the pre-commit hook or null, with a generated block running each root's [lint] when it has staged files. */
function hook(before, lint) {
  if (!lint.length) return before
  const block = [BLOCK_START, ...lint.flatMap(lintLines), BLOCK_END, ''].join('\n')
  if (before === null) return `${HOOK_HEADER}${block}`
  return replaceSection(before, block, BLOCK_START, BLOCK_END) ?? `${before.trimEnd()}\n${block}`
}

/**
 * The hook's lines for one root: when it has staged files, its lint commands in turn, run in
 * the root, each stopping the commit when it fails. A command ending in `{staged}` gets the
 * root's staged files, relative to the root.
 */
function lintLines({ pack, root, run }) {
  const inRoot = (command) => (root ? `(cd ${sh(root)} && ${command})` : command)
  const commands = run.map((command) => {
    if (command.at(-1) !== STAGED) return `  ${inRoot(words(command))} || exit 1`
    const staged = `git diff --cached --name-only --diff-filter=ACMR -z${root ? ` --relative=${sh(root)}` : ''}`
    return `  ${staged} | ${inRoot(`xargs -0 -r ${words(command.slice(0, -1))}`)} || exit 1`
  })
  return [
    `if ! git diff --cached --quiet --diff-filter=ACMR -- ${sh(root || '.')}; then`,
    `  echo ${sh(`skrymer-ai: ${pack} lint in ${root || 'the project root'}`)}`,
    ...commands,
    'fi',
  ]
}

/** [before], the CI workflow or null, with a generated job per root of [jobs]; one without markers is left, and [hand] says why. */
function workflow(before, jobs, branch, hand) {
  if (!jobs.length) return before
  const block = [`  ${BLOCK_START}`, ...jobs.flatMap(jobLines), `  ${BLOCK_END}`, ''].join('\n')
  if (before === null) return `${workflowHeader(branch)}${block}`
  const after = replaceSection(before, block, BLOCK_START, BLOCK_END)
  if (after === null) hand.push({ path: WORKFLOW_PATH, todo: `put the skrymer-ai jobs between "${BLOCK_START}" and "${BLOCK_END}" lines under jobs:, or delete the file, then run setup again.` })
  return after ?? before
}

/** A root's CI job: checkout, its pack's setup steps, then its check, each command a step run in the root. */
function jobLines({ pack, root, run, steps }) {
  const id = root ? `${pack}-${root.replace(/[^A-Za-z0-9_-]/g, '-')}` : pack
  return [
    `  ${id}:`,
    `    name: ${scalar(`${pack} check${root ? ` in ${root}` : ''}`)}`,
    '    runs-on: ubuntu-latest',
    ...(root ? ['    defaults:', '      run:', `        working-directory: ${scalar(root)}`] : []),
    '    steps:',
    ...[{ uses: 'actions/checkout@v4' }, ...steps, ...run.map((command) => ({ run: words(command) }))].flatMap(stepLines),
  ]
}

/** A workflow step, `{ uses?, with?, run? }`, as YAML lines in a job's steps. */
function stepLines(step) {
  const [first, ...rest] = Object.entries(step).flatMap(([key, value]) =>
    typeof value === 'object' ? [`${key}:`, ...Object.entries(value).map(([field, v]) => `  ${field}: ${scalar(v)}`)] : [`${key}: ${scalar(value)}`]
  )
  return [`      - ${first}`, ...rest.map((line) => `        ${line}`)]
}

/** [value] as a YAML scalar: plain when YAML reads it back as the same string, else double-quoted. */
function scalar(value) {
  if (typeof value === 'number') return String(value)
  const plain = /^[\w./@-][^'"{}[\],&*!|>%`#]*$/.test(value) && !/: |:$|\s$/.test(value)
  const other = /^(?:true|false|yes|no|on|off|null|~|[-+]?[\d.]+)$/i.test(value)
  return plain && !other ? value : JSON.stringify(value)
}

/** [word] as the shell reads it back: bare when it is safe, else single-quoted. */
const sh = (word) => (/^[\w./=:@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`)
const words = (command) => command.map(sh).join(' ')

/** A reader of the files under [root] in [projectDir]: a path relative to it maps to the file's text, or null. */
const readerIn = (projectDir, root) => (path) => {
  try {
    return readFileSync(join(projectDir, root, path), 'utf8')
  } catch {
    return null
  }
}

/** `git [args]` in [cwd], kept to its output, or null when git fails. */
function gitIn(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

/** origin's default branch, as `origin/HEAD` names it, else main. */
const defaultBranch = (projectDir) => gitIn(projectDir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')?.replace(/^origin\//, '') || 'main'

/**
 * How the hook comes to run in this clone: the `core.hooksPath` setting setup plans, or, for a
 * project on husky or a hooks path of its own, which setup leaves alone, the line to add to
 * that hook. Nothing outside a git repo.
 */
function activation(projectDir) {
  if (gitIn(projectDir, 'rev-parse', '--is-inside-work-tree') !== 'true') return { git: [], hand: [] }
  const current = gitIn(projectDir, 'config', '--local', '--get', 'core.hooksPath')
  const husky = existsSync(join(projectDir, '.husky'))
  if (!husky && (current === null || current.replace(/\/+$/, '') === HOOKS_DIR)) {
    return { git: current === null ? [{ key: 'core.hooksPath', before: null, after: HOOKS_DIR }] : [], hand: [] }
  }
  const theirs = join(husky ? '.husky' : current, 'pre-commit')
  let runsOurs
  try {
    runsOurs = read(projectDir, theirs)?.includes(HOOK_PATH)
  } catch {}
  return { git: [], hand: runsOurs ? [] : [{ path: theirs, todo: `add the line that runs the skrymer-ai hook: ${HOOK_LINE}` }] }
}

/** [path]'s content in [projectDir], or null when it does not exist. */
function read(projectDir, path) {
  const file = join(projectDir, path)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error
    throw new Unreadable(error.code)
  }
}

/**
 * The stacks found in [projectDir] and the change to each file. A file's target maps its
 * content, or null when it does not exist, to the content it should have, or null to delete it.
 */
async function plan(projectDir) {
  const files = projectFiles(projectDir)
  const packs = await loadPacks()
  const stacks = detectStacks(projectDir, files, packs)
  const config = await mergedConfig(projectDir, stacks)
  const lint = config?.lint ?? []
  const jobs = (config?.check ?? []).map((stack) => {
    const ci = packs.find(({ name }) => name === stack.pack)?.fragment.ci
    return { ...stack, steps: ci ? ci(stack.root, readerIn(projectDir, stack.root)) : [] }
  })
  const github = config?.tracker.kind === 'github'
  const skipped = jobs.length && config && !github ? [`${WORKFLOW_PATH}: the workflow is GitHub Actions only, and tracker.kind is "${config.tracker.kind}".`] : []
  const { git, hand } = lint.length ? activation(projectDir) : { git: [], hand: [] }
  const targets = {
    // An existing config is the project's own code; `check` reports what it lacks instead.
    [CONFIG_PATH]: (before) => before ?? projectConfig(stacks),
    [SETTINGS_PATH]: (before) => settings(stacks, before),
    'CLAUDE.md': claudeMd,
    'CONTEXT.md': (before) => before ?? `# ${basename(projectDir)}\n\n## Language\n`,
    // Keeps an empty ADR directory in git; one that already holds decisions needs none.
    [join('docs', 'adr', '.gitkeep')]: (before) => before ?? (existsSync(join(projectDir, 'docs', 'adr')) ? null : ''),
    [HOOK_PATH]: (before) => hook(before, lint),
    [WORKFLOW_PATH]: (before) => (github ? workflow(before, jobs, defaultBranch(projectDir), hand) : before),
  }
  for (const file of files) {
    if (PROBITY_CONFIG.test(basename(file))) targets[file] = () => null
    else if (basename(file) === 'package.json') targets[file] = (before) => (before.includes(PROBITY_PACKAGE) ? packageJson(before) : before)
  }
  const unreadable = []
  const changes = Object.entries(targets)
    .flatMap(([path, target]) => {
      let before
      try {
        before = read(projectDir, path)
      } catch (error) {
        if (!(error instanceof Unreadable)) throw error
        unreadable.push({ path, code: error.code })
        return []
      }
      try {
        return [{ path, before, after: target(before) }]
      } catch (error) {
        if (error instanceof SyntaxError) throw new SetupError(`${path} is not valid JSON (${error.message}). Fix it, then run setup again.`)
        throw error
      }
    })
    .filter(({ before, after }) => before !== after)
    .map(({ path, before, after }) => ({ path, action: before === null ? 'create' : after === null ? 'delete' : 'update', before, after }))
  const notes = await unlistedRoots(projectDir, stacks)
  return { stacks: stacks.map(({ pack, roots }) => ({ pack, roots })), notes, unreadable, changes, git, hand, skipped }
}

/** [change] as a unified diff, from git so a person reads the format they know. */
function diff({ path, before, after }) {
  const dir = mkdtempSync(join(tmpdir(), 'skrymer-ai-setup-'))
  const side = (prefix, content) => {
    if (content === null) return '/dev/null'
    mkdirSync(dirname(join(dir, prefix, path)), { recursive: true })
    writeFileSync(join(dir, prefix, path), content)
    return join(prefix, path)
  }
  const args = ['-c', 'core.quotepath=off', 'diff', '--no-index', '--no-color', '--no-ext-diff', '--no-prefix', '--', side('a', before), side('b', after)]
  const { stdout } = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  rmSync(dir, { recursive: true })
  return stdout.slice(stdout.indexOf('\n--- ') + 1)
}

/** The plan as a person reads it: the stacks found, what to add to the config, and a diff of each change. */
function render({ stacks, notes, unreadable, changes, git, hand, skipped }) {
  const lines = ['Stacks found:', ...(stacks.length ? stacks.map(({ pack, roots }) => `- ${pack}: ${roots.join(', ')}`) : ['- none']), '']
  if (notes.length) lines.push(`Add to ${CONFIG_PATH} by hand:`, ...notes.map((note) => `- ${note}`), '')
  if (hand.length) lines.push('By hand:', ...hand.map(({ path, todo }) => `- ${path}: ${todo}`), '')
  if (unreadable.length) lines.push('Cannot read, so not planned:', ...unreadable.map(({ path, code }) => `- ${path} (${code})`), '')
  if (skipped.length) lines.push('Skipped:', ...skipped.map((skip) => `- ${skip}`), '')
  if (git.length) lines.push('Git config:', ...git.map(({ key, before, after }) => `- ${key}: ${before ?? 'unset'} → ${after}`), '')
  const head = `${lines.join('\n')}\n`
  if (changes.length) return `${head}${changes.map(diff).join('\n')}`
  return git.length ? head : `${head}Nothing to change: the project is set up.\n`
}

function apply(projectDir, { changes, git }) {
  const written = changes.filter(({ path }) => !PROTECTED.has(path))
  for (const { path, after } of written) {
    if (after === null) {
      rmSync(join(projectDir, path))
      continue
    }
    mkdirSync(dirname(join(projectDir, path)), { recursive: true })
    writeFileSync(join(projectDir, path), after)
    if (path === HOOK_PATH) chmodSync(join(projectDir, path), 0o755)
  }
  const left = changes.filter(({ path }) => PROTECTED.has(path))
  const lines = written.length ? [`Wrote ${written.map(({ path }) => path).join(', ')}.`] : []
  for (const { path } of left) {
    lines.push(`Left ${path}: Claude Code protects it, so write it with the Write tool and the content \`plan --json\` gives.`)
  }
  for (const { key, after } of git) {
    const set = spawnSync('git', ['config', '--local', key, after], { cwd: projectDir, encoding: 'utf8' })
    if (set.status === 0) lines.push(`Set ${key} to ${after}.`)
    else lines.push(`Could not set ${key} (${set.stderr.trim().split('\n').at(-1)}): run \`git config --local ${key} ${after}\`.`)
  }
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`)
}

/** The version a [range] such as `^3`, `~0.8.0` or `>=3` names first, as [major, minor], or null. */
function versionIn(range) {
  const match = /(\d+)(?:\.(\d+))?/.exec(range)
  return match && [Number(match[1]), Number(match[2] ?? 0)]
}

/** Whether [version] is inside a pack's caret [range]: the same major, or the same minor below 1.0. */
function inRange([major, minor], range) {
  const [wantMajor, wantMinor] = versionIn(range)
  return major === wantMajor && (major > 0 || minor === wantMinor)
}

/**
 * For each listed stack root, each package a pack's `versions` targets that the root's
 * package.json declares outside that range. The installed copy's version wins over the
 * declared range, since a range like `>=3` says little about what runs.
 */
async function staleVersions(projectDir) {
  const listed = await listedStacks(projectDir)
  const stale = []
  for (const { name, fragment } of await loadPacks()) {
    const roots = listed[name]?.roots
    if (!fragment.versions || !Array.isArray(roots)) continue
    for (const root of roots) {
      const manifest = join(root, 'package.json')
      let declared
      try {
        const json = JSON.parse(readFileSync(join(projectDir, manifest), 'utf8'))
        declared = { ...json.dependencies, ...json.devDependencies }
      } catch {
        continue
      }
      for (const [pkg, range] of Object.entries(fragment.versions)) {
        if (typeof declared[pkg] !== 'string') continue
        let found = declared[pkg].match(/\d+(?:\.\d+){0,2}/)?.[0]
        try {
          found = JSON.parse(readFileSync(join(projectDir, root, 'node_modules', pkg, 'package.json'), 'utf8')).version ?? found
        } catch {}
        if (!found || inRange(versionIn(found), range)) continue
        const shown = found.split('.').concat(['0', '0']).slice(0, 3).join('.')
        stale.push(`${manifest}: ${name} targets ${pkg} ${range}, but ${root} has ${shown}, so its skills may be out of date.`)
      }
    }
  }
  return stale
}

/** Each way [projectDir] has drifted from the workflow: config errors, unlisted roots, pending changes and stale packs. */
async function drift(projectDir) {
  const { notes, unreadable, changes, git, hand } = await plan(projectDir)
  const { errors = [] } = await loadConfig(projectDir, PLUGIN_ROOT)
  return [
    ...[...errors, ...notes].map((problem) => `${CONFIG_PATH}: ${problem}`),
    ...unreadable.map(({ path, code }) => `${path}: setup cannot read it (${code}).`),
    ...changes.map(({ path, action }) => `${path}: setup would ${action} it.`),
    ...git.map(({ key, before, after }) => `${key}: setup would set it to ${after}; it is ${before === null ? 'unset' : `"${before}"`}.`),
    ...hand.map(({ path, todo }) => `${path}: ${todo}`),
    ...(await staleVersions(projectDir)),
  ]
}

async function check(projectDir) {
  const problems = await drift(projectDir)
  if (!problems.length) {
    process.stdout.write('skrymer-ai: no drift.\n')
    return
  }
  const lines = ['skrymer-ai: the project has drifted from the workflow. Run /core:setup to fix what it can.', ...problems.map((p) => `- ${p}`)]
  process.stdout.write(`${lines.join('\n')}\n`)
  process.exitCode = 1
}

async function main(command, projectDir) {
  if (command === 'plan') {
    const result = await plan(projectDir)
    process.stdout.write(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : render(result))
  } else if (command === 'apply') apply(projectDir, await plan(projectDir))
  else if (command === 'check') await check(projectDir)
  else throw new SetupError('usage: setup.mjs plan [--json] | apply | check')
}

try {
  await main(process.argv[2], process.cwd())
} catch (error) {
  if (!(error instanceof SetupError)) throw error
  process.stderr.write(`skrymer-ai: ${error.message}\n`)
  process.exitCode = 1
}
