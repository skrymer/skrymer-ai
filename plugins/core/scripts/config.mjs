/**
 * Loads a project's `.claude/skrymer-ai.config.mjs` and merges it over the default rule
 * fragments of the packs it enables. Every hook engine reads only the merged view.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CONFIG_PATH = join('.claude', 'skrymer-ai.config.mjs')
const PACK_FILE = 'skrymer-ai.pack.mjs'

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

/**
 * `{ config }` with the merged view, `{ config: null }` when the project has no config, or
 * `{ errors }` naming each problem in words a person can act on.
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
    for (const root of roots) {
      if (!isDirectory(join(projectDir, root))) {
        errors.push(`stacks.${pack}.roots: "${root}" does not exist in the project.`)
        continue
      }
      for (const rule of fragment.skills?.files ?? []) {
        files.push({ ...rule, path: new RegExp(`(^|/)${rootPrefix(root)}(?:${rule.path.source})`) })
      }
    }
  }
  for (const rule of project.skills?.files ?? []) {
    if (rule.path instanceof RegExp) {
      files.push(rule)
      continue
    }
    if (typeof rule.path !== 'string') {
      errors.push(`skills.files "${rule.id}": path must be a regex or a string.`)
      continue
    }
    try {
      files.push({ ...rule, path: new RegExp(rule.path) })
    } catch (error) {
      const reason = error.message.split(': ').pop()
      errors.push(`skills.files "${rule.id}": path "${rule.path}" is not a valid regex (${reason}).`)
    }
  }
  if (errors.length) return { errors }
  return { config: { skills: { files } } }
}

/**
 * Where [pack] is installed beside `core`, or null. Loaded in place (the source tree, or a
 * marketplace added from a local directory) the plugins are siblings. Copied into Claude
 * Code's plugin cache, each sits under `<marketplace>/<plugin>/<version>/`, and the pack is
 * preferred at core's own version, else the most recently installed.
 */
function packDir(pluginRoot, pack) {
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

/** A root as the start of a project-relative path: `api/` for `./api/`, nothing for `.`. */
function rootPrefix(root) {
  const trimmed = root.replace(/^\.\/+/, '').replace(/\/+$/, '')
  return trimmed === '.' || trimmed === '' ? '' : `${escapeRegex(trimmed)}/`
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
