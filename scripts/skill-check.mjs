import { posix } from 'node:path'

/** A skill's `name` must match its directory, and every relative link in a skill or reference file must reach a file. */
export function findSkillProblems(files) {
  const paths = new Set(files.map((f) => f.path))
  const resolves = (target) => paths.has(target) || [...paths].some((p) => p.startsWith(target.replace(/\/?$/, '/')))
  const problems = []
  for (const { path, content } of files) {
    const dir = path.match(/\/skills\/([^/]+)\/SKILL\.md$/)?.[1]
    if (dir) {
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
      const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1].trim().replace(/^(['"])(.*)\1$/, '$2')
      if (name !== dir) problems.push(`${path}: name "${name}" should be "${dir}"`)
    }
    if (!/^plugins\/[^/]+\/(skills|reference)\/.+\.md$/.test(path)) continue
    let fence = null
    content.split('\n').forEach((text, i) => {
      const marker = text.trimStart().match(/^(`{3,}|~{3,})/)?.[1]
      if (marker && !fence) fence = marker
      else if (marker && marker[0] === fence[0] && marker.length >= fence.length && !text.trim().slice(marker.length)) fence = null
      if (fence || marker) return
      for (const [, target] of text.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
        if (/^([a-z]+:|\/)/.test(target)) continue
        if (!resolves(posix.join(posix.dirname(path), target))) problems.push(`${path}:${i + 1}: link "${target}" points at no file`)
      }
    })
  }
  return problems
}

const WRITING_TOOLS = ['Edit', 'Write', 'NotebookEdit']

/**
 * The agents on a model of their own, each with why. Every other runs on the session's model,
 * since a judge's neutrality comes from its fresh context, not a different model.
 */
const MODELS = {
  'break-it-tester': ['opus', 'exploring for what nobody asked about is where the strongest model earns its cost'],
}

/**
 * Every agent a plugin ships judges or breaks things and reports them, so it is read-only: it
 * lists its tools, none of which writes, and sets no `memory`, which turns writing on. It runs on
 * the session's own model unless MODELS names another. Its `name` matches its file.
 */
export function findAgentProblems(files) {
  return files.flatMap(({ path, content }) => {
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    const field = (key) => frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim()
    const file = posix.basename(path, '.md')
    const problems = []
    if (field('name') !== file) problems.push(`${path}: name "${field('name')}" should be "${file}"`)
    const tools = field('tools')?.split(',').map((tool) => tool.trim())
    if (!tools) problems.push(`${path}: no tools list, so it inherits Edit and Write; list its tools`)
    for (const tool of tools?.filter((tool) => WRITING_TOOLS.includes(tool)) ?? []) problems.push(`${path}: tools include ${tool}; a judging agent is read-only`)
    if (field('memory')) problems.push(`${path}: memory turns on Write and Edit; a judging agent is read-only`)
    const [model, why] = MODELS[file] ?? ['inherit', 'neutrality comes from a fresh context, not a different model']
    if (field('model') !== model) problems.push(`${path}: model "${field('model')}" should be "${model}"; ${why}`)
    return problems
  })
}
