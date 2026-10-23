import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'gated-write-guard.mjs')

/** A temp project gating `acme-api/src/**\/*.kt` through kotlin-spring and `acme-web/app/**\/*.vue` itself. */
function acmeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'gated-write-guard-project-'))
  mkdirSync(join(dir, 'acme-api'))
  mkdirSync(join(dir, '.claude'))
  writeFileSync(
    join(dir, '.claude', 'skrymer-ai.config.mjs'),
    `import { defineConfig } from 'skrymer-ai'
export default defineConfig({
  stacks: { 'kotlin-spring': { roots: ['acme-api'] } },
  tdd: { files: ['acme-web/app/**/*.vue'] },
})
`
  )
  return dir
}

/** Runs the hook on a Bash call of [command] run from [cwd], a directory in [project]. */
function runHook(project, command, cwd = '.') {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
      cwd: join(project, cwd),
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout }
}

const denied = (project, command, cwd) => runHook(project, command, cwd).stdout.includes('"deny"')

test('sed -i on a gated file is denied with a reason naming the file and Edit/Write', () => {
  // Given
  const project = acmeProject()

  // When
  const { status, stdout } = runHook(project, "sed -i '70,87d' acme-api/src/main/kotlin/Invoice.kt")

  // Then
  assert.equal(status, 0)
  const out = JSON.parse(stdout).hookSpecificOutput
  assert.equal(out.hookEventName, 'PreToolUse')
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /acme-api\/src\/main\/kotlin\/Invoice\.kt/)
  assert.match(out.permissionDecisionReason, /Edit\/Write/)
})

test('a gated path is recognised relative to the shell’s directory and to a cd within the command', () => {
  // Given
  const project = acmeProject()

  // When
  const fromRoot = denied(project, "sed -i 's/a/b/' src/main/kotlin/Invoice.kt", 'acme-api')
  const afterCd = denied(project, "cd acme-api && sed -i 's/a/b/' src/main/kotlin/Invoice.kt")

  // Then
  assert.equal(fromRoot, true)
  assert.equal(afterCd, true)
})

for (const command of [
  'cat > acme-api/src/main/kotlin/Invoice.kt <<EOF\nclass Invoice\nEOF',
  'echo y >> acme-api/src/main/kotlin/Invoice.kt',
  'printf x | tee acme-web/app/components/InvoiceRow.vue',
]) {
  test(`a redirect or tee onto a gated file is denied: \`${command.split('\n')[0]}\``, () => {
    // Given
    const project = acmeProject()

    // When
    const result = denied(project, command)

    // Then
    assert.equal(result, true)
  })
}

for (const command of [
  'sed -n 1,40p acme-api/src/main/kotlin/Invoice.kt',
  'grep -n total acme-web/app/components/InvoiceRow.vue | head',
  'cat acme-api/src/main/kotlin/Invoice.kt > /tmp/Invoice.kt',
  "cat acme-api/src/main/kotlin/Invoice.kt && sed -i 's/a/b/' docs/acme-notes.md",
  "python3 -c \"print(open('acme-api/src/main/kotlin/Invoice.kt').read())\"",
]) {
  test(`a read of a gated file is allowed: \`${command}\``, () => {
    // Given
    const project = acmeProject()

    // When
    const result = denied(project, command)

    // Then
    assert.equal(result, false)
  })
}

test('a sed -i whose quoted script holds several ;-separated expressions is denied', () => {
  // Given
  const project = acmeProject()

  // When
  const single = denied(project, "sed -i 's/a/b/g; s/c/d/' acme-web/app/components/InvoiceRow.vue")
  const double = denied(project, 'sed -i "s/a/b/; s/c/d/" acme-api/src/main/kotlin/Invoice.kt')

  // Then
  assert.equal(single, true)
  assert.equal(double, true)
})

test('cp or mv onto a gated file is denied, and off one is allowed', () => {
  // Given
  const project = acmeProject()

  // When
  const onto = denied(project, 'cp /tmp/InvoiceRow.vue acme-web/app/components/InvoiceRow.vue')
  const moved = denied(project, 'mv /tmp/Invoice.kt acme-api/src/main/kotlin/Invoice.kt')
  const off = denied(project, 'cp acme-web/app/components/InvoiceRow.vue /tmp/acme/InvoiceRow.vue')

  // Then
  assert.equal(onto, true)
  assert.equal(moved, true)
  assert.equal(off, false)
})

for (const command of [
  "python3 - <<'PY'\np='acme-web/app/components/InvoiceRow.vue'\nopen(p,'w').write(s)\nPY",
  "node -e \"require('fs').writeFileSync('acme-api/src/main/kotlin/Invoice.kt', s)\"",
  "python3 - <<'PY'\np='acme-api/src/main/kotlin/Invoice.kt'\nopen(root + '/tmp/Invoice.kt','w').write(s)\nPY",
]) {
  test(`an inline script that may write a gated file is denied: \`${command.split('\n').slice(0, 2).join(' ')}\``, () => {
    // Given
    const project = acmeProject()

    // When
    const result = denied(project, command)

    // Then
    assert.equal(result, true)
  })
}

test('an inline script that reads a gated file and writes a literal ungated copy is allowed', () => {
  // Given
  const project = acmeProject()

  // When
  const result = denied(
    project,
    "python3 - <<'PY'\ns=open('acme-api/src/main/kotlin/Invoice.kt').read()\nopen('/tmp/acme/Invoice.kt','w').write(s)\nPY"
  )

  // Then
  assert.equal(result, false)
})

for (const command of [
  'echo x > acme-api/build/generated/InvoiceRecord.kt',
  "sed -i 's/a/b/' docs/acme-notes.md",
  "sed -i 's/a/b/' acme-web/.stryker-tmp/sandbox-1/app/components/InvoiceRow.vue",
  'git checkout -- acme-api/src/main/kotlin/Invoice.kt',
]) {
  test(`a write outside the gated trees is allowed: \`${command}\``, () => {
    // Given
    const project = acmeProject()

    // When
    const result = denied(project, command)

    // Then
    assert.equal(result, false)
  })
}

test('the deny says how to change a copy or read the file from a script instead', () => {
  // Given
  const project = acmeProject()

  // When
  const { stdout } = runHook(project, 'echo y >> acme-api/src/main/kotlin/Invoice.kt')

  // Then
  const reason = JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason
  assert.match(reason, /\/tmp\//)
  assert.match(reason, /script file/)
})

test('a project without a config is left alone', () => {
  // Given
  const project = mkdtempSync(join(tmpdir(), 'gated-write-guard-bare-'))

  // When
  const { stdout } = runHook(project, 'echo y >> src/main/kotlin/Invoice.kt')

  // Then
  assert.equal(stdout, '')
})

test('an invalid config lets the command through and says the guard is off', () => {
  // Given
  const project = acmeProject()
  writeFileSync(join(project, '.claude', 'skrymer-ai.config.mjs'), `export default { tdd: { files: 'globex/**' } }`)

  // When
  const { stdout } = runHook(project, 'echo y >> acme-api/src/main/kotlin/Invoice.kt')

  // Then
  const out = JSON.parse(stdout)
  assert.equal(out.hookSpecificOutput, undefined)
  assert.match(out.systemMessage, /gated-write guard is off[\s\S]*tdd\.files/)
})

test('input that is not JSON is let through', () => {
  // Given
  const project = acmeProject()

  // When
  const result = spawnSync('node', [HOOK], {
    input: 'not json',
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    encoding: 'utf8',
  })

  // Then
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})
