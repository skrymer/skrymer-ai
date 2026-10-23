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
