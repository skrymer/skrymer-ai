#!/usr/bin/env bash
# A Nuxt app on a feature branch with no change since its base. In the eval harness the
# script stops sooner, on the config (packs are invisible there, ADR 0007); outside it, on the
# empty branch. Either way it prints a STOP, and the case grades how the agent relays it.
set -euo pipefail
mkdir -p web/app/utils .claude
printf 'export default defineNuxtConfig({})\n' > web/nuxt.config.ts
printf 'export const total = (prices: number[]) => prices.reduce((sum, price) => sum + price, 0)\n' > web/app/utils/cart.ts
cat > .claude/skrymer-ai.config.mjs <<'JS'
import { defineConfig } from 'skrymer-ai'

export default defineConfig({ stacks: { nuxt: { roots: ['web'] } } })
JS
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git init -q -b main
git add -A
git -c user.email=dev@initech.test -c user.name=dev commit -qm 'Add the cart total'
git init -q --bare .origin
echo .origin/ >> .git/info/exclude
git remote add origin "$PWD/.origin"
git push -q origin main
git remote set-head origin main
git switch -qc feature
