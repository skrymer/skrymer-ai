export function findLeaks(files, terms) {
  const leaks = []
  for (const { path, content } of files) {
    content.split('\n').forEach((text, i) => {
      for (const term of terms) {
        if (text.toLowerCase().includes(term.toLowerCase())) leaks.push({ path, line: i + 1, term })
      }
    })
  }
  return leaks
}

/** A denylist line is `term`, or `term :: path` to allow the term in that one file. */
export function checkRepo(files, denylistPath) {
  const denylist = files.find((f) => f.path === denylistPath)
  const entries = (denylist?.content ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [term, allowedIn] = line.split('::').map((part) => part.trim())
      return { term, allowedIn }
    })
  const scanned = files.filter((f) => f.path !== denylistPath)
  return entries.flatMap(({ term, allowedIn }) =>
    findLeaks(
      scanned.filter((f) => f.path !== allowedIn),
      [term]
    )
  )
}

const DENYLIST = 'leak-denylist.txt'

if (import.meta.url === `file://${process.argv[1]}`) {
  const { execFileSync } = await import('node:child_process')
  const { readFileSync } = await import('node:fs')
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  const leaks = checkRepo(
    paths.map((path) => ({ path, content: readFileSync(path, 'utf8') })),
    DENYLIST
  )
  for (const { path, line, term } of leaks) console.error(`${path}:${line}: project-specific term "${term}"`)
  if (leaks.length) {
    console.error(`leak-check: ${leaks.length} project-specific term(s) found. Generalise them, or move the content into the project.`)
    process.exit(1)
  }
  console.log('leak-check: clean')
}
