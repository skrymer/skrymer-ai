/**
 * The kotlin-spring pack's default rule fragment. Each `path` and TDD glob is relative to a
 * stack root the project config names, so a project states only its roots. `/core:setup`
 * proposes a root wherever `detect` finds a Gradle build applying Spring Boot, and enables the
 * `lsp` plugins. A test command matches within one shell command. A prompt rule matches the
 * words of a prompt, whatever the roots. `check` is the build and tests the sign-off and CI run
 * in the root, and `lint` the fast check the pre-commit hook runs when the root has staged
 * files; a stack's own `check` or `lint` replaces the pack's. `ci` gives the GitHub Actions
 * steps a CI job takes in the root before its `check`: the JDK the build's toolchain names, else
 * 21, and Gradle with its cache.
 */
export default {
  detect: { files: ['build.gradle.kts', 'build.gradle'], contains: /org\.springframework\.boot/ },
  lsp: ['kotlin-lsp@claude-plugins-official'],
  check: [['./gradlew', 'build']],
  lint: [['./gradlew', 'detekt']],
  ci: (root, read) => [
    { uses: 'actions/setup-java@v4', with: { distribution: 'temurin', 'java-version': javaVersion(read) } },
    { uses: 'gradle/actions/setup-gradle@v4' },
  ],
  tdd: {
    files: ['src/**/*.kt'],
    testCommands: [/\bgradlew\b[^;&|]*\b(?:test|check|build)\b/],
  },
  duplication: {
    tests: ['src/*[tT]est*/**/*.kt'],
    declaration: /@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b|(?<![\w.])(?:it|test|should)\s*\(\s*"|^\s*"[^"\n]*"\s*\{/,
    formats: ['kotlin'],
    remedy:
      'Use Extract Function, Slide Statements first when the copies are interleaved with other code, ' +
      'or Pull Up Method when they sit in sibling classes.',
  },
  mutation: {
    engine: 'pitest',
    source: ['src/main/kotlin/**/*.kt'],
    targets: pitestTargets,
    run: ['./gradlew', 'mutationTest', '-PmutationTargets={targets}'],
    report: 'build/reports/pitest/mutations.xml',
    mutants: (xml) => xml.match(/<mutation\b/g)?.length ?? 0,
    survivors: pitestSurvivors,
    memory: '8G',
    notes: 'skills/backend-dev/references/pitest.md',
  },
  skills: {
    prompts: [
      {
        id: 'kotlin-test-layer',
        pattern: /\bjunit\b|\bkotest\b|\bmockmvc\b|\btestcontainers\b|@?springboottest\b|\bgradlew? test\b|\b(kotlin|backend|spring) tests?\b/i,
        skills: ['kotlin-spring:backend-dev', 'core:tdd'],
        why: 'a backend test is written to the playbook’s five layers, one red-green cycle at a time.',
      },
    ],
    files: [
      {
        id: 'kotlin-test',
        path: /src\/test\/.+\.kt$/,
        skills: ['kotlin-spring:backend-dev'],
        why: 'A backend test is written to the playbook’s test layers and gotchas.',
      },
      {
        id: 'backend-source',
        path: /src\/main\//,
        skills: ['kotlin-spring:backend-dev'],
        why: 'Source, migrations and resources follow the playbook’s architecture rules.',
      },
    ],
  },
}

/** The Java version a root's Gradle build gives its toolchain, as text, else '21'. */
function javaVersion(read) {
  const build = read('build.gradle.kts') ?? read('build.gradle') ?? ''
  return /jvmToolchain\(\s*(\d+)|JavaLanguageVersion\.of\(\s*(\d+)|JavaVersion\.VERSION_(\d+)/.exec(build)?.slice(1).find(Boolean) ?? '21'
}

/**
 * The pitest target globs for scoped Kotlin [files], read with [read]. A file's declarations
 * don't follow its name, so they are read out of the text: each top-level type as itself plus
 * `$*` for its nested types (a bare `Foo*` would drag in every sibling it prefixes), and the
 * `…Kt` facade Kotlin emits for the file's top-level functions. Naming a facade that doesn't
 * exist is harmless.
 */
function pitestTargets(files, read) {
  const targets = files.flatMap((file) => {
    const text = read(file)
    const pkg = packageOf(text)
    const types = [...text.matchAll(/^(?:[a-z]+\s+)*(?:class|object|interface)\s+(\w+)/gm)].map((match) => match[1])
    const facade = `${file.split('/').at(-1).replace(/\.kt$/, '')}Kt`
    return [...types.flatMap((type) => [qualify(pkg, type), qualify(pkg, `${type}$*`)]), qualify(pkg, facade)]
  })
  return [...new Set(targets)].sort()
}

/**
 * Every mutant in a pitest `mutations.xml` [xml] that no test detected (SURVIVED or
 * NO_COVERAGE), keyed to the scoped file among [files] whose package declares its class, else
 * to its package path.
 */
function pitestSurvivors(xml, files, read) {
  const field = (body, tag) => decode(new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(body)?.[1] ?? '')
  return [...xml.matchAll(/<mutation\b([^>]*)>([\s\S]*?)<\/mutation>/g)]
    .filter(([, attributes]) => /\bdetected=['"]false['"]/.test(attributes))
    .map(([, attributes, body]) => {
      const sourceFile = field(body, 'sourceFile')
      const pkg = field(body, 'mutatedClass').split('.').slice(0, -1).join('.')
      const file =
        files.find((candidate) => candidate.split('/').at(-1) === sourceFile && packageOf(read(candidate)) === pkg) ??
        [...pkg.split('.').filter(Boolean), sourceFile].join('/')
      return {
        file,
        line: Number(field(body, 'lineNumber')),
        mutator: field(body, 'mutator').split('.').at(-1).replace('Mutator', ''),
        replacement: field(body, 'description'),
        status: /\bstatus=['"](\w+)['"]/.exec(attributes)[1],
      }
    })
}

const packageOf = (text) => /^package\s+([\w.]+)/m.exec(text)?.[1] ?? ''
const qualify = (pkg, name) => (pkg ? `${pkg}.${name}` : name)
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const decode = (text) => text.replace(/&(lt|gt|amp|quot|apos);/g, (_, name) => ENTITIES[name])
