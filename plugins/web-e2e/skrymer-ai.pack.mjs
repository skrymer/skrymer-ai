/**
 * The web-e2e pack's default rule fragment. Each `path` is relative to a stack root the
 * project config names, the directory holding `playwright.config.*`, so a project states only
 * its roots, and `/core:setup` proposes each such directory and enables the `lsp` plugins. A
 * test command matches within one shell command. A prompt rule matches the words of a prompt,
 * whatever the roots. `versions` are the caret ranges this pack's skills are written for;
 * `/core:setup --check` reports a root whose package.json has moved outside one.
 */
export default {
  detect: { files: ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'] },
  lsp: ['typescript-lsp@claude-plugins-official'],
  versions: { msw: '^3', '@msw/playwright': '^0.7', '@playwright/test': '^1' },
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
      {
        id: 'msw',
        pattern: /\bmsw\b|\b(?:mock|fake|stub)(?:s|ed|ing)?\s+(?:the\s+|an?\s+)?(?:\w+\s+)?(?:api|endpoint|server|http|response|request)s?\b|\bvi\.(?:do)?mock\b|\bpage\.route\b/i,
        skills: ['web-e2e:msw'],
        why: 'a test fakes the API with the shared MSW handlers, never vi.mock of a client or page.route.',
      },
    ],
    files: [
      {
        id: 'playwright-spec',
        path: /e2e\/.+\.spec\.[cm]?[jt]s$/,
        skills: ['web-e2e:playwright-best-practices', 'web-e2e:msw', 'core:tdd'],
        why: 'An e2e spec follows the Playwright practices, one red-green cycle at a time.',
      },
      {
        id: 'e2e-support',
        path: /e2e\//,
        skills: ['web-e2e:playwright-best-practices'],
        why: 'Fixtures, page objects and setup under e2e/ follow the Playwright practices.',
      },
      {
        id: 'msw-handler',
        path: /(?:.+\/)?mocks\/.+\.[cm]?[jt]s$/,
        skills: ['web-e2e:msw'],
        why: 'A handler is the API contract every test layer shares: typed, strict and overridden per test.',
      },
      {
        id: 'js-test',
        path: /.+\.(?:test|spec)\.[cm]?[jt]sx?$/,
        skills: ['web-e2e:msw'],
        why: 'A test that needs the API answers it from the MSW handlers, never vi.mock of a client.',
      },
    ],
  },
}
