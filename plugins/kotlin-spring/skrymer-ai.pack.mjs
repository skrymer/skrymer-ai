/**
 * The kotlin-spring pack's default rule fragment. Each `path` and TDD glob is relative to a
 * stack root the project config names, so a project states only its roots. A test command
 * matches within one shell command. A prompt rule matches the words of a prompt, whatever
 * the roots.
 */
export default {
  tdd: {
    files: ['src/**/*.kt'],
    testCommands: [/\bgradlew\b[^;&|]*\b(?:test|check|build)\b/],
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
