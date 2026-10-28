#!/usr/bin/env bash
# A Nuxt app with a project config that names a root which no longer exists.
set -euo pipefail
mkdir -p web .claude
printf 'export default defineNuxtConfig({})\n' > web/nuxt.config.ts
cat > .claude/skrymer-ai.config.mjs <<'JS'
import { defineConfig } from 'skrymer-ai'

export default defineConfig({ stacks: { nuxt: { roots: ['frontend'] } } })
JS
