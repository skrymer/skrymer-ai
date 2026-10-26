/**
 * The web-e2e pack's default rule fragment. Each `path` is relative to a stack root the
 * project config names, the directory holding `playwright.config.*`, so a project states only
 * its roots. A test command matches within one shell command. A prompt rule matches the words
 * of a prompt, whatever the roots.
 */
export default {
  tdd: {
    testCommands: [/\bplaywright\s+test\b|\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test:)?e2e\b/],
  },
  skills: {
    prompts: [
      {
        id: 'playwright',
        pattern: /\bplaywright\b|\be2e\b|\bend[- ]to[- ]end\b|\baria snapshots?\b|\bsmoke tests?\b/i,
        skills: ['web-e2e:playwright-best-practices'],
        why: 'an e2e spec uses web-first assertions and role-based locators, never fixed waits.',
      },
    ],
    files: [
      {
        id: 'playwright-spec',
        path: /e2e\/.+\.spec\.[cm]?[jt]s$/,
        skills: ['web-e2e:playwright-best-practices', 'core:tdd'],
        why: 'An e2e spec follows the Playwright practices, one red-green cycle at a time.',
      },
      {
        id: 'e2e-support',
        path: /e2e\//,
        skills: ['web-e2e:playwright-best-practices'],
        why: 'Fixtures, page objects and setup under e2e/ follow the Playwright practices.',
      },
    ],
  },
}
