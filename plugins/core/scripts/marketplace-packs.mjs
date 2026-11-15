/**
 * The packs this repo's marketplace lists beside core, sorted and comma-joined as the config
 * loader names them, so a test of that message need not change when a pack is added.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKETPLACE = join(dirname(fileURLToPath(import.meta.url)), '../../../.claude-plugin/marketplace.json')

export const MARKETPLACE_PACKS = JSON.parse(readFileSync(MARKETPLACE, 'utf8'))
  .plugins.map(({ name }) => name)
  .filter((name) => name !== 'core')
  .sort()
  .join(', ')
