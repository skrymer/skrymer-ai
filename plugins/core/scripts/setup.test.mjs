import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const SETUP = join(dirname(fileURLToPath(import.meta.url)), 'setup.mjs')

const SPRING_BUILD = `plugins {
    kotlin("jvm") version "2.2.0"
    id("org.springframework.boot") version "4.0.0"
}
`

/** A temp repo holding each of [files], a map of repo-relative path to content. */
function fixtureRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'setup-repo-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

/** Runs the planner in [repo] with [args], returning its exit status and stdout. */
function runSetup(repo, ...args) {
  const result = spawnSync('node', [SETUP, ...args], { cwd: repo, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** The plan for [repo], as the planner's JSON. */
function planOf(repo) {
  const { status, stdout, stderr } = runSetup(repo, 'plan', '--json')
  assert.equal(status, 0, stderr)
  return JSON.parse(stdout)
}

const changeTo = (plan, path) => plan.changes.find((change) => change.path === path)

/** Adopts the plan in [repo] as the skill does: `apply`, then the settings the user approves writing. */
function adopt(repo) {
  const settings = changeTo(planOf(repo), '.claude/settings.json')
  runSetup(repo, 'apply')
  if (settings) writeFileSync(join(repo, '.claude', 'settings.json'), settings.after)
}

test('a Spring Boot repo gets a plan that creates the project config and enables the pack', () => {
  // Given a Spring Boot build at api/
  const repo = fixtureRepo({ 'api/build.gradle.kts': SPRING_BUILD })

  // When the planner plans
  const plan = planOf(repo)

  // Then it proposes the kotlin-spring root, a new project config and settings enabling the pack
  assert.deepEqual(plan.stacks, [{ pack: 'kotlin-spring', roots: ['api'] }])
  assert.deepEqual(changeTo(plan, '.claude/skrymer-ai.config.mjs'), {
    path: '.claude/skrymer-ai.config.mjs',
    action: 'create',
    before: null,
    after: `import { defineConfig } from 'skrymer-ai'

export default defineConfig({
  stacks: {
    'kotlin-spring': { roots: ['api'] },
  },
})
`,
  })
  assert.deepEqual(JSON.parse(changeTo(plan, '.claude/settings.json').after), {
    extraKnownMarketplaces: { 'skrymer-ai': { source: { source: 'github', repo: 'skrymer/skrymer-ai' } } },
    enabledPlugins: { 'core@skrymer-ai': true, 'kotlin-spring@skrymer-ai': true, 'kotlin-lsp@claude-plugins-official': true },
  })
})

test('applying the plan writes all but the settings, which Claude Code protects, and names what it left', () => {
  // Given a Spring Boot repo
  const repo = fixtureRepo({ 'api/build.gradle.kts': SPRING_BUILD })

  // When the plan is applied
  const applied = runSetup(repo, 'apply')

  // Then every file but the settings is written, and the settings are named as left
  assert.equal(applied.status, 0, applied.stderr)
  assert.equal(
    applied.stdout,
    'Wrote .claude/skrymer-ai.config.mjs, CLAUDE.md, CONTEXT.md, docs/adr/.gitkeep.\n' +
      'Left .claude/settings.json: Claude Code protects it, so write it with the Write tool and the content `plan --json` gives.\n'
  )
  assert.deepEqual(planOf(repo).changes.map((change) => change.path), ['.claude/settings.json'])
})

test('once the settings are written too, a second run plans nothing', () => {
  // Given a Spring Boot repo
  const repo = fixtureRepo({ 'api/build.gradle.kts': SPRING_BUILD })

  // When it is adopted, settings included
  adopt(repo)

  // Then a second plan has nothing to change
  assert.deepEqual(planOf(repo).changes, [])
})

test('each pack proposes a root wherever its marker file is, outside dependency and build trees', () => {
  // Given marker files at the root, in a service, in the web app, and inside dependency and build trees
  const repo = fixtureRepo({
    'build.gradle.kts': SPRING_BUILD,
    'services/ledger/build.gradle.kts': SPRING_BUILD,
    'tools/build.gradle.kts': 'plugins { kotlin("jvm") }\n',
    'web/nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    'web/playwright.config.ts': 'export default {}\n',
    'web/node_modules/some-lib/nuxt.config.ts': 'export default {}\n',
    'web/.output/nuxt.config.ts': 'export default {}\n',
  })

  // When the planner plans
  const plan = planOf(repo)

  // Then each pack has the roots outside those trees, and a Gradle build without Spring has none
  assert.deepEqual(plan.stacks, [
    { pack: 'kotlin-spring', roots: ['.', 'services/ledger'] },
    { pack: 'nuxt', roots: ['web'] },
    { pack: 'web-e2e', roots: ['web'] },
  ])
})

test('an existing settings file keeps its own keys and plugins, with the packs merged in', () => {
  // Given settings with their own permission, plugin and marketplace
  const existing = {
    permissions: { allow: ['Bash(./gradlew test)'] },
    enabledPlugins: { 'acme-tools@acme': true, 'core@skrymer-ai': false },
    extraKnownMarketplaces: { acme: { source: { source: 'github', repo: 'acme/plugins' } } },
  }
  const repo = fixtureRepo({ 'build.gradle.kts': SPRING_BUILD, '.claude/settings.json': JSON.stringify(existing) })

  // When the planner plans the settings
  const change = changeTo(planOf(repo), '.claude/settings.json')

  // Then they keep all three, with the marketplace and the plugins added
  assert.equal(change.action, 'update')
  assert.deepEqual(JSON.parse(change.after), {
    permissions: { allow: ['Bash(./gradlew test)'] },
    enabledPlugins: { 'acme-tools@acme': true, 'core@skrymer-ai': true, 'kotlin-spring@skrymer-ai': true, 'kotlin-lsp@claude-plugins-official': true },
    extraKnownMarketplaces: {
      acme: { source: { source: 'github', repo: 'acme/plugins' } },
      'skrymer-ai': { source: { source: 'github', repo: 'skrymer/skrymer-ai' } },
    },
  })
})

test('an existing project config is left as written', () => {
  // Given a hand-written project config
  const config = "import { defineConfig } from 'skrymer-ai'\n\n// Hand-written.\nexport default defineConfig({ stacks: {} })\n"
  const repo = fixtureRepo({ 'build.gradle.kts': SPRING_BUILD, '.claude/skrymer-ai.config.mjs': config })

  // When the planner plans
  const plan = planOf(repo)

  // Then the config is not among the changes
  assert.equal(changeTo(plan, '.claude/skrymer-ai.config.mjs'), undefined)
})

test('a repo without them gets a workflow section in CLAUDE.md, an empty glossary and an ADR directory', () => {
  // Given a repo with no CLAUDE.md, glossary or ADR directory
  const repo = fixtureRepo({ 'build.gradle.kts': SPRING_BUILD })

  // When the planner plans
  const plan = planOf(repo)

  // Then it creates the workflow section, an empty glossary named after the repo, and a kept ADR directory
  const section = changeTo(plan, 'CLAUDE.md').after
  assert.match(section, /^<!-- skrymer-ai:start -->\n## Workflow\n[^]+\n<!-- skrymer-ai:end -->\n$/)
  assert.equal(changeTo(plan, 'CONTEXT.md').after, `# ${basename(repo)}\n\n## Language\n`)
  assert.equal(changeTo(plan, 'docs/adr/.gitkeep').after, '')
})

test('an existing CLAUDE.md keeps its own text, with a stale workflow section replaced where it stands', () => {
  // Given a CLAUDE.md with its own text around an old workflow section, a glossary and an ADR
  const fresh = changeTo(planOf(fixtureRepo({ 'build.gradle.kts': SPRING_BUILD })), 'CLAUDE.md').after
  const repo = fixtureRepo({
    'build.gradle.kts': SPRING_BUILD,
    'CLAUDE.md': '# Acme\n\nIntro.\n\n<!-- skrymer-ai:start -->\nOld words.\n<!-- skrymer-ai:end -->\n\n## Our rules\n',
    'CONTEXT.md': '# Acme\n',
    'docs/adr/0001-use-kotlin.md': '# Use Kotlin\n',
  })

  // When the planner plans
  const plan = planOf(repo)

  // Then only the section is replaced, and the glossary and ADRs are left alone
  assert.equal(changeTo(plan, 'CLAUDE.md').after, `# Acme\n\nIntro.\n\n${fresh}\n## Our rules\n`)
  assert.deepEqual(
    plan.changes.map((change) => change.path).filter((path) => path === 'CONTEXT.md' || path.startsWith('docs/')),
    []
  )
})

test("a project's own Probity setup is removed, so core's TDD gate is the only judge", () => {
  // Given a Nuxt app with its own Probity config, dependency and hook
  const formatHook = { matcher: 'Write', hooks: [{ type: 'command', command: 'npx prettier --write' }] }
  const probityHook = { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: 'npx probity' }] }
  const repo = fixtureRepo({
    'web/nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    'web/probity.config.ts': 'export default {}\n',
    'web/package.json': JSON.stringify({ name: 'web', devDependencies: { '@nizos/probity': '1.0.0', vitest: '3.0.0' } }, null, 2) + '\n',
    '.claude/settings.json': JSON.stringify({ hooks: { PreToolUse: [probityHook], PostToolUse: [formatHook] } }),
  })

  // When the planner plans
  const plan = planOf(repo)

  // Then the config is deleted, the dependency and hook are removed, and the other hook is kept
  assert.deepEqual(changeTo(plan, 'web/probity.config.ts'), {
    path: 'web/probity.config.ts',
    action: 'delete',
    before: 'export default {}\n',
    after: null,
  })
  assert.equal(
    changeTo(plan, 'web/package.json').after,
    JSON.stringify({ name: 'web', devDependencies: { vitest: '3.0.0' } }, null, 2) + '\n'
  )
  assert.deepEqual(JSON.parse(changeTo(plan, '.claude/settings.json').after).hooks, { PostToolUse: [formatHook] })
})

test('each typed stack gets its code-intelligence plugin, once however many packs need it', () => {
  // Given a Nuxt app with Playwright specs
  const repo = fixtureRepo({
    'web/nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    'web/playwright.config.ts': 'export default {}\n',
  })

  // When the planner plans the settings
  const settings = JSON.parse(changeTo(planOf(repo), '.claude/settings.json').after)

  // Then the TypeScript code-intelligence plugin is enabled once
  assert.deepEqual(settings.enabledPlugins, {
    'core@skrymer-ai': true,
    'nuxt@skrymer-ai': true,
    'web-e2e@skrymer-ai': true,
    'typescript-lsp@claude-plugins-official': true,
  })
})

test('check reports no drift once the plan is applied', () => {
  // Given an adopted repo
  const repo = fixtureRepo({ 'api/build.gradle.kts': SPRING_BUILD })
  adopt(repo)

  // When it is checked
  const result = runSetup(repo, 'check')

  // Then it reports no drift
  assert.deepEqual(result, { status: 0, stdout: 'skrymer-ai: no drift.\n', stderr: '' })
})

test('check reports each drift without writing: a pending change, an unlisted root and a config error', () => {
  // Given a config naming a missing root and missing a detected one, with a Probity config left behind
  const config = "import { defineConfig } from 'skrymer-ai'\n\nexport default defineConfig({ stacks: { nuxt: { roots: ['app', 'gone'] } } })\n"
  const repo = fixtureRepo({
    'app/nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    'admin/nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    'app/probity.config.ts': 'export default {}\n',
    '.claude/skrymer-ai.config.mjs': config,
  })

  // When it is checked
  const result = runSetup(repo, 'check')

  // Then each drift is reported, it exits 1, and nothing is written
  assert.equal(result.status, 1)
  assert.deepEqual(result.stdout.trimEnd().split('\n'), [
    'skrymer-ai: the project has drifted from the workflow. Run /core:setup to fix what it can.',
    '- .claude/skrymer-ai.config.mjs: stacks.nuxt.roots: "gone" does not exist in the project.',
    "- .claude/skrymer-ai.config.mjs: nuxt is detected in \"admin\" too. List it: 'nuxt': { roots: ['admin', 'app', 'gone'] }",
    '- .claude/settings.json: setup would create it.',
    '- CLAUDE.md: setup would create it.',
    '- CONTEXT.md: setup would create it.',
    '- docs/adr/.gitkeep: setup would create it.',
    '- app/probity.config.ts: setup would delete it.',
  ])
  assert.equal(planOf(repo).changes.length, 5)
})

test('the plan reads as the stacks found, then a diff of each change', () => {
  // Given a Spring Boot repo with its own CLAUDE.md and a Probity config
  const repo = fixtureRepo({
    'api/build.gradle.kts': SPRING_BUILD,
    'CLAUDE.md': '# Acme\n',
    'api/probity.config.ts': 'export default {}\n',
  })

  // When the plan is printed for a person
  const { status, stdout } = runSetup(repo, 'plan')

  // Then it lists the stacks, then a diff per change
  assert.equal(status, 0)
  assert.match(stdout, /^Stacks found:\n- kotlin-spring: api\n\n/)
  assert.match(stdout, /\n--- \/dev\/null\n\+\+\+ b\/\.claude\/skrymer-ai\.config\.mjs\n@@ -0,0 \+1,7 @@\n\+import \{ defineConfig \} from 'skrymer-ai'\n/)
  assert.match(stdout, /\n--- a\/CLAUDE\.md\n\+\+\+ b\/CLAUDE\.md\n@@ -1 \+1,12 @@\n # Acme\n\+\n\+<!-- skrymer-ai:start -->\n/)
  assert.match(stdout, /\n--- a\/api\/probity\.config\.ts\n\+\+\+ \/dev\/null\n@@ -1 \+0,0 @@\n-export default \{\}\n/)
})

test('a repo already set up plans nothing, in words', () => {
  // Given an adopted repo
  const repo = fixtureRepo({ 'api/build.gradle.kts': SPRING_BUILD })
  adopt(repo)

  // When the plan is printed for a person
  const { stdout } = runSetup(repo, 'plan')

  // Then it says there is nothing to change
  assert.equal(stdout, 'Stacks found:\n- kotlin-spring: api\n\nNothing to change: the project is set up.\n')
})

test('a JSON file setup must merge into, but cannot parse, stops the run with the file named', () => {
  // Given settings that are not valid JSON
  const repo = fixtureRepo({ 'build.gradle.kts': SPRING_BUILD, '.claude/settings.json': '{ "permissions": ' })

  // When the repo is planned and applied
  const results = [runSetup(repo, 'plan'), runSetup(repo, 'apply')]

  // Then both runs stop with the file named
  for (const { status, stderr } of results) {
    assert.equal(status, 1)
    assert.match(stderr, /^skrymer-ai: \.claude\/settings\.json is not valid JSON \(.+\)\. Fix it, then run setup again\.\n$/)
  }
})

test('a file setup cannot read, such as settings a sandbox hides, is reported while the rest is planned', () => {
  // Given a Spring Boot repo whose settings no one may read
  const repo = fixtureRepo({ 'build.gradle.kts': SPRING_BUILD, '.claude/settings.json': '{}' })
  chmodSync(join(repo, '.claude', 'settings.json'), 0o000)

  // When the planner plans
  const plan = planOf(repo)

  // Then the settings are named as unreadable, and every other file is still planned
  assert.deepEqual(plan.unreadable, [{ path: '.claude/settings.json', code: 'EACCES' }])
  assert.deepEqual(
    plan.changes.map((change) => change.path),
    ['.claude/skrymer-ai.config.mjs', 'CLAUDE.md', 'CONTEXT.md', 'docs/adr/.gitkeep']
  )
})

test('check counts a file it cannot read as drift', () => {
  // Given an adopted repo whose settings then become unreadable
  const repo = fixtureRepo({ 'api/build.gradle.kts': SPRING_BUILD })
  adopt(repo)
  chmodSync(join(repo, '.claude', 'settings.json'), 0o000)

  // When it is checked
  const { status, stdout } = runSetup(repo, 'check')

  // Then the unreadable settings are the one drift reported
  assert.equal(status, 1)
  assert.deepEqual(stdout.trimEnd().split('\n').slice(1), ['- .claude/settings.json: setup cannot read it (EACCES).'])
})

/** An adopted repo with a Playwright root at web/ whose package.json declares [devDependencies]. */
function playwrightRepo(devDependencies, extra = {}) {
  const repo = fixtureRepo({
    'web/playwright.config.ts': 'export default {}\n',
    'web/package.json': JSON.stringify({ name: 'acme-web', devDependencies }),
    ...extra,
  })
  adopt(repo)
  return repo
}

test('check reports a dependency a pack has moved past, so its skills may be out of date', () => {
  // Given a Playwright root declaring a newer msw major than web-e2e targets, and a matching @msw/playwright
  const repo = playwrightRepo({ msw: '^4.1.0', '@msw/playwright': '^0.7.2' })

  // When it is checked
  const result = runSetup(repo, 'check')

  // Then it names the package, the range the pack targets and the version found, and exits 1
  assert.equal(result.status, 1)
  assert.deepEqual(result.stdout.trimEnd().split('\n').slice(1), [
    '- web/package.json: web-e2e targets msw ^3, but web has 4.1.0, so its skills may be out of date.',
  ])
})

test('check reads the installed version over the declared range', () => {
  // Given a range that admits the next major and an installed copy that is on it
  const repo = playwrightRepo(
    { msw: '>=3' },
    { 'web/node_modules/msw/package.json': JSON.stringify({ name: 'msw', version: '4.0.0' }) },
  )

  // When it is checked
  const result = runSetup(repo, 'check')

  // Then the installed 4.0.0 is what it reports
  assert.match(result.stdout, /web-e2e targets msw \^3, but web has 4\.0\.0,/)
})

test('a pre-1.0 package is out of range on a new minor, and an undeclared one is not reported', () => {
  // Given @msw/playwright one minor past the pack's 0.x range and no msw at all
  const repo = playwrightRepo({ '@msw/playwright': '~0.8.0' })

  // When it is checked
  const result = runSetup(repo, 'check')

  // Then only @msw/playwright is reported
  assert.deepEqual(result.stdout.trimEnd().split('\n').slice(1), [
    '- web/package.json: web-e2e targets @msw/playwright ^0.7, but web has 0.8.0, so its skills may be out of date.',
  ])
})

test('dependencies inside the ranges a pack targets are no drift', () => {
  // Given a Playwright root on the majors web-e2e targets
  const repo = playwrightRepo({ msw: '^3.0.1', '@msw/playwright': '^0.7.0' })

  // When it is checked
  const result = runSetup(repo, 'check')

  // Then it reports no drift
  assert.deepEqual(result, { status: 0, stdout: 'skrymer-ai: no drift.\n', stderr: '' })
})
