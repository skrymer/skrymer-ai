import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { GIT_ENV, git, runScript } from './git-fixture.mjs'

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
    'Wrote .claude/skrymer-ai.config.mjs, CLAUDE.md, CONTEXT.md, docs/adr/.gitkeep, .githooks/pre-commit, .github/workflows/skrymer-ai.yml.\n' +
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
    ['.claude/skrymer-ai.config.mjs', 'CLAUDE.md', 'CONTEXT.md', 'docs/adr/.gitkeep', '.githooks/pre-commit', '.github/workflows/skrymer-ai.yml']
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

const HOOK = '.githooks/pre-commit'
const WORKFLOW = '.github/workflows/skrymer-ai.yml'

/** A temp repo holding [files] in a fresh git repo, with git kept off the developer's own config. */
function gitRepo(files) {
  const repo = fixtureRepo(files)
  git(repo, 'init', '-q', '-b', 'main')
  return repo
}

/** Runs the planner in a git [repo] with [args], with git kept off the developer's own config. */
const runInGit = (repo, ...args) => runScript(SETUP, repo, args)

/** Adopts the plan in a git [repo] as the skill does. */
function adoptInGit(repo) {
  const { stdout } = runInGit(repo, 'plan', '--json')
  const settings = changeTo(JSON.parse(stdout), '.claude/settings.json')
  runInGit(repo, 'apply')
  if (settings) writeFileSync(join(repo, '.claude', 'settings.json'), settings.after)
}

test('a Spring Boot repo gets a pre-commit hook that runs the root’s lint only when it has staged files', () => {
  // Given a Spring Boot build at api/
  const repo = fixtureRepo({ 'api/build.gradle.kts': SPRING_BUILD })

  // When the planner plans
  const hook = changeTo(planOf(repo), HOOK)

  // Then it creates the hook, whose generated block runs detekt in api when api has staged files
  assert.equal(hook.action, 'create')
  assert.equal(
    hook.after,
    `#!/bin/sh
# The skrymer-ai pre-commit hook: each stack root with staged files runs its lint.
# /core:setup rewrites the lines between the skrymer-ai markers; edits outside them are kept.
# skrymer-ai:start
if ! git diff --cached --quiet --diff-filter=ACMR -- api; then
  echo 'skrymer-ai: kotlin-spring lint in api'
  (cd api && ./gradlew detekt) || exit 1
fi
# skrymer-ai:end
`
  )
})

test('a Spring Boot repo gets a CI workflow with a job that sets up the JDK and Gradle and runs the check', () => {
  // Given a Spring Boot build at api/ whose toolchain is Java 17
  const repo = fixtureRepo({ 'api/build.gradle.kts': `${SPRING_BUILD}\nkotlin { jvmToolchain(17) }\n` })

  // When the planner plans
  const workflow = changeTo(planOf(repo), WORKFLOW)

  // Then it creates the workflow, with one job in api running the pack's setup steps and its check
  assert.equal(workflow.action, 'create')
  assert.equal(
    workflow.after,
    `# The skrymer-ai checks: one job per stack root, running its check.
# /core:setup rewrites the jobs between the skrymer-ai markers; edits outside them are kept.
name: skrymer-ai

on:
  push:
    branches: [main]
  pull_request:

jobs:
  # skrymer-ai:start
  kotlin-spring-api:
    name: kotlin-spring check in api
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"
      - uses: gradle/actions/setup-gradle@v4
      - run: ./gradlew build
  # skrymer-ai:end
`
  )
})

test('a nuxt root’s job sets up pnpm and Node from the root’s own files, and a stack’s check replaces the pack’s', () => {
  // Given a nuxt root at web/ with a pinned pnpm, an .nvmrc and a lockfile, and a check of its own
  const config = "import { defineConfig } from 'skrymer-ai'\n\nexport default defineConfig({ stacks: { nuxt: { roots: ['web'], check: [['pnpm', 'run', 'ci:acme']] } } })\n"
  const repo = fixtureRepo({
    'web/nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    'web/package.json': JSON.stringify({ name: 'acme-web', packageManager: 'pnpm@10.4.1' }),
    'web/.nvmrc': '24\n',
    'web/pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    '.claude/skrymer-ai.config.mjs': config,
  })

  // When the planner plans
  const workflow = changeTo(planOf(repo), WORKFLOW).after

  // Then the job reads pnpm and Node from web/, installs, and runs the stack's own check
  assert.match(
    workflow,
    /\n {2}nuxt-web:\n[^]*\n {6}- uses: pnpm\/action-setup@v4\n {8}with:\n {10}package_json_file: web\/package\.json\n {6}- uses: actions\/setup-node@v4\n {8}with:\n {10}node-version-file: web\/\.nvmrc\n {10}cache: pnpm\n {10}cache-dependency-path: web\/pnpm-lock\.yaml\n {6}- run: pnpm install --frozen-lockfile\n {6}- run: pnpm run ci:acme\n {2}# skrymer-ai:end\n$/
  )
})

test('the workflow is skipped with a message when the tracker is not GitHub', () => {
  // Given a Spring Boot repo whose config keeps its issues locally
  const config = "import { defineConfig } from 'skrymer-ai'\n\nexport default defineConfig({ stacks: { 'kotlin-spring': { roots: ['.'] } }, tracker: { kind: 'local' } })\n"
  const repo = fixtureRepo({ 'build.gradle.kts': SPRING_BUILD, '.claude/skrymer-ai.config.mjs': config })

  // When the planner plans, and prints the plan for a person
  const plan = planOf(repo)
  const { stdout } = runSetup(repo, 'plan')

  // Then no workflow is planned, and the skip is said in words
  assert.equal(changeTo(plan, WORKFLOW), undefined)
  const skip = `${WORKFLOW}: the workflow is GitHub Actions only, and tracker.kind is "local".`
  assert.deepEqual(plan.skipped, [skip])
  assert.match(stdout, new RegExp(`\nSkipped:\n- ${skip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n`))
})

test('the hook runs each staged root’s lint on its staged files, and nothing for a root with none staged', () => {
  // Given two nuxt roots whose lint records the files it is given, adopted in a git repo
  const config = "import { defineConfig } from 'skrymer-ai'\n\nexport default defineConfig({ stacks: { nuxt: { roots: ['acme-web', 'globex-web'], lint: [['node', '../record.mjs', '{staged}']] } } })\n"
  const repo = gitRepo({
    'acme-web/nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    'globex-web/nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    'record.mjs': "import { appendFileSync } from 'node:fs'\nimport { basename } from 'node:path'\nappendFileSync('../lint.log', JSON.stringify([basename(process.cwd()), ...process.argv.slice(2)]) + '\\n')\n",
    '.claude/skrymer-ai.config.mjs': config,
  })
  adoptInGit(repo)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'adopt', '--no-verify')

  // When a commit stages two files in acme-web, one with a space in its name, and none in globex-web
  writeFileSync(join(repo, 'acme-web', 'cart.ts'), 'export const cart = []\n')
  mkdirSync(join(repo, 'acme-web', 'docs'))
  writeFileSync(join(repo, 'acme-web', 'docs', 'release notes.md'), '# Notes\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'cart')

  // Then the lint ran once, in acme-web, on its staged files relative to the root
  assert.equal(readFileSync(join(repo, 'lint.log'), 'utf8'), `${JSON.stringify(['acme-web', 'cart.ts', 'docs/release notes.md'])}\n`)
})

test('a lint that fails stops the commit', () => {
  // Given a Spring Boot root whose lint fails, adopted in a git repo
  const config = "import { defineConfig } from 'skrymer-ai'\n\nexport default defineConfig({ stacks: { 'kotlin-spring': { roots: ['api'], lint: [['node', '-e', 'process.exit(3)']] } } })\n"
  const repo = gitRepo({ 'api/build.gradle.kts': SPRING_BUILD, '.claude/skrymer-ai.config.mjs': config })
  adoptInGit(repo)

  // When a commit stages a file in api
  git(repo, 'add', '-A')
  const commit = spawnSync('git', ['-c', 'user.email=dev@acme.test', '-c', 'user.name=dev', 'commit', '-qm', 'api'], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })

  // Then the commit fails and nothing is committed
  assert.notEqual(commit.status, 0)
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: repo, env: { ...process.env, ...GIT_ENV } }).status, 1)
})

test('setup plans core.hooksPath and apply sets it, so the hook runs in this clone', () => {
  // Given a Spring Boot repo in git with no hooks path set
  const repo = gitRepo({ 'api/build.gradle.kts': SPRING_BUILD })

  // When it is planned, then applied
  const plan = JSON.parse(runInGit(repo, 'plan', '--json').stdout)
  const plain = runInGit(repo, 'plan').stdout
  const applied = runInGit(repo, 'apply')

  // Then the plan sets the hooks path, says so in words, and apply sets it
  assert.deepEqual(plan.git, [{ key: 'core.hooksPath', before: null, after: '.githooks' }])
  assert.match(plain, /\nGit config:\n- core\.hooksPath: unset → \.githooks\n/)
  assert.match(applied.stdout, /\nSet core\.hooksPath to \.githooks\.\n/)
  assert.equal(git(repo, 'config', '--local', 'core.hooksPath'), '.githooks')
  assert.equal(statSync(join(repo, HOOK)).mode & 0o111, 0o111)
})

test('check reports a drifted generated block and an unset hooks path, and a re-run keeps edits outside the markers', () => {
  // Given an adopted repo whose hook gained a line of its own, lost a generated line, and whose hooks path was unset
  const repo = gitRepo({ 'api/build.gradle.kts': SPRING_BUILD })
  adoptInGit(repo)
  const generated = readFileSync(join(repo, HOOK), 'utf8')
  writeFileSync(join(repo, HOOK), `${generated.replace(/^ {2}echo .*\n/m, '')}npm run acme-secrets-scan\n`)
  git(repo, 'config', '--local', '--unset', 'core.hooksPath')

  // When it is checked, then set up again
  const checked = runInGit(repo, 'check')
  runInGit(repo, 'apply')

  // Then both drifts are reported, and the re-run restores the block and the path and keeps the project's line
  assert.equal(checked.status, 1)
  assert.deepEqual(checked.stdout.trimEnd().split('\n').slice(1), [
    `- ${HOOK}: setup would update it.`,
    '- core.hooksPath: setup would set it to .githooks; it is unset.',
  ])
  assert.equal(readFileSync(join(repo, HOOK), 'utf8'), `${generated}npm run acme-secrets-scan\n`)
  assert.equal(git(repo, 'config', '--local', 'core.hooksPath'), '.githooks')
  assert.equal(runInGit(repo, 'check').status, 0)
})

test('a repo on husky keeps its hooks path, and setup prints the line to add to its pre-commit hook', () => {
  // Given a Spring Boot repo whose husky pre-commit runs lint-staged, with husky's hooks path set
  const repo = gitRepo({ 'api/build.gradle.kts': SPRING_BUILD, '.husky/pre-commit': 'npx lint-staged\n' })
  git(repo, 'config', '--local', 'core.hooksPath', '.husky/_')

  // When it is planned, adopted and checked, then checked again once the line is added
  const plan = JSON.parse(runInGit(repo, 'plan', '--json').stdout)
  adoptInGit(repo)
  const before = runInGit(repo, 'check')
  writeFileSync(join(repo, '.husky', 'pre-commit'), 'npx lint-staged\nsh .githooks/pre-commit\n')
  const after = runInGit(repo, 'check')

  // Then the hooks path and husky's hook are left, the line is printed, and check reports it until it is there
  assert.deepEqual(plan.git, [])
  assert.deepEqual(plan.hand, [{ path: '.husky/pre-commit', todo: 'add the line that runs the skrymer-ai hook: sh .githooks/pre-commit' }])
  assert.equal(changeTo(plan, '.husky/pre-commit'), undefined)
  assert.equal(git(repo, 'config', '--local', 'core.hooksPath'), '.husky/_')
  assert.deepEqual(before.stdout.trimEnd().split('\n').slice(1), ['- .husky/pre-commit: add the line that runs the skrymer-ai hook: sh .githooks/pre-commit'])
  assert.deepEqual(after, { status: 0, stdout: 'skrymer-ai: no drift.\n', stderr: '', out: 'skrymer-ai: no drift.\n' })
})

test('a repo with its own hooks path keeps it, and setup prints the line to add to that path’s pre-commit hook', () => {
  // Given a Spring Boot repo whose hooks live in tools/hooks
  const repo = gitRepo({ 'api/build.gradle.kts': SPRING_BUILD })
  git(repo, 'config', '--local', 'core.hooksPath', 'tools/hooks')

  // When it is planned
  const plan = JSON.parse(runInGit(repo, 'plan', '--json').stdout)

  // Then the hooks path is left and the line names that path's hook
  assert.deepEqual(plan.git, [])
  assert.deepEqual(plan.hand, [{ path: 'tools/hooks/pre-commit', todo: 'add the line that runs the skrymer-ai hook: sh .githooks/pre-commit' }])
})

test('a workflow of the project’s own at the same path, without markers, is left and named as a step by hand', () => {
  // Given a Spring Boot repo whose skrymer-ai workflow was written by hand, without markers
  const theirs = 'name: skrymer-ai\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ./gradlew build\n'
  const repo = fixtureRepo({ 'build.gradle.kts': SPRING_BUILD, [WORKFLOW]: theirs })

  // When the planner plans
  const plan = planOf(repo)

  // Then the workflow is not changed, and the step by hand says how to let setup own its jobs
  assert.equal(changeTo(plan, WORKFLOW), undefined)
  assert.deepEqual(plan.hand, [
    {
      path: WORKFLOW,
      todo: 'put the skrymer-ai jobs between "# skrymer-ai:start" and "# skrymer-ai:end" lines under jobs:, or delete the file, then run setup again.',
    },
  ])
})
