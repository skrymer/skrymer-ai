/**
 * Loads a project's `.claude/skrymer-ai.config.mjs` and merges it over the default rule
 * fragments of the packs it enables. Every hook engine reads only the merged view.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { basename, isAbsolute, join, matchesGlob, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CONFIG_PATH = join('.claude', 'skrymer-ai.config.mjs')
const PACK_FILE = 'skrymer-ai.pack.mjs'

/** The roles the process skills speak of, each mapped by default to a label of the same name. */
const ROLES = ['bug', 'enhancement', 'needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix']
const TRACKERS = ['github', 'local']
const DEFAULT_LABELS = Object.fromEntries(ROLES.map((role) => [role, role]))

/** Lets a project config `import { defineConfig } from 'skrymer-ai'` without installing anything. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'skrymer-ai') return { url: import.meta.url, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

export function defineConfig(config) {
  return config
}

/** Whether [file], an absolute path, is inside [projectDir] and matches one of the TDD [globs]. */
export function isTddGated(projectDir, file, globs) {
  const inProject = relative(projectDir, file)
  if (inProject.startsWith('..') || isAbsolute(inProject)) return false
  return globs.some((glob) => matchesGlob(inProject, glob))
}

/**
 * `{ config }` with the merged view, `{ config: null }` when the project has no config, or
 * `{ errors }` naming each problem in words a person can act on. A bad `tracker` or `domain`
 * block only describes the project to the session, so it lands in `config.contextErrors`
 * instead and leaves every gate and rule in force.
 */
export async function loadConfig(projectDir, pluginRoot) {
  const file = join(projectDir, CONFIG_PATH)
  if (!existsSync(file)) return { config: null }
  let project
  try {
    project = (await import(pathToFileURL(file).href)).default
  } catch (error) {
    return { errors: [`${CONFIG_PATH} does not load: ${error.message}`] }
  }
  if (typeof project !== 'object' || project === null) {
    return { errors: [`${CONFIG_PATH}: expected \`export default defineConfig({ … })\`.`] }
  }
  const errors = []
  const files = []
  const prompts = []
  const tdd = []
  const testCommands = []
  const format = []
  const duplication = []
  for (const [pack, stack] of Object.entries(project.stacks ?? {})) {
    const roots = stack?.roots
    if (!Array.isArray(roots)) {
      errors.push(`stacks.${pack}.roots: expected a list of directories.`)
      continue
    }
    const dir = packDir(pluginRoot, pack)
    if (!dir) {
      errors.push(`stacks: there is no pack "${pack}". Packs available: ${availablePacks(pluginRoot).join(', ')}.`)
      continue
    }
    const fragment = (await import(pathToFileURL(join(dir, PACK_FILE)).href)).default
    testCommands.push(...(fragment.tdd?.testCommands ?? []))
    prompts.push(...(fragment.skills?.prompts ?? []))
    const groups = stack.format === undefined ? fragment.format : validFormat(stack.format, `stacks.${pack}.format`, errors)
    for (const root of roots) {
      if (!isDirectory(join(projectDir, root))) {
        errors.push(`stacks.${pack}.roots: "${root}" does not exist in the project.`)
        continue
      }
      for (const rule of fragment.skills?.files ?? []) {
        files.push({ ...rule, path: new RegExp(`(^|/)${rootPrefix(root)}(?:${rule.path.source})`) })
      }
      for (const glob of fragment.tdd?.files ?? []) tdd.push(`${globPrefix(root)}${glob}`)
      if (groups?.length) format.push({ root: trimRoot(root), groups })
      if (Array.isArray(fragment.duplication?.tests)) {
        const { tests, ...rest } = fragment.duplication
        duplication.push({ ...rest, pack, root: trimRoot(root), tests: tests.map((glob) => `${globPrefix(root)}${glob}`) })
      }
    }
  }
  const projectTdd = project.tdd?.files ?? []
  if (Array.isArray(projectTdd) && projectTdd.every((glob) => typeof glob === 'string')) {
    tdd.push(...projectTdd.map((glob) => glob.replace(/^(?:\.\/+)+/, '')))
  } else errors.push('tdd.files: expected a list of globs.')
  for (const rule of project.skills?.files ?? []) {
    const path = toRegex(rule.path, '', `skills.files "${rule.id}": path`, errors)
    if (path) files.push({ ...rule, path })
  }
  for (const rule of project.skills?.prompts ?? []) {
    const label = `skills.prompts "${rule.id}"`
    const pattern = toRegex(rule.pattern, 'i', `${label}: pattern`, errors)
    const skills = Array.isArray(rule.skills) && rule.skills.length && rule.skills.every((skill) => typeof skill === 'string')
    if (!skills) errors.push(`${label}: skills must be a list of skill names.`)
    if (typeof rule.why !== 'string' || !rule.why.trim()) errors.push(`${label}: why must say in one line why the skills apply.`)
    if (pattern && skills) prompts.push({ ...rule, pattern })
  }
  prompts.push(...((await import(pathToFileURL(join(pluginRoot, PACK_FILE)).href)).default.skills?.prompts ?? []))
  const contextErrors = []
  const tracker = { kind: project.tracker?.kind ?? 'github', labels: { ...DEFAULT_LABELS, ...project.tracker?.labels } }
  if (!TRACKERS.includes(tracker.kind)) contextErrors.push(`tracker.kind: expected "github" or "local", not "${tracker.kind}".`)
  for (const [role, label] of Object.entries(project.tracker?.labels ?? {})) {
    if (!ROLES.includes(role)) contextErrors.push(`tracker.labels: there is no role "${role}". Roles: ${ROLES.join(', ')}.`)
    else if (typeof label !== 'string' || !label) contextErrors.push(`tracker.labels.${role}: expected a label name.`)
  }
  const domain = { contexts: project.domain?.contexts ?? ['.'] }
  if (!Array.isArray(domain.contexts) || !domain.contexts.length || !domain.contexts.every((c) => typeof c === 'string')) {
    contextErrors.push("domain.contexts: expected a list of directories, such as ['.'].")
  } else {
    for (const context of domain.contexts) {
      if (!isDirectory(join(projectDir, context))) contextErrors.push(`domain.contexts: "${context}" does not exist in the project.`)
    }
  }
  if (errors.length) return { errors }
  return { config: { skills: { files, prompts }, tdd: { files: tdd, testCommands }, format, duplication, tracker, domain, contextErrors } }
}

/** [groups] if each is `{ files: [globs], run: [[words]] }`, else null with an error under [label] per bad group. */
function validFormat(groups, label, errors) {
  if (!Array.isArray(groups)) {
    errors.push(`${label}: expected a list of groups, each { files: [globs], run: [commands] }.`)
    return null
  }
  const before = errors.length
  groups.forEach((group, i) => {
    if (!isStrings(group?.files)) errors.push(`${label}[${i}].files: expected a list of globs.`)
    if (!Array.isArray(group?.run) || !group.run.length || !group.run.every((command) => isStrings(command))) {
      errors.push(`${label}[${i}].run: expected a list of commands, each a list of words, such as [['prettier', '--write']].`)
    }
  })
  return errors.length === before ? groups : null
}

/** Whether [value] is a non-empty list of non-empty strings. */
const isStrings = (value) => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item)

/** [value] as a regex: kept if it is one, compiled with [flags] if it is a string, else an error under [label]. */
function toRegex(value, flags, label, errors) {
  if (value instanceof RegExp) return value
  if (typeof value !== 'string') {
    errors.push(`${label} must be a regex or a string.`)
    return null
  }
  try {
    return new RegExp(value, flags)
  } catch (error) {
    errors.push(`${label} "${value}" is not a valid regex (${error.message.split(': ').pop()}).`)
    return null
  }
}

/**
 * Where [pack] is installed beside `core`, or null. `core`'s own fragment is not a pack. Loaded in place (the source tree, or a
 * marketplace added from a local directory) the plugins are siblings. Copied into Claude
 * Code's plugin cache, each sits under `<marketplace>/<plugin>/<version>/`, and the pack is
 * preferred at core's own version, else the most recently installed.
 */
function packDir(pluginRoot, pack) {
  if (pack === 'core') return null
  if (inPlace(pluginRoot)) {
    const sibling = join(pluginRoot, '..', pack)
    return isPack(sibling) ? sibling : null
  }
  const versions = join(pluginRoot, '..', '..', pack)
  if (!isDirectory(versions)) return null
  const sameVersion = join(versions, basename(pluginRoot))
  if (isPack(sameVersion)) return sameVersion
  const newest = readdirSync(versions)
    .map((version) => join(versions, version))
    .filter(isPack)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  return newest ?? null
}

/** The packs installed beside `core`. */
function availablePacks(pluginRoot) {
  const plugins = inPlace(pluginRoot) ? join(pluginRoot, '..') : join(pluginRoot, '..', '..')
  return readdirSync(plugins)
    .filter((name) => packDir(pluginRoot, name))
    .sort()
}

const inPlace = (pluginRoot) => basename(pluginRoot) === 'core'
const isDirectory = (path) => existsSync(path) && statSync(path).isDirectory()
const isPack = (dir) => existsSync(join(dir, PACK_FILE))

/** A root as a project-relative directory: `api` for `./api/`, nothing for `.`. */
const trimRoot = (root) => root.replace(/^\.\/+/, '').replace(/\/+$/, '').replace(/^\.$/, '')

/** A root as the start of a project-relative path regex. */
const rootPrefix = (root) => (trimRoot(root) ? `${escapeRegex(trimRoot(root))}/` : '')

/** A root as the start of a project-relative glob. */
const globPrefix = (root) => (trimRoot(root) ? `${trimRoot(root)}/` : '')

export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
