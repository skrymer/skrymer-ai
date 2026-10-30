#!/usr/bin/env bash
# A Nuxt app with a web-e2e stack and issue 12's body beside it, committed on a feature branch.
# The workspace has no network, so neither the stack nor a browser can start: the case grades
# that the walk-through still leaves a result for every AC instead of skipping the ones it
# couldn't walk.
set -euo pipefail
mkdir -p web/app/pages .claude
printf 'export default defineNuxtConfig({})\n' > web/nuxt.config.ts
printf "import { defineConfig } from '@playwright/test'\n\nexport default defineConfig({ testDir: 'e2e' })\n" > web/playwright.config.ts
cat > web/app/pages/reports.vue <<'VUE'
<script setup lang="ts">
const { data: reports } = await useFetch('/api/reports')
const coverSheet = ref('')
const error = ref('')
async function submit() {
  if (!coverSheet.value.trim()) return (error.value = 'Add a cover sheet')
  await $fetch('/api/reports', { method: 'POST', body: { coverSheet: coverSheet.value } })
}
</script>

<template>
  <ol><li v-for="report in reports" :key="report.id">{{ report.title }}</li></ol>
  <form @submit.prevent="submit">
    <label>Cover sheet <input v-model="coverSheet"></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <button>Submit</button>
  </form>
</template>
VUE
cat > .claude/skrymer-ai.config.mjs <<'JS'
export default {
  stacks: {
    'web-e2e': {
      roots: ['web'],
      verify: {
        stack: { up: ['docker', 'compose', 'up', '-d', 'backend'], down: ['docker', 'compose', 'down'] },
        dev: { run: ['pnpm', 'dev'], ready: /Local:\s+(http\S+)/ },
        user: { mint: ['node', 'scripts/mint-user.mjs', '--email', '{email}'], env: { file: '.env', key: 'INITECH_DEV_TOKEN' } },
        api: { base: '/api' },
      },
    },
  },
}
JS
cat > issue-12.md <<'MD'
## What to build

Initech's TPS reports page lists the signed-in user's reports and takes a new one.

## Acceptance criteria

- [ ] The TPS report list shows the newest report first
- [ ] Submitting a report with an empty cover sheet shows "Add a cover sheet" under the field
- [ ] A report's total is computed on the server and stored rounded to the cent

## Blocked by

- [ ] #3
MD
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git init -q -b main
echo issue-12.md >> .git/info/exclude
git add -A
git -c user.email=dev@initech.test -c user.name=dev commit -qm 'Add the TPS reports page'
git switch -qc tps-reports
# The sandbox masks dotfiles in the workspace with files git can't add, which would stop head's
# stamp. The committed config stays tracked.
echo '/.*' >> .git/info/exclude
