/**
 * The kotlin-spring pack's default rule fragment. Each `path` is relative to a stack root
 * the project config names, so a project states only its roots.
 */
export default {
  skills: {
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
