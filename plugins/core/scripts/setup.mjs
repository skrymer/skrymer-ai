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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CONFIG_PATH, PACK_FILE, availablePacks, loadConfig, packDir } from './config.mjs'

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
  const start = before.indexOf(SECTION_START)
  const end = before.indexOf(SECTION_END, start)
  if (start === -1 || end === -1) return `${before.trimEnd()}\n\n${WORKFLOW_SECTION}`
  return `${before.slice(0, start)}${WORKFLOW_SECTION.trimEnd()}${before.slice(end + SECTION_END.length)}`
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
  const stacks = detectStacks(projectDir, files, await loadPacks())
  const targets = {
    // An existing config is the project's own code; `check` reports what it lacks instead.
    [CONFIG_PATH]: (before) => before ?? projectConfig(stacks),
    [SETTINGS_PATH]: (before) => settings(stacks, before),
    'CLAUDE.md': claudeMd,
    'CONTEXT.md': (before) => before ?? `# ${basename(projectDir)}\n\n## Language\n`,
    // Keeps an empty ADR directory in git; one that already holds decisions needs none.
    [join('docs', 'adr', '.gitkeep')]: (before) => before ?? (existsSync(join(projectDir, 'docs', 'adr')) ? null : ''),
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
  return { stacks: stacks.map(({ pack, roots }) => ({ pack, roots })), notes, unreadable, changes }
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
function render({ stacks, notes, unreadable, changes }) {
  const lines = ['Stacks found:', ...(stacks.length ? stacks.map(({ pack, roots }) => `- ${pack}: ${roots.join(', ')}`) : ['- none']), '']
  if (notes.length) lines.push(`Add to ${CONFIG_PATH} by hand:`, ...notes.map((note) => `- ${note}`), '')
  if (unreadable.length) lines.push('Cannot read, so not planned:', ...unreadable.map(({ path, code }) => `- ${path} (${code})`), '')
  const head = `${lines.join('\n')}\n`
  return changes.length ? `${head}${changes.map(diff).join('\n')}` : `${head}Nothing to change: the project is set up.\n`
}

function apply(projectDir, { changes }) {
  const written = changes.filter(({ path }) => !PROTECTED.has(path))
  for (const { path, after } of written) {
    if (after === null) {
      rmSync(join(projectDir, path))
      continue
    }
    mkdirSync(dirname(join(projectDir, path)), { recursive: true })
    writeFileSync(join(projectDir, path), after)
  }
  const left = changes.filter(({ path }) => PROTECTED.has(path))
  const lines = written.length ? [`Wrote ${written.map(({ path }) => path).join(', ')}.`] : []
  for (const { path } of left) {
    lines.push(`Left ${path}: Claude Code protects it, so write it with the Write tool and the content \`plan --json\` gives.`)
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
  const { notes, unreadable, changes } = await plan(projectDir)
  const { errors = [] } = await loadConfig(projectDir, PLUGIN_ROOT)
  return [
    ...[...errors, ...notes].map((problem) => `${CONFIG_PATH}: ${problem}`),
    ...unreadable.map(({ path, code }) => `${path}: setup cannot read it (${code}).`),
    ...changes.map(({ path, action }) => `${path}: setup would ${action} it.`),
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
