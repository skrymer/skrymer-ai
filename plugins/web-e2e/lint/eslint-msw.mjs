/**
 * The web-e2e pack's ESLint preset: in test files, it refuses every way of faking the API other
 * than the shared MSW handlers. It uses only core rules, so it needs no plugin.
 *
 *   import { mswBans } from '<this file>'
 *   export default [...yourConfig, ...mswBans({ apiModules: ['~/api/client'] })]
 *
 * Spread it last. A later `no-restricted-syntax` replaces this one rather than merging, so a
 * project with selectors of its own adds `mswRestrictedSyntax(options)` to its list instead.
 *
 * Options:
 *   clients     extra HTTP client modules to refuse in `vi.mock`, beside the defaults
 *   apiModules  the project's own API-client modules, as the tests import them
 *   files       the test globs it judges
 */

/** HTTP and GraphQL client modules a test must never mock. */
export const DEFAULT_CLIENTS = ['ofetch', 'axios', 'ky', 'node-fetch', 'cross-fetch', 'graphql-request', '@apollo/client', 'urql', '@urql/core']

export const DEFAULT_FILES = ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}']

const HANDLERS = 'Fake the API with the shared MSW handlers (server.use / network.use) instead; see the web-e2e:msw skill.'

/** [value] as an esquery string literal. */
const quoted = (value) => JSON.stringify(String(value))

/** The `no-restricted-syntax` entries refusing HTTP mocks, for a project merging them into its own list. */
export function mswRestrictedSyntax({ clients = [], apiModules = [] } = {}) {
  const modules = [...DEFAULT_CLIENTS, ...clients, ...apiModules]
  const mocked = modules.map((name) => `[arguments.0.value=${quoted(name)}]`).join(', ')
  // esquery's regex literals can't hold a slash, so the API test is a word and the catch-all `.*`.
  const route = "CallExpression[callee.object.name=/^(?:page|context)$/][callee.property.name='route']"
  return [
    {
      selector: `CallExpression[callee.object.name='vi'][callee.property.name=/^(?:mock|doMock)$/]:matches(${mocked})`,
      message: `Don't mock an HTTP client or the API module. ${HANDLERS}`,
    },
    {
      selector: "CallExpression[callee.object.name='vi'][callee.property.name='stubGlobal'][arguments.0.value=/^\\$?fetch$/]",
      message: `Don't stub fetch. ${HANDLERS}`,
    },
    {
      selector: "CallExpression[callee.object.name='vi'][callee.property.name='spyOn'][arguments.1.value=/^\\$?fetch$/]",
      message: `Don't spy on fetch. ${HANDLERS}`,
    },
    {
      selector: 'AssignmentExpression[left.property.name=/^\\$?fetch$/]',
      message: `Don't replace fetch. ${HANDLERS}`,
    },
    {
      selector: "CallExpression[callee.name='registerEndpoint']",
      message: `registerEndpoint bypasses the unhandled-request check. ${HANDLERS}`,
    },
    {
      selector: `${route}:matches([arguments.0.value=/(?:^|[^a-zA-Z])api(?:[^a-zA-Z]|$)/], [arguments.0.regex.pattern=/api/], [arguments.0.value=/^\\*\\*.?\\*?$/])`,
      message: `Don't route the app's API or every request in a spec; page.route is for third-party hosts. ${HANDLERS}`,
    },
    {
      selector: `${route}:not([arguments.0.type='Literal'])`,
      message: 'Pass route() a string or regex literal, so the API-mock ban can read it.',
    },
  ]
}

/** The flat-config objects that refuse HTTP mocks in [files]. */
export function mswBans({ files = DEFAULT_FILES, ...options } = {}) {
  return [{ name: 'skrymer-ai/web-e2e/msw-bans', files, rules: { 'no-restricted-syntax': ['error', ...mswRestrictedSyntax(options)] } }]
}
