/**
 * The nuxt pack's default rule fragment. Each `path`, TDD glob and format glob is relative to
 * a stack root the project config names, so a project states only its roots. A test command
 * matches within one shell command. A prompt rule matches the words of a prompt, whatever
 * the roots. The formatter runs in the root, so the root's own Prettier and ESLint configs
 * apply; a project on another package manager or toolchain replaces it with its stack's
 * own `format`.
 */
const prettier = ['pnpm', 'exec', 'prettier', '--write', '--log-level', 'warn']

export default {
  tdd: {
    files: ['app/**/*.{ts,vue}', 'server/**/*.ts', 'shared/**/*.ts'],
    testCommands: [/\bvitest\b|\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test\b/],
  },
  format: [
    { files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'], run: [prettier, ['pnpm', 'exec', 'eslint', '--fix']] },
    { files: ['**/*.{json,css,md,yml,yaml}'], run: [prettier] },
  ],
  skills: {
    prompts: [
      {
        id: 'nuxt-test-layer',
        pattern: /\bvitest\b|\brendersuspended\b|\btesting library\b|@nuxt\/test-utils\b|\b(vue|nuxt|component|frontend) tests?\b/i,
        skills: ['nuxt:component-testing', 'core:tdd'],
        why: 'a component test queries and drives the UI the way a user does, one red-green cycle at a time.',
      },
    ],
    files: [
      {
        id: 'vitest-test',
        path: /(?:app|server|shared|test)\/.+\.(?:test|spec)\.[cm]?[jt]s$/,
        skills: ['nuxt:component-testing'],
        why: 'A Vitest test renders through renderSuspended and queries by role, per the testing conventions.',
      },
      {
        id: 'frontend-source',
        path: /(?:app|server|shared)\//,
        skills: ['nuxt:frontend-dev'],
        why: 'Pages, components, composables and server routes follow the playbook’s architecture rules.',
      },
    ],
  },
}
