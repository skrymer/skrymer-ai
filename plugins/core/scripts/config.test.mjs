import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A temp project holding [config] as its project config and an empty directory per root. */
function fixtureProject(config, roots = []) {
  const dir = mkdtempSync(join(tmpdir(), 'config-project-'))
  for (const root of roots) mkdirSync(join(dir, root), { recursive: true })
  mkdirSync(join(dir, '.claude'))
  writeFileSync(join(dir, '.claude', 'skrymer-ai.config.mjs'), config)
  return dir
}

const configOf = (body) => `
import { defineConfig } from 'skrymer-ai'

export default defineConfig(${body})
`

test('a stack with no such pack is an error naming the pack and the packs there are', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'acme-stack': { roots: ['acme-api'] } } }`), ['acme-api'])

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: ['stacks: there is no pack "acme-stack". Packs available: kotlin-spring, nuxt, web-e2e.'],
  })
})

test('a stack named when no packs are installed beside core says there are none', async () => {
  // Given a core installed alone and a config naming a pack
  const lonelyCore = join(mkdtempSync(join(tmpdir(), 'config-plugins-')), 'core')
  mkdirSync(lonelyCore)
  writeFileSync(join(lonelyCore, 'skrymer-ai.pack.mjs'), 'export default {}\n')
  const project = fixtureProject(configOf(`{ stacks: { nuxt: { roots: ['acme-web'] } } }`), ['acme-web'])

  // When the config is loaded
  const result = await loadConfig(project, lonelyCore)

  // Then the error says no packs are installed beside core
  assert.deepEqual(result, { errors: ['stacks: there is no pack "nuxt". No packs are installed beside core.'] })
})

test('a root that does not exist is an error naming the root and its stack', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { roots: ['globex-api'] } } }`))

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: ['stacks.kotlin-spring.roots: "globex-api" does not exist in the project.'],
  })
})

test('a project rule whose path is not a valid regex is an error naming the rule', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      stacks: { 'kotlin-spring': { roots: ['acme-api'] } },
      skills: { files: [{ id: 'invoicing', path: 'acme-api/(invoicing', skills: ['invoicing-rules'], why: 'x' }] },
    }`),
    ['acme-api']
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: [
      'skills.files "invoicing": path "acme-api/(invoicing" is not a valid regex (Unterminated group).',
    ],
  })
})

test('a config that does not load, such as one with a bad regex literal, is an error saying why', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{ skills: { files: [{ id: 'invoicing', path: /acme-api\\/(invoicing/, skills: ['x'], why: 'x' }] } }`)
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /^\.claude\/skrymer-ai\.config\.mjs does not load: .*Invalid regular expression/)
})

test('a stack without a list of roots is an error, not a crash', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { root: 'acme-api' } } }`), ['acme-api'])

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, { errors: ['stacks.kotlin-spring.roots: expected a list of directories.'] })
})

test('a project rule without a path is an error, rather than a rule matching every file', async () => {
  // Given
  const project = fixtureProject(configOf(`{ skills: { files: [{ id: 'billing', paths: /billing\\//, skills: ['billing-rules'], why: 'x' }] } }`))

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, { errors: ['skills.files "billing": path must be a regex or a string.'] })
})

test('a config with no default export is an error saying what it must export', async () => {
  // Given
  const project = fixtureProject(`export const config = { stacks: {} }\n`)

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, { errors: ['.claude/skrymer-ai.config.mjs: expected `export default defineConfig({ … })`.'] })
})

test('the TDD-gated trees are each pack’s source globs under every one of its roots', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api', './'] } } }`), ['acme-api'])

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(config.tdd.files, ['acme-api/src/**/*.kt', 'src/**/*.kt'])
})

test('a project’s own TDD globs are gated after the packs’', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      stacks: { 'kotlin-spring': { roots: ['acme-api'] } },
      tdd: { files: ['acme-scripts/**/*.kts'] },
    }`),
    ['acme-api']
  )

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(config.tdd.files, ['acme-api/src/**/*.kt', 'acme-scripts/**/*.kts'])
})

test('TDD files that are not a list of globs are an error, not a gate that covers nothing', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api'] } }, tdd: { files: 'acme-scripts/**/*.kts' } }`),
    ['acme-api']
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, { errors: ['tdd.files: expected a list of globs.'] })
})

test('the test commands are each enabled pack’s, once however many roots it has', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api', 'globex-api'] } } }`), [
    'acme-api',
    'globex-api',
  ])

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.equal(config.tdd.testCommands.length, 1)
  assert.match('./gradlew :acme:test', config.tdd.testCommands[0])
})

test('a project TDD glob written from ./ is gated as if written from the project root', async () => {
  // Given
  const project = fixtureProject(configOf(`{ tdd: { files: ['./acme-scripts/**/*.kts'] } }`))

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(config.tdd.files, ['acme-scripts/**/*.kts'])
})

test('prompt rules merge pack first, then the project, then core’s own', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      stacks: { 'kotlin-spring': { roots: ['acme-api'] } },
      skills: { prompts: [{ id: 'invoicing', pattern: /\\binvoic\\w*/i, skills: ['invoicing-rules'], why: 'Money rounds one way.' }] },
    }`),
    ['acme-api']
  )

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(
    config.skills.prompts.map((rule) => rule.id),
    ['kotlin-test-layer', 'invoicing', 'tdd', 'grill-with-docs', 'write-a-skill', 'handoff']
  )
})

test('a project prompt rule whose pattern is not a regex, or not a valid one, is an error naming the rule', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      skills: {
        prompts: [
          { id: 'invoicing', pattern: '(invoic', skills: ['invoicing-rules'], why: 'x' },
          { id: 'tax', skills: ['tax-rules'], why: 'x' },
        ],
      },
    }`)
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: [
      'skills.prompts "invoicing": pattern "(invoic" is not a valid regex (Unterminated group).',
      'skills.prompts "tax": pattern must be a regex or a string.',
    ],
  })
})

test('a project prompt rule written as a string is matched case-insensitively', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{ skills: { prompts: [{ id: 'invoicing', pattern: '\\\\binvoic', skills: ['invoicing-rules'], why: 'x' }] } }`)
  )

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.ok(config.skills.prompts.find((rule) => rule.id === 'invoicing').pattern.test('Fix the Invoice total'))
})

test('a config without tracker or domain gets GitHub with every role as its own label, and one context at the root', async () => {
  // Given
  const project = fixtureProject(configOf(`{}`))

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(config.tracker, {
    kind: 'github',
    labels: {
      bug: 'bug',
      enhancement: 'enhancement',
      'needs-triage': 'needs-triage',
      'needs-info': 'needs-info',
      'ready-for-agent': 'ready-for-agent',
      'ready-for-human': 'ready-for-human',
      wontfix: 'wontfix',
    },
  })
  assert.deepEqual(config.domain, { contexts: ['.'] })
})

test('a project’s tracker labels replace only the roles it names', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{ tracker: { kind: 'local', labels: { 'needs-triage': 'triage', wontfix: 'declined' } } }`)
  )

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.equal(config.tracker.kind, 'local')
  assert.equal(config.tracker.labels['needs-triage'], 'triage')
  assert.equal(config.tracker.labels.wontfix, 'declined')
  assert.equal(config.tracker.labels['ready-for-agent'], 'ready-for-agent')
})

test('an unknown tracker kind, an unknown role and a label that is not a string are context errors that leave every rule in force', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      stacks: { 'kotlin-spring': { roots: ['acme-api'] } },
      tracker: { kind: 'jira', labels: { 'needs-review': 'review', wontfix: 7 } },
    }`),
    ['acme-api']
  )

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(config.contextErrors, [
    'tracker.kind: expected "github" or "local", not "jira".',
    'tracker.labels: there is no role "needs-review". Roles: bug, enhancement, needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix.',
    'tracker.labels.wontfix: expected a label name.',
  ])
  assert.deepEqual(config.tdd.files, ['acme-api/src/**/*.kt'])
})

test('domain contexts that are not a list, or name a directory the project lacks, are context errors', async () => {
  // Given
  const notAList = fixtureProject(configOf(`{ domain: { contexts: 'acme-api' } }`))
  const missing = fixtureProject(configOf(`{ domain: { contexts: ['acme-api', 'globex-web'] } }`), ['acme-api'])

  // When
  const results = [await loadConfig(notAList, PLUGIN_ROOT), await loadConfig(missing, PLUGIN_ROOT)]

  // Then
  assert.deepEqual(
    results.map(({ config }) => config.contextErrors),
    [['domain.contexts: expected a list of directories, such as [\'.\'].'], ['domain.contexts: "globex-web" does not exist in the project.']]
  )
})

test('a project prompt rule without a list of skills or a reason is an error naming the rule', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      skills: {
        prompts: [
          { id: 'invoicing', pattern: /invoic/i, skill: 'invoicing-rules', why: 'x' },
          { id: 'tax', pattern: /tax/i, skills: ['tax-rules'] },
        ],
      },
    }`)
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: [
      'skills.prompts "invoicing": skills must be a list of skill names.',
      'skills.prompts "tax": why must say in one line why the skills apply.',
    ],
  })
})

test('a stack’s own format replaces its pack’s, under each of its roots', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      stacks: {
        'kotlin-spring': {
          roots: ['acme-api', './'],
          format: [{ files: ['**/*.kt'], run: [['ktlint', '--format']] }],
        },
      },
    }`),
    ['acme-api']
  )

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  const groups = [{ files: ['**/*.kt'], run: [['ktlint', '--format']] }]
  assert.deepEqual(config.format, [
    { root: 'acme-api', groups },
    { root: '', groups },
  ])
})

test('a stack whose pack has no formatter and that names none formats nothing', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api'] } } }`), ['acme-api'])

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(config.format, [])
})

test('a format group without file globs or without a list of commands is an error naming the stack and group', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{
      stacks: {
        'kotlin-spring': {
          roots: ['acme-api'],
          format: [
            { files: '**/*.kt', run: [['ktlint', '--format']] },
            { files: ['**/*.kts'], run: ['ktlint --format'] },
            { files: ['**/*.md'], run: [[]] },
          ],
        },
      },
    }`),
    ['acme-api']
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: [
      'stacks.kotlin-spring.format[0].files: expected a list of globs.',
      "stacks.kotlin-spring.format[1].run: expected a list of commands, each a list of words, such as [['prettier', '--write']].",
      "stacks.kotlin-spring.format[2].run: expected a list of commands, each a list of words, such as [['prettier', '--write']].",
    ],
  })
})

test('a format that is not a list of groups is an error, not a formatter that never runs', async () => {
  // Given
  const project = fixtureProject(
    configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api'], format: { files: ['**/*.kt'] } } } }`),
    ['acme-api']
  )

  // When
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(result, {
    errors: ['stacks.kotlin-spring.format: expected a list of groups, each { files: [globs], run: [commands] }.'],
  })
})

test('a nuxt stack formats script and Vue files with prettier then eslint, and other text with prettier alone', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { nuxt: { roots: ['acme-web'] } } }`), ['acme-web'])

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  const prettier = ['pnpm', 'exec', 'prettier', '--write', '--log-level', 'warn']
  assert.deepEqual(config.format, [
    {
      root: 'acme-web',
      groups: [
        { files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'], run: [prettier, ['pnpm', 'exec', 'eslint', '--fix']] },
        { files: ['**/*.{json,css,md,yml,yaml}'], run: [prettier] },
      ],
    },
  ])
})

test('a pack’s duplication-gate test globs land under every one of its roots, with its formats and remedy', async () => {
  // Given
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api', './'] } } }`), ['acme-api'])

  // When
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then
  assert.deepEqual(
    config.duplication.map(({ pack, root, tests, formats }) => ({ pack, root, tests, formats })),
    [
      { pack: 'kotlin-spring', root: 'acme-api', tests: ['acme-api/src/*[tT]est*/**/*.kt'], formats: ['kotlin'] },
      { pack: 'kotlin-spring', root: '', tests: ['src/*[tT]est*/**/*.kt'], formats: ['kotlin'] },
    ]
  )
  assert.match(config.duplication[0].remedy, /Pull Up Method/)
})

test('a pack’s mutation engine lands under every one of its roots, with a stack’s override in place of its defaults', async () => {
  // Given kotlin-spring under two roots, one stack overriding the run command and memory cap
  const project = fixtureProject(
    configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api', './'], mutation: { run: ['./gradlew', 'pitest', '-Ptargets={targets}'], memory: '4G' } } } }`),
    ['acme-api']
  )

  // When the config loads
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then each root has the engine with root-prefixed source and test globs, the override's run and memory, and the pack's report and notes
  assert.deepEqual(
    config.mutation.map(({ pack, root, engine, source, tests, run, report, memory }) => ({ pack, root, engine, source, tests, run, report, memory })),
    [
      { pack: 'kotlin-spring', root: 'acme-api', engine: 'pitest', source: ['acme-api/src/main/kotlin/**/*.kt'], tests: ['acme-api/src/*[tT]est*/**/*.kt'], run: ['./gradlew', 'pitest', '-Ptargets={targets}'], report: 'build/reports/pitest/mutations.xml', memory: '4G' },
      { pack: 'kotlin-spring', root: '', engine: 'pitest', source: ['src/main/kotlin/**/*.kt'], tests: ['src/*[tT]est*/**/*.kt'], run: ['./gradlew', 'pitest', '-Ptargets={targets}'], report: 'build/reports/pitest/mutations.xml', memory: '4G' },
    ]
  )
  assert.match(config.mutation[0].notes, /kotlin-spring\/skills\/backend-dev\/references\/pitest\.md$/)
})

test('a mutation override with a run that never names the targets, a bad report or a bad memory cap is an error per field', async () => {
  // Given a nuxt stack whose override would sweep the whole surface, names no report path and caps memory in words
  const project = fixtureProject(
    configOf(`{ stacks: { nuxt: { roots: ['acme-web'], mutation: { run: ['pnpm', 'test:mutation'], report: 42, memory: 'lots' } } } }`),
    ['acme-web']
  )

  // When the config loads
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then each bad field is named under the stack
  assert.deepEqual(result, {
    errors: [
      "stacks.nuxt.mutation.run: expected a command as a list of words, one holding {targets}, such as ['./gradlew', 'mutationTest', '-Ptargets={targets}'].",
      'stacks.nuxt.mutation.report: expected a path relative to the root.',
      "stacks.nuxt.mutation.memory: expected a size such as '8G'.",
    ],
  })
})

test('a stack whose pack has no mutation engine sweeps nothing', async () => {
  // Given only the web-e2e pack, which carries no engine
  const project = fixtureProject(configOf(`{ stacks: { 'web-e2e': { roots: ['acme-e2e'] } } }`), ['acme-e2e'])

  // When the config loads
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then there is no mutation stack
  assert.deepEqual(config.mutation, [])
})

test('a web-e2e stack verifies at the pack’s default targets, with the project’s verify block under its root', async () => {
  // Given a web-e2e stack whose verify block names its dev server, user minting and API
  const project = fixtureProject(
    configOf(`{ stacks: { 'web-e2e': { roots: ['acme-web'], verify: {
      stack: { up: ['docker', 'compose', 'up', '-d'], down: ['docker', 'compose', 'down'], disposableDb: { up: ['make', 'db-up'], down: ['make', 'db-down'] } },
      dev: { run: ['pnpm', 'dev'], port: 3000, ready: /Local:\\s+(http\\S+)/ },
      user: { mint: ['node', 'scripts/mint-user.mjs', '--email', '{email}'], env: { file: '.env', key: 'ACME_DEV_TOKEN' } },
      api: { base: '/api', csrf: { cookie: 'XSRF-TOKEN', header: 'X-XSRF-TOKEN' } },
    } } } }`),
    ['acme-web']
  )

  // When the config loads
  const { config, errors } = await loadConfig(project, PLUGIN_ROOT)

  // Then the stack verifies under its root at desktop and phone, with the project's commands and its API's auth defaulted
  assert.equal(errors, undefined)
  assert.deepEqual(config.verify, [
    {
      pack: 'web-e2e',
      root: 'acme-web',
      targets: { desktop: [1440, 900], phone: [390, 844] },
      stack: { up: ['docker', 'compose', 'up', '-d'], down: ['docker', 'compose', 'down'], disposableDb: { up: ['make', 'db-up'], down: ['make', 'db-down'] } },
      dev: { run: ['pnpm', 'dev'], port: 3000, ready: /Local:\s+(http\S+)/ },
      user: { mint: ['node', 'scripts/mint-user.mjs', '--email', '{email}'], env: { file: '.env', key: 'ACME_DEV_TOKEN' } },
      api: { base: '/api', csrf: { cookie: 'XSRF-TOKEN', header: 'X-XSRF-TOKEN', prime: '' }, auth: { header: 'Authorization', value: 'Bearer {token}' } },
    },
  ])
})

test('a project’s verify targets replace the pack’s, and a stack with no verify block still has them', async () => {
  // Given one web-e2e root that only overrides its targets, and a kotlin-spring stack whose pack never verifies
  const project = fixtureProject(
    configOf(`{ stacks: { 'web-e2e': { roots: ['acme-web'], verify: { targets: { tablet: [820, 1180] } } }, 'kotlin-spring': { roots: ['acme-api'] } } }`),
    ['acme-web', 'acme-api']
  )

  // When the config loads
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then only the web-e2e root verifies, at the tablet target alone, with nothing to start
  assert.deepEqual(config.verify, [{ pack: 'web-e2e', root: 'acme-web', targets: { tablet: [820, 1180] } }])
})

test('a verify block with bad targets, commands, ready pattern, user or API is an error per field', async () => {
  // Given a verify block wrong in every field
  const project = fixtureProject(
    configOf(`{ stacks: { 'web-e2e': { roots: ['acme-web'], verify: {
      targets: { 'big screen': [1440], phone: [390, 844] },
      stack: { up: 'docker compose up', disposableDb: { up: ['make', 'db-up'] } },
      dev: { run: ['pnpm', 'dev'], port: 'three thousand', ready: '(unclosed' },
      user: { mint: ['node', 'mint.mjs'], env: { file: '.env' } },
      api: { base: 'api', csrf: { cookie: 'XSRF-TOKEN' }, auth: { header: 'Authorization', value: 'Bearer' } },
      seed: ['x'],
    } } } }`),
    ['acme-web']
  )

  // When the config loads
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then each bad field is named under the stack, so the session starts with the config error
  assert.deepEqual(result, {
    errors: [
      'stacks.web-e2e.verify: there is no field "seed". Fields: targets, stack, dev, user, api.',
      "stacks.web-e2e.verify.targets: expected { name: [width, height] } with names of lowercase letters, digits and dashes, such as { desktop: [1440, 900] }.",
      "stacks.web-e2e.verify.stack.up: expected a command as a list of words, such as ['docker', 'compose', 'up', '-d'].",
      "stacks.web-e2e.verify.stack.down: expected a command as a list of words, such as ['docker', 'compose', 'down'].",
      "stacks.web-e2e.verify.stack.disposableDb.down: expected a command as a list of words, such as ['docker', 'compose', 'down'].",
      'stacks.web-e2e.verify.dev.port: expected a port number.',
      'stacks.web-e2e.verify.dev.ready: expected a regex whose first group captures the URL the dev log reports, such as /Local:\\s+(http\\S+)/.',
      "stacks.web-e2e.verify.user.mint: expected a command as a list of words, one holding {email}, such as ['node', 'scripts/mint-user.mjs', '--email', '{email}'].",
      "stacks.web-e2e.verify.user.env: expected { file, key }, such as { file: '.env', key: 'ACME_DEV_TOKEN' }.",
      "stacks.web-e2e.verify.api.base: expected a path starting with /, such as '/api'.",
      "stacks.web-e2e.verify.api.csrf: expected { cookie, header }, such as { cookie: 'XSRF-TOKEN', header: 'X-XSRF-TOKEN' }.",
      "stacks.web-e2e.verify.api.auth: expected { header, value } with {token} in the value, such as { header: 'Authorization', value: 'Bearer {token}' }.",
    ],
  })
})

test('the sign-off runs the gates a config selects in core’s order, whatever order the config lists them in', async () => {
  // Given a config selecting three gates, listed against core's order
  const project = fixtureProject(configOf(`{ signOff: { gates: ['check-adrs', 'code-review', 'simplify'] } }`))

  // When the config is loaded
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then the sign-off holds exactly those gates, in core's order
  assert.deepEqual(config.signOff.gates, ['simplify', 'code-review', 'check-adrs'])
})

test('with no signOff, every gate whose engine an enabled pack provides is selected', async () => {
  // Given a config enabling nuxt, which brings a mutation engine and no verify engine, and no signOff
  const project = fixtureProject(configOf(`{ stacks: { nuxt: { roots: ['acme-web'] } } }`), ['acme-web'])

  // When the config is loaded
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then every gate is selected except verify, which no enabled pack provides
  assert.deepEqual(config.signOff.gates, ['simplify', 'mutation', 'code-review', 'check-adrs'])
})

test('an unknown sign-off gate is an error listing the gates there are', async () => {
  // Given a config selecting a gate core has no such name for
  const project = fixtureProject(configOf(`{ signOff: { gates: ['simplify', 'lint'] } }`))

  // When the config is loaded
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then the error names the gate and lists the valid ones
  assert.deepEqual(result, {
    errors: ['signOff.gates: there is no gate "lint". Gates: simplify, mutation, code-review, check-adrs, verify.'],
  })
})

test('an engine gate no enabled pack provides is an error naming the fix', async () => {
  // Given a config selecting verify while enabling only kotlin-spring, which brings no verify engine
  const project = fixtureProject(configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api'] } }, signOff: { gates: ['mutation', 'verify'] } }`), ['acme-api'])

  // When the config is loaded
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then the error says no enabled pack provides it, and how to fix that
  assert.deepEqual(result, {
    errors: ['signOff.gates: no enabled pack provides a verify engine. Enable a stack whose pack has one, or drop "verify" from the gates.'],
  })
})

test('sign-off gates or docs that are not a list are an error, not a sign-off that runs nothing', async () => {
  // Given a config whose signOff gates is a string and whose docs hold a number
  const project = fixtureProject(configOf(`{ signOff: { gates: 'simplify', docs: [3] } }`))

  // When the config is loaded
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then both are errors saying the shape expected
  assert.deepEqual(result, {
    errors: [
      "signOff.gates: expected a list of gates, such as ['simplify', 'code-review'].",
      "signOff.docs: expected a list of globs, such as ['docs/**/*.md'].",
    ],
  })
})

test('a signOff field core does not know is an error listing the fields', async () => {
  // Given a config with an order field, which a project cannot set
  const project = fixtureProject(configOf(`{ signOff: { gates: ['simplify'], order: ['simplify'] } }`))

  // When the config is loaded
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then the error names the field and the ones there are
  assert.deepEqual(result, { errors: ['signOff: there is no field "order". Fields: gates, docs.'] })
})

test('the sign-off docs a config lists are kept for the doc-drift greps, and default to none', async () => {
  // Given one config listing docs and one with a signOff that lists none
  const listed = fixtureProject(configOf(`{ signOff: { docs: ['docs/**/*.md', 'DESIGN.md'] } }`))
  const unlisted = fixtureProject(configOf(`{ signOff: { gates: ['simplify'] } }`))

  // When both are loaded
  const [a, b] = await Promise.all([loadConfig(listed, PLUGIN_ROOT), loadConfig(unlisted, PLUGIN_ROOT)])

  // Then the listed docs are kept, the unlisted are empty, and docs alone leave every available gate selected
  assert.deepEqual(a.config.signOff, { gates: ['simplify', 'code-review', 'check-adrs'], docs: ['docs/**/*.md', 'DESIGN.md'] })
  assert.deepEqual(b.config.signOff, { gates: ['simplify'], docs: [] })
})

test('each stack root gets its pack’s check commands, unless the stack names its own', async () => {
  // Given kotlin-spring at two roots with the pack's check, and nuxt with a check of its own
  const project = fixtureProject(
    configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api', './globex-api/'] }, nuxt: { roots: ['acme-web'], check: [['npm', 'run', 'verify']] } } }`),
    ['acme-api', 'globex-api', 'acme-web']
  )

  // When the config is loaded
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then each root carries the commands its stack runs to build and test it
  assert.deepEqual(config.check, [
    { pack: 'kotlin-spring', root: 'acme-api', run: [['./gradlew', 'build']] },
    { pack: 'kotlin-spring', root: 'globex-api', run: [['./gradlew', 'build']] },
    { pack: 'nuxt', root: 'acme-web', run: [['npm', 'run', 'verify']] },
  ])
})

test('a stack check that is not a list of commands is an error showing the shape', async () => {
  // Given a nuxt stack whose check is one command rather than a list of them
  const project = fixtureProject(configOf(`{ stacks: { nuxt: { roots: ['acme-web'], check: ['pnpm', 'test'] } } }`), ['acme-web'])

  // When the config is loaded
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then the error shows a list of commands, each a list of words
  assert.deepEqual(result, {
    errors: ["stacks.nuxt.check: expected a list of commands, each a list of words, such as [['pnpm', 'lint'], ['pnpm', 'test']]."],
  })
})

test('each stack root gets its pack’s lint commands, unless the stack names its own', async () => {
  // Given kotlin-spring at a root with the pack's lint, and nuxt with a lint of its own
  const project = fixtureProject(
    configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api'] }, nuxt: { roots: ['acme-web'], lint: [['npx', 'biome', 'check', '{staged}']] } } }`),
    ['acme-api', 'acme-web']
  )

  // When the config is loaded
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then each root carries the commands its pre-commit hook runs
  assert.deepEqual(config.lint, [
    { pack: 'kotlin-spring', root: 'acme-api', run: [['./gradlew', 'detekt']] },
    { pack: 'nuxt', root: 'acme-web', run: [['npx', 'biome', 'check', '{staged}']] },
  ])
})

test('a nuxt root lints its staged files with ESLint and typechecks, unless it has lint-staged', async () => {
  // Given one nuxt root without lint-staged and one whose package.json configures it
  const project = fixtureProject(configOf(`{ stacks: { nuxt: { roots: ['acme-web', 'globex-web'] } } }`), ['acme-web', 'globex-web'])
  writeFileSync(join(project, 'globex-web', 'package.json'), JSON.stringify({ 'lint-staged': { '*.ts': 'eslint --fix' } }))

  // When the config is loaded
  const { config } = await loadConfig(project, PLUGIN_ROOT)

  // Then the first runs ESLint on its staged files and the typecheck, and the second runs its lint-staged
  assert.deepEqual(config.lint, [
    { pack: 'nuxt', root: 'acme-web', run: [['pnpm', 'exec', 'eslint', '--no-warn-ignored', '{staged}'], ['pnpm', 'typecheck']] },
    { pack: 'nuxt', root: 'globex-web', run: [['pnpm', 'exec', 'lint-staged']] },
  ])
})

test('a stack lint with {staged} anywhere but its last word is an error showing the shape', async () => {
  // Given a nuxt stack whose lint puts the staged files before a flag
  const project = fixtureProject(configOf(`{ stacks: { nuxt: { roots: ['acme-web'], lint: [['eslint', '{staged}', '--fix']] } } }`), ['acme-web'])

  // When the config is loaded
  const result = await loadConfig(project, PLUGIN_ROOT)

  // Then the error says where {staged} goes
  assert.deepEqual(result, {
    errors: [
      "stacks.nuxt.lint: expected a list of commands, each a list of words, with {staged} only as a command's last word, such as [['pnpm', 'exec', 'eslint', '{staged}']].",
    ],
  })
})
