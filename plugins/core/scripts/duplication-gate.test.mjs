import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'duplication-gate.mjs')

const configOf = (body) => `
import { defineConfig } from 'skrymer-ai'

export default defineConfig(${body})
`

const kotlinConfig = configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api'] } } }`)

/** Git without the developer's own config, so a global signing key or hook can't reach the fixtures. */
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.email=dev@acme.test', '-c', 'user.name=dev', ...args], { cwd, stdio: 'pipe', env: { ...process.env, ...GIT_ENV } })

// The deny tests run the real jscpd through npx, so its first download happens before them,
// not inside one test's time limit.
before(() => execFileSync('npx', ['-y', 'jscpd@5.4.0', '--version'], { stdio: 'ignore' }))

/**
 * A temp project in a git repo whose `origin` has [base] on `main`, checked out on a feature
 * branch with [branch] written on top and left uncommitted. Each of [base] and [branch] maps a
 * project-relative path to its content.
 */
function gitProject(config, base, branch = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'duplication-gate-project-'))
  const write = (files) => {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true })
      writeFileSync(join(dir, file), content)
    }
  }
  write({ '.claude/skrymer-ai.config.mjs': config, ...base })
  const origin = mkdtempSync(join(tmpdir(), 'duplication-gate-origin-'))
  git(origin, 'init', '-q', '--bare', '-b', 'main')
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'base')
  git(dir, 'remote', 'add', 'origin', origin)
  git(dir, 'push', '-q', 'origin', 'main')
  git(dir, 'remote', 'set-head', 'origin', 'main')
  git(dir, 'switch', '-qc', 'feature')
  write(branch)
  return dir
}

/** A Kotlin class named [name] whose one function is long enough to count as a clone of another. */
const kotlinClass = (name) => `package acme

class ${name} {
    fun total(lines: List<Int>): Int {
        var sum = 0
        for (line in lines) {
            if (line > 10) {
                sum += line * 2
            } else {
                sum += line + 3
            }
        }
        return sum
    }
}
`

const kotlinTest = (name) => `package acme

import org.junit.jupiter.api.Test

class ${name} {
    @Test
    fun \`totals the lines\`() {
    }
}
`

/** Runs the hook on a pending [toolInput] in [project], with [env] added. */
function runHook(project, toolInput, env = {}) {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'old_string' in toolInput ? 'Edit' : 'Write',
      tool_input: { ...toolInput, file_path: join(project, toolInput.file_path) },
    }),
    env: { ...process.env, ...GIT_ENV, CLAUDE_PROJECT_DIR: project, SKRYMER_AI_DUPLICATION_GATE_TIMEOUT_MS: '30000', ...env },
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('a new Kotlin test is refused while the branch holds new duplication, naming the pair and the Kotlin moves', () => {
  // Given
  const project = gitProject(
    kotlinConfig,
    { 'acme-api/src/main/kotlin/InvoiceTotals.kt': kotlinClass('InvoiceTotals') },
    { 'acme-api/src/main/kotlin/OrderTotals.kt': kotlinClass('OrderTotals') }
  )

  // When
  const { status, stdout } = runHook(project, {
    file_path: 'acme-api/src/test/kotlin/OrderTotalsTest.kt',
    content: kotlinTest('OrderTotalsTest'),
  })

  // Then
  assert.equal(status, 0)
  const out = JSON.parse(stdout).hookSpecificOutput
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /acme-api\/src\/main\/kotlin\/InvoiceTotals\.kt:\d+ ↔ acme-api\/src\/main\/kotlin\/OrderTotals\.kt:\d+/)
  assert.match(out.permissionDecisionReason, /refactoring\.com\/catalog/)
  assert.match(out.permissionDecisionReason, /Pull Up Method/)
})

const nuxtConfig = configOf(`{ stacks: { nuxt: { roots: ['acme-web'] } } }`)

/** A Vue component named by its [label] whose script is long enough to count as a clone of another. */
const vueComponent = (label) => `<script setup lang="ts">
const props = defineProps<{ lines: number[] }>()

const total = computed(() => {
  let sum = 0
  for (const line of props.lines) {
    if (line > 10) {
      sum += line * 2
    } else {
      sum += line + 3
    }
  }
  return sum
})
</script>

<template>
  <p>${label}: {{ total }}</p>
</template>
`

const vitestSpec = `import { it } from 'vitest'

it('shows the total', () => {})
`

const silent = (result) => {
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
}

const skippedWith = (result, cause) => {
  assert.equal(result.status, 0)
  const out = JSON.parse(result.stdout)
  assert.match(out.systemMessage, new RegExp(`^duplication-gate skipped: .*${cause}`))
  assert.equal(out.hookSpecificOutput.additionalContext, out.systemMessage)
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined)
}

const kotlinClone = {
  base: { 'acme-api/src/main/kotlin/InvoiceTotals.kt': kotlinClass('InvoiceTotals') },
  branch: { 'acme-api/src/main/kotlin/OrderTotals.kt': kotlinClass('OrderTotals') },
}

const newKotlinTest = { file_path: 'acme-api/src/test/kotlin/OrderTotalsTest.kt', content: kotlinTest('OrderTotalsTest') }

test('a new Vue test is refused while the branch holds a duplicated component, naming the files and the Vue moves', () => {
  // Given
  const project = gitProject(
    nuxtConfig,
    { 'acme-web/app/components/InvoiceTotal.vue': vueComponent('Invoice') },
    { 'acme-web/app/components/OrderTotal.vue': vueComponent('Order') }
  )

  // When
  const result = runHook(project, { file_path: 'acme-web/app/components/OrderTotal.test.ts', content: vitestSpec })

  // Then
  const out = JSON.parse(result.stdout).hookSpecificOutput
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /acme-web\/app\/components\/InvoiceTotal\.vue:\d+ ↔ acme-web\/app\/components\/OrderTotal\.vue:\d+ /)
  assert.match(out.permissionDecisionReason, /composable/)
  assert.doesNotMatch(out.permissionDecisionReason, /Pull Up Method/)
})

test('duplication the baseline already has never blocks', () => {
  // Given
  const project = gitProject(kotlinConfig, { ...kotlinClone.base, ...kotlinClone.branch })

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('an edit to a test file that adds no test passes while duplication exists', () => {
  // Given
  const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)

  // When / Then
  silent(runHook(project, { file_path: newKotlinTest.file_path, old_string: '@Test\n    fun a() {}', new_string: '@Test\n    fun b() {}' }))
})

test('rewriting a test file whole without adding a test passes', () => {
  // Given
  const project = gitProject(kotlinConfig, { ...kotlinClone.base, [newKotlinTest.file_path]: newKotlinTest.content }, kotlinClone.branch)

  // When / Then
  silent(runHook(project, { ...newKotlinTest, content: newKotlinTest.content.replace('totals', 'sums') }))
})

test('a call that only ends in it( or test( is not a new test', () => {
  // Given
  const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)

  // When / Then
  silent(runHook(project, { file_path: newKotlinTest.file_path, old_string: 'x', new_string: 'form.submit(); runLatest()' }))
})

test('a source write passes while duplication exists, so the refactor itself can land', () => {
  // Given
  const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)

  // When / Then
  silent(runHook(project, { file_path: 'acme-api/src/main/kotlin/Totals.kt', content: '@Test fun test() {}' }))
})

test('Kotlin duplication never blocks a Vue test: only the writing stack is scanned', () => {
  // Given
  const project = gitProject(
    configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api'] }, nuxt: { roots: ['acme-web'] } } }`),
    { ...kotlinClone.base, 'acme-web/app/components/InvoiceTotal.vue': vueComponent('Invoice') },
    kotlinClone.branch
  )

  // When / Then
  silent(runHook(project, { file_path: 'acme-web/app/components/InvoiceTotal.test.ts', content: vitestSpec }))
})

test('duplication between test files never blocks', () => {
  // Given
  const body = kotlinClass('X').replace('package acme\n', '')
  const project = gitProject(
    kotlinConfig,
    { 'acme-api/src/test/kotlin/InvoiceTotalsTest.kt': kotlinTest('InvoiceTotalsTest') + body },
    { 'acme-api/src/test/kotlin/OrderHelpers.kt': `package acme\n${body}` }
  )

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('duplication of nothing but package lines, imports and comments never blocks', () => {
  // Given
  const preamble = (name) =>
    `package acme.billing.invoices\n\n${['java.time.Instant', 'java.time.LocalDate', 'java.util.UUID', 'org.springframework.stereotype.Service', 'org.springframework.transaction.annotation.Transactional', 'org.springframework.beans.factory.annotation.Autowired', 'com.fasterxml.jackson.databind.ObjectMapper', 'org.slf4j.LoggerFactory'].map((i) => `import ${i}`).join('\n')}\n\nclass ${name}\n`
  const project = gitProject(
    kotlinConfig,
    { 'acme-api/src/main/kotlin/InvoiceService.kt': preamble('InvoiceService') },
    { 'acme-api/src/main/kotlin/OrderService.kt': preamble('OrderService') }
  )

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('a copy whose kept side is wrapped in jscpd:ignore markers passes', () => {
  // Given
  const kept = kotlinClass('OrderTotals').replace('    fun total', '    // jscpd:ignore-start: a deliberate copy\n    fun total').replace(/\n}\n$/, '\n    // jscpd:ignore-end\n}\n')
  const project = gitProject(kotlinConfig, kotlinClone.base, { 'acme-api/src/main/kotlin/OrderTotals.kt': kept })

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('a project’s own TDD globs under the stack’s roots are scanned too', () => {
  // Given
  const project = gitProject(
    configOf(`{ stacks: { 'kotlin-spring': { roots: ['acme-api'] } }, tdd: { files: ['acme-api/scripts/**/*.kts'] } }`),
    {},
    { 'acme-api/scripts/invoice.kts': kotlinClass('InvoiceTotals'), 'acme-api/scripts/order.kts': kotlinClass('OrderTotals') }
  )

  // When
  const result = runHook(project, newKotlinTest)

  // Then
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, /acme-api\/scripts\/invoice\.kts:\d+ ↔ acme-api\/scripts\/order\.kts/)
})

test('the baseline is origin’s default branch as origin/HEAD names it', () => {
  // Given: the duplication is already on trunk, which origin/HEAD names, but not on main
  const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)
  git(project, 'add', '-A')
  git(project, 'commit', '-qm', 'clone')
  git(project, 'push', '-q', 'origin', 'feature:trunk')
  git(project, 'remote', 'set-head', 'origin', 'trunk')

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('without origin/HEAD or origin/main to compare with, the test is let through with the cause said', () => {
  // Given
  const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)
  git(project, 'remote', 'remove', 'origin')

  // When / Then
  skippedWith(runHook(project, newKotlinTest), 'no baseline to compare with.*git remote set-head origin -a')
})

/** A stand-in for jscpd, run as `node` on a script holding [body]. */
function fakeJscpd(body) {
  const script = join(mkdtempSync(join(tmpdir(), 'duplication-gate-jscpd-')), 'jscpd.cjs')
  writeFileSync(script, body)
  return `node ${script}`
}

test('when jscpd fails, its own error is what the skip names', () => {
  // Given
  const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)
  const jscpd = fakeJscpd(`process.stderr.write('Error: initech scanner exploded\\n'); process.exit(2)`)

  // When / Then
  skippedWith(runHook(project, newKotlinTest, { SKRYMER_AI_JSCPD: jscpd }), 'Error: initech scanner exploded$')
})

test('a scan that outlasts its time limit is let through with the limit named', () => {
  // Given
  const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)
  const jscpd = fakeJscpd(`setTimeout(() => {}, 5000)`)

  // When / Then
  skippedWith(runHook(project, newKotlinTest, { SKRYMER_AI_JSCPD: jscpd, SKRYMER_AI_DUPLICATION_GATE_TIMEOUT_MS: '200' }), 'jscpd took longer than 0.2 s$')
})

test('a project without a config is left alone', () => {
  // Given
  const project = mkdtempSync(join(tmpdir(), 'duplication-gate-project-'))

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('an invalid config lets the test through and says the duplication gate did not run', () => {
  // Given
  const project = gitProject(configOf(`{ stacks: { 'no-such-pack': { roots: ['.'] } } }`), {})

  // When / Then
  skippedWith(runHook(project, newKotlinTest), 'project config')
})

/** Commits everything in [project] on its current branch. */
const commitAll = (project, message = 'work') => {
  git(project, 'add', '-A')
  git(project, 'commit', '-qm', message)
}

test('a copy the branch only moved never blocks', () => {
  // Given
  const project = gitProject(kotlinConfig, { ...kotlinClone.base, ...kotlinClone.branch })
  mkdirSync(join(project, 'acme-api/src/main/kotlin/orders'))
  git(project, 'mv', 'acme-api/src/main/kotlin/OrderTotals.kt', 'acme-api/src/main/kotlin/orders/OrderTotals.kt')

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('turning one of three old copies into a delegate never blocks on the two left', () => {
  // Given
  const project = gitProject(kotlinConfig, {
    'acme-api/src/main/kotlin/A.kt': kotlinClass('A'),
    'acme-api/src/main/kotlin/B.kt': kotlinClass('B'),
    'acme-api/src/main/kotlin/C.kt': kotlinClass('C'),
  })
  writeFileSync(join(project, 'acme-api/src/main/kotlin/A.kt'), 'package acme\n\nclass A {\n    fun total(lines: List<Int>) = B().total(lines)\n}\n')

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('an edit elsewhere in a file holding an old clone passes', () => {
  // Given
  const project = gitProject(kotlinConfig, { ...kotlinClone.base, ...kotlinClone.branch })
  writeFileSync(join(project, 'acme-api/src/main/kotlin/OrderTotals.kt'), `${kotlinClass('OrderTotals')}\nconst val LIMIT = 10\n`)

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('an edit inside one copy of an old clone leaves what is still copied as old', () => {
  // Given
  const project = gitProject(kotlinConfig, { ...kotlinClone.base, ...kotlinClone.branch })
  writeFileSync(join(project, 'acme-api/src/main/kotlin/OrderTotals.kt'), kotlinClass('OrderTotals').replace('var sum = 0', 'var sum = 0 // running total'))

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('a branch behind origin’s default branch is judged from where it left it', () => {
  // Given: main removes a copy after the feature branch left it, and the branch hasn't caught up
  const project = gitProject(kotlinConfig, { ...kotlinClone.base, ...kotlinClone.branch })
  git(project, 'switch', '-q', 'main')
  writeFileSync(join(project, 'acme-api/src/main/kotlin/OrderTotals.kt'), 'package acme\n\nclass OrderTotals {\n    fun total(lines: List<Int>) = InvoiceTotals().total(lines)\n}\n')
  commitAll(project)
  git(project, 'push', '-q', 'origin', 'main')
  git(project, 'switch', '-q', 'feature')

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('an old clone in a Vue file is placed by its file lines, so an edit to its template passes', () => {
  // Given: the template comes first, so script lines counted from the script would overlap it
  const templateFirst = (label) => vueComponent(label).replace(/(<script[\s\S]*<\/script>\n)\n(<template>[\s\S]*<\/template>\n)/, '$2\n$1')
  const project = gitProject(nuxtConfig, {
    'acme-web/app/components/InvoiceTotal.vue': templateFirst('Invoice'),
    'acme-web/app/components/OrderTotal.vue': templateFirst('Order'),
  })
  writeFileSync(join(project, 'acme-web/app/components/OrderTotal.vue'), templateFirst('Orders'))

  // When / Then
  silent(runHook(project, { file_path: 'acme-web/app/components/OrderTotal.test.ts', content: vitestSpec }))
})

test('the project’s own jscpd config changes neither what is scanned nor how the scan ends', () => {
  // Given
  const project = gitProject(kotlinConfig, { ...kotlinClone.base, '.jscpd.json': '{ "threshold": 1, "pattern": "**/*.ts", "exitCode": 1 }' }, kotlinClone.branch)

  // When
  const result = runHook(project, newKotlinTest)

  // Then
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny')
})

test('gitignored generated sources never block', () => {
  // Given
  const project = gitProject(kotlinConfig, { '.gitignore': 'acme-api/src/main/kotlin/generated/\n' }, {
    'acme-api/src/main/kotlin/generated/InvoiceApi.kt': kotlinClass('InvoiceApi'),
    'acme-api/src/main/kotlin/generated/OrderApi.kt': kotlinClass('OrderApi'),
  })

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('duplication between integration tests or fixtures never blocks', () => {
  // Given
  const project = gitProject(kotlinConfig, {}, {
    'acme-api/src/integrationTest/kotlin/InvoiceIT.kt': kotlinClass('InvoiceIT'),
    'acme-api/src/testFixtures/kotlin/OrderFixture.kt': kotlinClass('OrderFixture'),
  })

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('a stack at the project root never counts a nested root’s tests as source', () => {
  // Given
  const project = gitProject(configOf(`{ stacks: { 'kotlin-spring': { roots: ['.', 'module-a'] } } }`), {}, {
    'module-a/src/test/kotlin/InvoiceHelpers.kt': kotlinClass('InvoiceHelpers'),
    'module-a/src/test/kotlin/OrderHelpers.kt': kotlinClass('OrderHelpers'),
  })

  // When / Then
  silent(runHook(project, { file_path: 'src/test/kotlin/AppTest.kt', content: kotlinTest('AppTest') }))
})

test('a copy between two roots of one stack is refused', () => {
  // Given
  const project = gitProject(
    configOf(`{ stacks: { 'kotlin-spring': { roots: ['billing', 'orders'] } } }`),
    { 'billing/src/main/kotlin/InvoiceTotals.kt': kotlinClass('InvoiceTotals') },
    { 'orders/src/main/kotlin/OrderTotals.kt': kotlinClass('OrderTotals') }
  )

  // When
  const result = runHook(project, { file_path: 'orders/src/test/kotlin/OrderTotalsTest.kt', content: kotlinTest('OrderTotalsTest') })

  // Then
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, /billing\/src\/main\/kotlin\/InvoiceTotals\.kt:\d+ ↔ orders\/src\/main\/kotlin\/OrderTotals\.kt/)
})

test('duplicated imports and class annotations never block', () => {
  // Given
  const service = (name) =>
    `package acme\n\nimport java.time.Instant\nimport java.util.UUID\nimport org.springframework.stereotype.Service\nimport org.springframework.transaction.annotation.Transactional\nimport org.slf4j.LoggerFactory\n\n@Service\n@Transactional(readOnly = true)\nclass ${name}\n`
  const project = gitProject(kotlinConfig, {}, { 'acme-api/src/main/kotlin/InvoiceService.kt': service('InvoiceService'), 'acme-api/src/main/kotlin/OrderService.kt': service('OrderService') })

  // When / Then
  silent(runHook(project, newKotlinTest))
})

test('duplicated wrapped TypeScript imports never block', () => {
  // Given
  const composable = (name) =>
    `import {\n  computed,\n  ref,\n  watch,\n  onMounted,\n  onUnmounted,\n  nextTick,\n} from 'vue'\nimport { useRoute, useRouter } from 'vue-router'\n\nexport function ${name}() {}\n`
  const project = gitProject(nuxtConfig, {}, { 'acme-web/app/composables/useInvoices.ts': composable('useInvoices'), 'acme-web/app/composables/useOrders.ts': composable('useOrders') })

  // When / Then
  silent(runHook(project, { file_path: 'acme-web/app/composables/useOrders.test.ts', content: vitestSpec }))
})

test('duplicated Vue style blocks never block', () => {
  // Given
  const rules = Array.from({ length: 12 }, (_, i) => `.c${i} { color: red; margin: ${i}px auto; padding: 4px 8px; }`).join('\n')
  const styled = (label) => `<template>\n  <p>${label}</p>\n</template>\n\n<style scoped lang="scss">\n${rules}\n</style>\n`
  const project = gitProject(nuxtConfig, {}, { 'acme-web/app/components/InvoiceTotal.vue': styled('Invoice'), 'acme-web/app/components/OrderTotal.vue': styled('Order') })

  // When / Then
  silent(runHook(project, { file_path: 'acme-web/app/components/OrderTotal.test.ts', content: vitestSpec }))
})

test('when origin/HEAD names a branch that is gone, origin/main is the baseline', () => {
  // Given
  const project = gitProject(kotlinConfig, { ...kotlinClone.base, ...kotlinClone.branch })
  git(project, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master')

  // When / Then
  silent(runHook(project, newKotlinTest))
})

for (const [label, declaration] of [
  ['a parameterized JUnit test', '@ParameterizedTest\n    @ValueSource(ints = [1, 2])\n    fun totals(n: Int) {}'],
  ['a Kotest case', '"totals the lines" {\n    }'],
]) {
  test(`${label} counts as a new test`, () => {
    // Given
    const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)

    // When
    const result = runHook(project, { file_path: newKotlinTest.file_path, old_string: '}', new_string: `${declaration}\n}` })

    // Then
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny')
  })
}

test('a Vitest it.each counts as a new test', () => {
  // Given
  const project = gitProject(nuxtConfig, { 'acme-web/app/components/InvoiceTotal.vue': vueComponent('Invoice') }, { 'acme-web/app/components/OrderTotal.vue': vueComponent('Order') })

  // When
  const result = runHook(project, { file_path: 'acme-web/app/components/OrderTotal.test.ts', old_string: '})', new_string: "})\n\nit.each([1, 2])('totals %i', () => {})" })

  // Then
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny')
})

test('when npm fails, the skip names npm’s cause rather than where its log is', () => {
  // Given
  const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)
  const jscpd = fakeJscpd(
    `process.stderr.write('npm error code E401\\nnpm error Unable to authenticate, your authentication token seems to be invalid.\\nnpm error A complete log of this run can be found in: /home/dev/.npm/_logs/debug-0.log\\n'); process.exit(1)`
  )

  // When / Then
  skippedWith(runHook(project, newKotlinTest, { SKRYMER_AI_JSCPD: jscpd }), 'Unable to authenticate, your authentication token seems to be invalid\\.$')
})

test('a jscpd that fails without a word is named by its exit code', () => {
  // Given
  const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)

  // When / Then
  skippedWith(runHook(project, newKotlinTest, { SKRYMER_AI_JSCPD: fakeJscpd('process.exit(249)') }), 'jscpd exited with code 249$')
})

test('a scan past its time limit is killed with every process it started', () => {
  // Given
  const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)
  const pidFile = join(mkdtempSync(join(tmpdir(), 'duplication-gate-pid-')), 'pid')
  const jscpd = fakeJscpd(
    `const child = require('node:child_process').spawn('sleep', ['30'], { stdio: 'ignore' }); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); setTimeout(() => {}, 30000)`
  )

  // When
  runHook(project, newKotlinTest, { SKRYMER_AI_JSCPD: jscpd, SKRYMER_AI_DUPLICATION_GATE_TIMEOUT_MS: '500' })

  // Then
  const pid = Number(readFileSync(pidFile, 'utf8'))
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('on a first run with jscpd not yet downloaded, the test is let through and the download said', () => {
  // Given
  const project = gitProject(kotlinConfig, kotlinClone.base, kotlinClone.branch)
  const emptyCache = mkdtempSync(join(tmpdir(), 'duplication-gate-npm-cache-'))

  // When / Then
  skippedWith(runHook(project, newKotlinTest, { npm_config_cache: emptyCache }), 'jscpd@5\\.4\\.0 is downloading for its first run; the next new test is checked$')
})
