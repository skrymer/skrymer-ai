/**
 * The packs this repo's marketplace lists beside core, sorted and comma-joined as the config
 * loader names them, so a test of that message need not change when a pack is added. Only an
 * entry sourced from a directory here that holds a pack fragment counts, as only those are
 * installed beside core when the plugins load in place.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const MARKETPLACE = join(REPO, '.claude-plugin', 'marketplace.json')

export const MARKETPLACE_PACKS = JSON.parse(readFileSync(MARKETPLACE, 'utf8'))
  .plugins.filter(({ name, source }) => name !== 'core' && typeof source === 'string' && existsSync(join(REPO, source, 'skrymer-ai.pack.mjs')))
  .map(({ name }) => name)
  .sort()
  .join(', ')
