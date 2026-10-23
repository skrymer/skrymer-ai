import { posix } from 'node:path'

/** A skill's `name` must match its directory, and every relative link in a skill file must reach a file. */
export function findSkillProblems(files) {
  const paths = new Set(files.map((f) => f.path))
  const problems = []
  for (const { path, content } of files) {
    const dir = path.match(/\/skills\/([^/]+)\/SKILL\.md$/)?.[1]
    if (dir) {
      const name = content.match(/^name:\s*(.+)$/m)?.[1].trim()
      if (name !== dir) problems.push(`${path}: name "${name}" should be "${dir}"`)
    }
    if (!/\/skills\/.+\.md$/.test(path)) continue
    let fenced = false
    content.split('\n').forEach((text, i) => {
      if (text.trimStart().startsWith('```')) fenced = !fenced
      if (fenced) return
      for (const [, target] of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
        if (/^[a-z]+:/.test(target)) continue
        if (!paths.has(posix.join(posix.dirname(path), target))) problems.push(`${path}:${i + 1}: link "${target}" points at no file`)
      }
    })
  }
  return problems
}
