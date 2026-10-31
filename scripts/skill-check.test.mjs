import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findAgentProblems, findSkillProblems } from './skill-check.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

test('a SKILL.md whose name differs from its directory is a problem', () => {
  // Given
  const files = [{ path: 'plugins/acme/skills/billing/SKILL.md', content: '---\nname: invoicing\ndescription: Bills.\n---\n' }]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, ['plugins/acme/skills/billing/SKILL.md: name "invoicing" should be "billing"'])
})

test('the name is read from the frontmatter only, with its quotes stripped', () => {
  // Given
  const files = [{ path: 'plugins/acme/skills/billing/SKILL.md', content: '---\nname: "billing"\n---\nname: invoicing\n' }]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, [])
})

test('a relative markdown link to a file that does not exist is a problem, and one that does is not', () => {
  // Given
  const files = [
    { path: 'plugins/acme/skills/billing/SKILL.md', content: '---\nname: billing\n---\nSee [rounding](ROUNDING.md) and [tax](../tax/TAX.md).\n' },
    { path: 'plugins/acme/skills/billing/ROUNDING.md', content: 'Round half up. [Site](https://example.com) [Top](#top)\n' }
  ]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, ['plugins/acme/skills/billing/SKILL.md:4: link "../tax/TAX.md" points at no file'])
})

test('a link inside a fenced code block is an example, not a link', () => {
  // Given
  const files = [{ path: 'plugins/acme/skills/billing/SKILL.md', content: '---\nname: billing\n---\n```md\n[Globex](./src/globex/CONTEXT.md)\n```\n' }]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, [])
})

test('a link inside an inline code span is an example, and a link to a directory resolves when the directory holds a file', () => {
  // Given
  const files = [
    { path: 'plugins/acme/skills/billing/SKILL.md', content: '---\nname: billing\n---\nWrite `[Globex](./CONTEXT.md)`. Scripts in [scripts](scripts/).\n' },
    { path: 'plugins/acme/skills/billing/scripts/round.sh', content: 'echo' }
  ]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, [])
})

test('a four-backtick fence holding a three-backtick block stays an example to its own closing fence, as does a tilde fence', () => {
  // Given
  const example = '````md\n```\ncode\n```\n[Ref](REFERENCE.md)\n````\n~~~\n[Ref](REFERENCE.md)\n~~~\n'
  const files = [{ path: 'plugins/acme/skills/billing/SKILL.md', content: `---\nname: billing\n---\n${example}[Gone](GONE.md)\n` }]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, ['plugins/acme/skills/billing/SKILL.md:13: link "GONE.md" points at no file'])
})

test('links in a plugin reference file are checked too, and a root-absolute link is left alone', () => {
  // Given
  const files = [{ path: 'plugins/acme/reference/tracker.md', content: 'See [docs](/docs/adr/) and [labels](LABELS.md).\n' }]

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, ['plugins/acme/reference/tracker.md:1: link "LABELS.md" points at no file'])
})

test('every skill shipped in this repo is named for its directory and links only to files that exist', () => {
  // Given
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'plugins'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path && existsSync(join(REPO, path)))
    .map((path) => ({ path, content: readFileSync(join(REPO, path), 'utf8') }))

  // When
  const problems = findSkillProblems(files)

  // Then
  assert.deepEqual(problems, [])
})

test('every skill a core or pack rule names has a SKILL.md in its own plugin, and only project rules are worktree-scoped', async () => {
  // Given
  const plugins = readdirSync(join(REPO, 'plugins')).filter((plugin) => existsSync(join(REPO, 'plugins', plugin, 'skrymer-ai.pack.mjs')))
  const rules = []
  for (const plugin of plugins) {
    const fragment = (await import(pathToFileURL(join(REPO, 'plugins', plugin, 'skrymer-ai.pack.mjs')).href)).default
    for (const rule of [...(fragment.skills?.files ?? []), ...(fragment.skills?.prompts ?? [])]) rules.push({ plugin, rule })
  }

  // When
  const problems = rules.flatMap(({ plugin, rule }) => [
    ...rule.skills
      .filter((skill) => {
        const [owner, name] = skill.split(':')
        return !name || !existsSync(join(REPO, 'plugins', owner, 'skills', name, 'SKILL.md'))
      })
      .map((skill) => `${plugin} rule "${rule.id}" names ${skill}, which has no SKILL.md`),
    ...(rule.worktreeScoped ? [`${plugin} rule "${rule.id}" is worktree-scoped`] : []),
  ])

  // Then
  assert.ok(plugins.includes('core') && rules.length > 0)
  assert.deepEqual(problems, [])
})

const agent = (frontmatter) => ({ path: 'plugins/core/agents/adversary.md', content: `---\n${frontmatter}\n---\n\nYou argue.\n` })

test('a judging agent that can write, or that inherits every tool, is a problem', () => {
  // Given one agent listing Edit, one listing no tools at all, and one with memory, which turns on writing
  const files = [
    agent('name: adversary\ntools: Read, Edit, Bash\nmodel: inherit'),
    { ...agent('name: retro-miner\nmodel: inherit'), path: 'plugins/core/agents/retro-miner.md' },
    { ...agent('name: blind-arbiter\ntools: Read\nmodel: inherit\nmemory: project'), path: 'plugins/core/agents/blind-arbiter.md' },
  ]

  // When the agents are checked
  const problems = findAgentProblems(files)

  // Then each is named with what makes it able to write
  assert.deepEqual(problems, [
    'plugins/core/agents/adversary.md: tools include Edit; a judging agent is read-only',
    'plugins/core/agents/retro-miner.md: no tools list, so it inherits Edit and Write; list its tools',
    'plugins/core/agents/blind-arbiter.md: memory turns on Write and Edit; a judging agent is read-only',
  ])
})

test('a judging agent on a model of its own, or named apart from its file, is a problem', () => {
  // Given an agent pinned to a model and named for another file
  const files = [agent('name: devils-advocate\ntools: Read, Grep\nmodel: opus')]

  // When the agents are checked
  const problems = findAgentProblems(files)

  // Then both are named
  assert.deepEqual(problems, [
    'plugins/core/agents/adversary.md: name "devils-advocate" should be "adversary"',
    'plugins/core/agents/adversary.md: model "opus" should be "inherit"; neutrality comes from a fresh context, not a different model',
  ])
})

test('the break-it tester is the one agent on a model of its own: Opus, and nothing else', () => {
  // Given the break-it tester on Opus, and again on the session's model
  const tester = (model) => ({ ...agent(`name: break-it-tester\ntools: Bash, Read, Grep, Glob\nmodel: ${model}`), path: 'plugins/core/agents/break-it-tester.md' })

  // When each is checked
  const onOpus = findAgentProblems([tester('opus')])
  const inherited = findAgentProblems([tester('inherit')])

  // Then Opus is no problem, and the session's model is
  assert.deepEqual(onOpus, [])
  assert.deepEqual(inherited, ['plugins/core/agents/break-it-tester.md: model "inherit" should be "opus"; exploring for what nobody asked about is where the strongest model earns its cost'])
})

test('every agent shipped in this repo is read-only, runs on its model and is named for its file', () => {
  // Given every agent definition under plugins/
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'plugins/*/agents/*.md'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path && existsSync(join(REPO, path)))
    .map((path) => ({ path, content: readFileSync(join(REPO, path), 'utf8') }))

  // When they are checked
  const problems = findAgentProblems(files)

  // Then core ships the sign-off's agents and none has a problem
  assert.deepEqual(
    files.map(({ path }) => path.split('/').at(-1)).sort(),
    ['acceptance-ledger.md', 'adversary.md', 'blind-arbiter.md', 'break-it-tester.md', 'check-adrs.md', 'code-reviewer.md', 'resolutions.md', 'retro-miner.md', 'verdict-auditor.md']
  )
  assert.deepEqual(problems, [])
})
