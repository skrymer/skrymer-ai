/**
 * Finds `core` beside this pack, as core's config loader finds packs beside itself (ADR 0004):
 * its sibling when the plugins are loaded in place, else core in the plugin cache
 * (`<marketplace>/<plugin>/<version>/`) at this pack's version or, failing that, the one
 * installed most recently.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACK_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const isCore = (dir) => existsSync(join(dir, 'scripts', 'verify-common.mjs'))

/** core's plugin root, or null when it isn't installed beside this pack. */
export function coreDir(packRoot = PACK_ROOT) {
  if (basename(packRoot) === 'web-e2e') {
    const sibling = join(packRoot, '..', 'core')
    return isCore(sibling) ? sibling : null
  }
  const versions = join(packRoot, '..', '..', 'core')
  if (!existsSync(versions)) return null
  const sameVersion = join(versions, basename(packRoot))
  if (isCore(sameVersion)) return sameVersion
  return (
    readdirSync(versions)
      .map((version) => join(versions, version))
      .filter(isCore)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null
  )
}

/** The path of core's script [name], or a line saying core is missing. */
export function coreScript(name) {
  const dir = coreDir()
  if (!dir) throw new Error('core is not installed beside web-e2e, and its verify scripts live there. Install the core plugin from the same marketplace.')
  return join(dir, 'scripts', name)
}

/** core's verify-common module. */
export const verifyCommon = () => import(pathToFileURL(coreScript('verify-common.mjs')).href)
