/**
 * Loads a project's `.claude/skrymer-ai.config.mjs` and merges it over the default rule
 * fragments of the packs it enables. Every hook engine reads only the merged view.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { basename, isAbsolute, join, matchesGlob, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CONFIG_PATH = join('.claude', 'skrymer-ai.config.mjs')
export const PACK_FILE = 'skrymer-ai.pack.mjs'

/** The roles the process skills speak of, each mapped by default to a label of the same name. */
const ROLES = ['bug', 'enhancement', 'needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix']
const TRACKERS = ['github', 'local']
const DEFAULT_LABELS = Object.fromEntries(ROLES.map((role) => [role, role]))

/** Lets a project config `import { defineConfig } from 'skrymer-ai'` without installing anything. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'skrymer-ai') return { url: import.meta.url, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

export function defineConfig(config) {
  return config
}

/** Whether [file], an absolute path, is inside [projectDir] and matches one of the TDD [globs]. */
export function isTddGated(projectDir, file, globs) {
  const inProject = relative(projectDir, file)
  if (inProject.startsWith('..') || isAbsolute(inProject)) return false
  return globs.some((glob) => matchesGlob(inProject, glob))
}

/**
 * `{ config }` with the merged view, `{ config: null }` when the project has no config, or
 * `{ errors }` naming each problem in words a person can act on. A bad `tracker` or `domain`
 * block only describes the project to the session, so it lands in `config.contextErrors`
 * instead and leaves every gate and rule in force.
 */
export async function loadConfig(projectDir, pluginRoot) {
  const file = join(projectDir, CONFIG_PATH)
  if (!existsSync(file)) return { config: null }
  let project
  try {
    project = (await import(pathToFileURL(file).href)).default
  } catch (error) {
    return { errors: [`${CONFIG_PATH} does not load: ${error.message}`] }
  }
  if (typeof project !== 'object' || project === null) {
    return { errors: [`${CONFIG_PATH}: expected \`export default defineConfig({ … })\`.`] }
  }
  const errors = []
  const files = []
  const prompts = []
  const tdd = []
  const testCommands = []
  const format = []
  const duplication = []
  const mutation = []
  const verify = []
  const check = []
  for (const [pack, stack] of Object.entries(project.stacks ?? {})) {
    const roots = stack?.roots
    if (!Array.isArray(roots)) {
      errors.push(`stacks.${pack}.roots: expected a list of directories.`)
      continue
    }
    const dir = packDir(pluginRoot, pack)
    if (!dir) {
      const available = availablePacks(pluginRoot)
      const where = available.length ? `Packs available: ${available.join(', ')}.` : 'No packs are installed beside core.'
      errors.push(`stacks: there is no pack "${pack}". ${where}`)
      continue
    }
    const fragment = (await import(pathToFileURL(join(dir, PACK_FILE)).href)).default
    testCommands.push(...(fragment.tdd?.testCommands ?? []))
    prompts.push(...(fragment.skills?.prompts ?? []))
    const engine = fragment.mutation && { ...fragment.mutation, ...validMutation(stack.mutation, `stacks.${pack}.mutation`, errors) }
    const checks = fragment.verify && { ...fragment.verify, ...validVerify(stack.verify, `stacks.${pack}.verify`, errors) }
    const build = stack.check === undefined ? fragment.check : validCommands(stack.check, `stacks.${pack}.check`, CHECK_EXAMPLE, errors)
    const groups = stack.format === undefined ? fragment.format : validFormat(stack.format, `stacks.${pack}.format`, errors)
    for (const root of roots) {
      if (!isDirectory(join(projectDir, root))) {
        errors.push(`stacks.${pack}.roots: "${root}" does not exist in the project.`)
        continue
      }
      for (const rule of fragment.skills?.files ?? []) {
        files.push({ ...rule, path: new RegExp(`(^|/)${rootPrefix(root)}(?:${rule.path.source})`) })
      }
      for (const glob of fragment.tdd?.files ?? []) tdd.push(`${globPrefix(root)}${glob}`)
      if (groups?.length) format.push({ root: trimRoot(root), groups })
      if (Array.isArray(fragment.duplication?.tests)) {
        const { tests, ...rest } = fragment.duplication
        duplication.push({ ...rest, pack, root: trimRoot(root), tests: tests.map((glob) => `${globPrefix(root)}${glob}`) })
      }
      if (engine) {
        const under = (globs) => globs.map((glob) => `${globPrefix(root)}${glob}`)
        const notes = engine.notes && join(dir, engine.notes)
        mutation.push({ ...engine, pack, root: trimRoot(root), notes, source: under(engine.source), tests: under(fragment.duplication?.tests ?? []) })
      }
      if (checks) verify.push({ pack, root: trimRoot(root), ...checks })
      if (build?.length) check.push({ pack, root: trimRoot(root), run: build })
    }
  }
  const projectTdd = project.tdd?.files ?? []
  if (Array.isArray(projectTdd) && projectTdd.every((glob) => typeof glob === 'string')) {
    tdd.push(...projectTdd.map((glob) => glob.replace(/^(?:\.\/+)+/, '')))
  } else errors.push('tdd.files: expected a list of globs.')
  for (const rule of project.skills?.files ?? []) {
    const path = toRegex(rule.path, '', `skills.files "${rule.id}": path`, errors)
    if (path) files.push({ ...rule, path })
  }
  for (const rule of project.skills?.prompts ?? []) {
    const label = `skills.prompts "${rule.id}"`
    const pattern = toRegex(rule.pattern, 'i', `${label}: pattern`, errors)
    const skills = Array.isArray(rule.skills) && rule.skills.length && rule.skills.every((skill) => typeof skill === 'string')
    if (!skills) errors.push(`${label}: skills must be a list of skill names.`)
    if (typeof rule.why !== 'string' || !rule.why.trim()) errors.push(`${label}: why must say in one line why the skills apply.`)
    if (pattern && skills) prompts.push({ ...rule, pattern })
  }
  prompts.push(...((await import(pathToFileURL(join(pluginRoot, PACK_FILE)).href)).default.skills?.prompts ?? []))
  const contextErrors = []
  const tracker = { kind: project.tracker?.kind ?? 'github', labels: { ...DEFAULT_LABELS, ...project.tracker?.labels } }
  if (!TRACKERS.includes(tracker.kind)) contextErrors.push(`tracker.kind: expected "github" or "local", not "${tracker.kind}".`)
  for (const [role, label] of Object.entries(project.tracker?.labels ?? {})) {
    if (!ROLES.includes(role)) contextErrors.push(`tracker.labels: there is no role "${role}". Roles: ${ROLES.join(', ')}.`)
    else if (typeof label !== 'string' || !label) contextErrors.push(`tracker.labels.${role}: expected a label name.`)
  }
  const domain = { contexts: project.domain?.contexts ?? ['.'] }
  if (!Array.isArray(domain.contexts) || !domain.contexts.length || !domain.contexts.every((c) => typeof c === 'string')) {
    contextErrors.push("domain.contexts: expected a list of directories, such as ['.'].")
  } else {
    for (const context of domain.contexts) {
      if (!isDirectory(join(projectDir, context))) contextErrors.push(`domain.contexts: "${context}" does not exist in the project.`)
    }
  }
  const signOff = validSignOff(project.signOff, { mutation, verify }, errors)
  if (errors.length) return { errors }
  return { config: { skills: { files, prompts }, tdd: { files: tdd, testCommands }, format, duplication, mutation, verify, check, signOff, tracker, domain, contextErrors } }
}

/** The sign-off's gates in the order core runs them. A project selects among them and cannot reorder them. */
export const GATES = ['simplify', 'mutation', 'code-review', 'check-adrs', 'verify']

/** The gates that need an engine from an enabled pack, and run once per stack root that has one. */
const ENGINE_GATES = ['mutation', 'verify']

const SIGN_OFF_FIELDS = ['gates', 'docs']

/**
 * The sign-off a project selects, `{ gates, docs }`: the gates in core's order, and the globs of
 * the project's other living docs, which check-adrs greps for drift. With no `gates`, every gate
 * whose engine an enabled pack provides is selected; [engines] holds the merged mutation and
 * verify stacks. An unknown gate, or an engine gate no enabled pack provides, is an error.
 */
function validSignOff(block = {}, engines, errors) {
  const available = (gate) => !ENGINE_GATES.includes(gate) || engines[gate].length > 0
  if (!isObject(block)) {
    errors.push(`signOff: expected { ${SIGN_OFF_FIELDS.join(', ')} }.`)
    return null
  }
  for (const field of Object.keys(block)) {
    if (!SIGN_OFF_FIELDS.includes(field)) errors.push(`signOff: there is no field "${field}". Fields: ${SIGN_OFF_FIELDS.join(', ')}.`)
  }
  const { gates = GATES.filter(available), docs = [] } = block
  if (!Array.isArray(gates) || !gates.every((gate) => typeof gate === 'string')) {
    errors.push("signOff.gates: expected a list of gates, such as ['simplify', 'code-review'].")
  } else {
    for (const gate of gates) {
      if (!GATES.includes(gate)) errors.push(`signOff.gates: there is no gate "${gate}". Gates: ${GATES.join(', ')}.`)
      else if (!available(gate)) {
        errors.push(`signOff.gates: no enabled pack provides a ${gate} engine. Enable a stack whose pack has one, or drop "${gate}" from the gates.`)
      }
    }
  }
  if (!Array.isArray(docs) || !docs.every((glob) => typeof glob === 'string' && glob)) {
    errors.push("signOff.docs: expected a list of globs, such as ['docs/**/*.md'].")
  }
  return { gates: GATES.filter((gate) => Array.isArray(gates) && gates.includes(gate)), docs }
}

const CHECK_EXAMPLE = "[['pnpm', 'lint'], ['pnpm', 'test']]"

/** [commands] if it is a non-empty list of commands, each a list of words, else null with an error under [label]. */
function validCommands(commands, label, example, errors) {
  if (Array.isArray(commands) && commands.length && commands.every((command) => isStrings(command))) return commands
  errors.push(`${label}: expected a list of commands, each a list of words, such as ${example}.`)
  return null
}

/** [groups] if each is `{ files: [globs], run: [[words]] }`, else null with an error under [label] per bad group. */
function validFormat(groups, label, errors) {
  if (!Array.isArray(groups)) {
    errors.push(`${label}: expected a list of groups, each { files: [globs], run: [commands] }.`)
    return null
  }
  const before = errors.length
  groups.forEach((group, i) => {
    if (!isStrings(group?.files)) errors.push(`${label}[${i}].files: expected a list of globs.`)
    if (!Array.isArray(group?.run) || !group.run.length || !group.run.every((command) => isStrings(command))) {
      errors.push(`${label}[${i}].run: expected a list of commands, each a list of words, such as [['prettier', '--write']].`)
    }
  })
  return errors.length === before ? groups : null
}

/**
 * A stack's mutation override, `{ run?, report?, memory? }`: the engine command as a list of
 * words where `{targets}` stands for the scope, the report path relative to the root, and the
 * memory cap as systemd writes it (`8G`). An empty object when there is none; an error under
 * [label] for each bad field.
 */
function validMutation(override, label, errors) {
  if (override === undefined) return {}
  if (typeof override !== 'object' || override === null) {
    errors.push(`${label}: expected { run, report, memory }.`)
    return {}
  }
  if (override.run !== undefined && !(isStrings(override.run) && override.run.some((word) => word.includes('{targets}')))) {
    errors.push(`${label}.run: expected a command as a list of words, one holding {targets}, such as ['./gradlew', 'mutationTest', '-Ptargets={targets}'].`)
  }
  if (override.report !== undefined && !isStrings([override.report])) errors.push(`${label}.report: expected a path relative to the root.`)
  if (override.memory !== undefined && !/^\d+[KMGT]?$/.test(override.memory)) errors.push(`${label}.memory: expected a size such as '8G'.`)
  return override
}

const VERIFY_FIELDS = ['targets', 'stack', 'dev', 'user', 'api']
const UP = "such as ['docker', 'compose', 'up', '-d']"
const DOWN = "such as ['docker', 'compose', 'down']"

/**
 * A stack's verify block, `{ targets?, stack?, dev?, user?, api? }`: the targets a walk-through
 * runs at, the commands that bring the stack and an optional disposable database up and down
 * (in the project root), the dev server and the pattern whose first group reads its URL from
 * the log, the command that mints a test user for `{email}` and the env file it lands in, and
 * the API the probe drives through the dev proxy. An empty object when there is none; an
 * error under [label] for each bad field. The API's CSRF priming path and its auth header
 * get their defaults here, so the scripts read one shape.
 */
function validVerify(block, label, errors) {
  if (block === undefined) return {}
  if (!isObject(block)) {
    errors.push(`${label}: expected { ${VERIFY_FIELDS.join(', ')} }.`)
    return {}
  }
  for (const field of Object.keys(block)) {
    if (!VERIFY_FIELDS.includes(field)) errors.push(`${label}: there is no field "${field}". Fields: ${VERIFY_FIELDS.join(', ')}.`)
  }
  const { targets, stack, dev, user, api } = block
  const command = (value, field, example) => {
    if (!isStrings(value)) errors.push(`${label}.${field}: expected a command as a list of words, ${example}.`)
  }
  const size = (value) => Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n) && n > 0)
  if (targets !== undefined && !(isObject(targets) && Object.keys(targets).length && Object.entries(targets).every(([name, value]) => /^[a-z0-9-]+$/.test(name) && size(value)))) {
    errors.push(`${label}.targets: expected { name: [width, height] } with names of lowercase letters, digits and dashes, such as { desktop: [1440, 900] }.`)
  }
  if (stack !== undefined) {
    command(stack?.up, 'stack.up', UP)
    command(stack?.down, 'stack.down', DOWN)
    if (stack?.disposableDb !== undefined) {
      command(stack.disposableDb?.up, 'stack.disposableDb.up', UP)
      command(stack.disposableDb?.down, 'stack.disposableDb.down', DOWN)
    }
  }
  let ready
  if (dev !== undefined) {
    command(dev?.run, 'dev.run', "such as ['pnpm', 'dev']")
    if (dev?.port !== undefined && !(Number.isInteger(dev.port) && dev.port > 0 && dev.port < 65536)) errors.push(`${label}.dev.port: expected a port number.`)
    ready = urlPattern(dev?.ready)
    if (!ready) errors.push(`${label}.dev.ready: expected a regex whose first group captures the URL the dev log reports, such as /Local:\\s+(http\\S+)/.`)
  }
  if (user !== undefined) {
    if (!(isStrings(user?.mint) && user.mint.some((word) => word.includes('{email}')))) {
      errors.push(`${label}.user.mint: expected a command as a list of words, one holding {email}, such as ['node', 'scripts/mint-user.mjs', '--email', '{email}'].`)
    }
    if (user?.env !== undefined && !isStrings([user.env?.file, user.env?.key])) {
      errors.push(`${label}.user.env: expected { file, key }, such as { file: '.env', key: 'ACME_DEV_TOKEN' }.`)
    }
  }
  let probe
  if (api !== undefined) {
    if (!(typeof api?.base === 'string' && api.base.startsWith('/'))) errors.push(`${label}.api.base: expected a path starting with /, such as '/api'.`)
    const csrf = api?.csrf && { prime: '', ...api.csrf }
    if (csrf !== undefined && !(isStrings([csrf?.cookie, csrf?.header]) && typeof csrf.prime === 'string')) {
      errors.push(`${label}.api.csrf: expected { cookie, header }, such as { cookie: 'XSRF-TOKEN', header: 'X-XSRF-TOKEN' }.`)
    }
    const auth = api?.auth ?? { header: 'Authorization', value: 'Bearer {token}' }
    if (!(isStrings([auth?.header, auth?.value]) && auth.value.includes('{token}'))) {
      errors.push(`${label}.api.auth: expected { header, value } with {token} in the value, such as { header: 'Authorization', value: 'Bearer {token}' }.`)
    }
    probe = { ...api, ...(csrf && { csrf }), auth }
  }
  return { ...block, ...(dev && { dev: { ...dev, ready } }), ...(probe && { api: probe }) }
}

/** [value], a regex or its source, if it compiles and has a group to capture a URL, else null. */
function urlPattern(value) {
  if (!(value instanceof RegExp) && typeof value !== 'string') return null
  try {
    const pattern = new RegExp(value)
    return new RegExp(`${pattern.source}|`).exec('').length > 1 ? pattern : null
  } catch {
    return null
  }
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether [value] is a non-empty list of non-empty strings. */
const isStrings = (value) => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item)

/** [value] as a regex: kept if it is one, compiled with [flags] if it is a string, else an error under [label]. */
function toRegex(value, flags, label, errors) {
  if (value instanceof RegExp) return value
  if (typeof value !== 'string') {
    errors.push(`${label} must be a regex or a string.`)
    return null
  }
  try {
    return new RegExp(value, flags)
  } catch (error) {
    errors.push(`${label} "${value}" is not a valid regex (${error.message.split(': ').pop()}).`)
    return null
  }
}

/**
 * Where [pack] is installed beside `core`, or null. `core`'s own fragment is not a pack. Loaded in place (the source tree, or a
 * marketplace added from a local directory) the plugins are siblings. Copied into Claude
 * Code's plugin cache, each sits under `<marketplace>/<plugin>/<version>/`, and the pack is
 * preferred at core's own version, else the most recently installed.
 */
export function packDir(pluginRoot, pack) {
  if (pack === 'core') return null
  if (inPlace(pluginRoot)) {
    const sibling = join(pluginRoot, '..', pack)
    return isPack(sibling) ? sibling : null
  }
  const versions = join(pluginRoot, '..', '..', pack)
  if (!isDirectory(versions)) return null
  const sameVersion = join(versions, basename(pluginRoot))
  if (isPack(sameVersion)) return sameVersion
  const newest = readdirSync(versions)
    .map((version) => join(versions, version))
    .filter(isPack)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  return newest ?? null
}

/** The packs installed beside `core`. */
export function availablePacks(pluginRoot) {
  const plugins = inPlace(pluginRoot) ? join(pluginRoot, '..') : join(pluginRoot, '..', '..')
  return readdirSync(plugins)
    .filter((name) => packDir(pluginRoot, name))
    .sort()
}

const inPlace = (pluginRoot) => basename(pluginRoot) === 'core'
const isDirectory = (path) => existsSync(path) && statSync(path).isDirectory()
const isPack = (dir) => existsSync(join(dir, PACK_FILE))

/** A root as a project-relative directory: `api` for `./api/`, nothing for `.`. */
export const trimRoot = (root) => root.replace(/^\.\/+/, '').replace(/\/+$/, '').replace(/^\.$/, '')

/** A root as the start of a project-relative path regex. */
const rootPrefix = (root) => (trimRoot(root) ? `${escapeRegex(trimRoot(root))}/` : '')

/** A root as the start of a project-relative glob. */
const globPrefix = (root) => (trimRoot(root) ? `${trimRoot(root)}/` : '')

export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
