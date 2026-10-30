// The layout checks verify-browser.mjs runs on a target's current page through playwright-cli's
// run-code, which takes one function expression and hands it the page. It returns a list of
// { check, element, detail }, empty when the page is clean. Focus is walked with real Tab
// presses, since only keyboard focus shows :focus-visible.
async (page) => {
  const MAX_TABS = 40
  const CONTROLS = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [tabindex]:not([tabindex="-1"])'
  const STYLE = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow', 'borderColor', 'backgroundColor', 'color', 'textDecorationLine']

  const findings = await page.evaluate(
    ({ CONTROLS, STYLE }) => {
      const out = []
      const name = (el) => {
        const label = el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || ''
        return `${el.tagName.toLowerCase()}${label.trim() ? ` "${label.trim().replace(/\s+/g, ' ').slice(0, 40)}"` : ''}`
      }
      const shown = (el) => {
        const style = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0'
      }
      const width = document.documentElement.clientWidth
      const height = innerHeight
      if (document.documentElement.scrollWidth > width + 1) {
        out.push({ check: 'overflow', element: 'page', detail: `${document.documentElement.scrollWidth}px wide in a ${width}px viewport` })
      }
      const controls = [...document.querySelectorAll(CONTROLS)].filter(shown)
      const rects = controls.map((el) => el.getBoundingClientRect())
      const touch = matchMedia('(pointer: coarse)').matches
      controls.forEach((el, i) => {
        const r = rects[i]
        if (r.right > width + 1 || r.left < -1) {
          out.push({ check: 'offscreen', element: name(el), detail: `spans ${Math.round(r.left)}px to ${Math.round(r.right)}px in a ${width}px viewport` })
        }
        if (touch && (r.width < 44 || r.height < 44) && !(el.tagName === 'A' && el.closest('p, li') && getComputedStyle(el).display === 'inline')) {
          out.push({ check: 'tap-target', element: name(el), detail: `${Math.round(r.width)}x${Math.round(r.height)}px, under 44px` })
        }
        const x = r.left + r.width / 2
        const y = r.top + r.height / 2
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const top = document.elementFromPoint(x, y)
          if (top && !el.contains(top) && !top.contains(el) && !(el.labels && [...el.labels].some((label) => label.contains(top)))) {
            out.push({ check: 'covered', element: name(el), detail: `its centre is under ${name(top)}` })
          }
        }
        for (let j = i + 1; j < controls.length; j++) {
          const o = rects[j]
          const overlap = Math.min(r.right, o.right) - Math.max(r.left, o.left) > 1 && Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) > 1
          if (overlap && !el.contains(controls[j]) && !controls[j].contains(el)) {
            out.push({ check: 'overlap', element: name(el), detail: `overlaps ${name(controls[j])}` })
          }
        }
      })
      window.__verifyUnfocused = new Map(controls.map((el) => [el, STYLE.map((p) => getComputedStyle(el)[p]).join('|')]))
      return out
    },
    { CONTROLS, STYLE },
  )

  const seen = new Set()
  await page.evaluate(() => {
    document.activeElement?.blur()
    window.scrollTo(0, 0)
  })
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press('Tab')
    const focus = await page.evaluate((STYLE) => {
      const el = document.activeElement
      if (!el || el === document.body || !window.__verifyUnfocused.has(el)) return null
      const label = el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || el.getAttribute('name') || ''
      const element = `${el.tagName.toLowerCase()}${label.trim() ? ` "${label.trim().replace(/\s+/g, ' ').slice(0, 40)}"` : ''}`
      const style = STYLE.map((p) => getComputedStyle(el)[p]).join('|')
      const index = [...window.__verifyUnfocused.keys()].indexOf(el)
      return { index, element, visible: style !== window.__verifyUnfocused.get(el) }
    }, STYLE)
    if (!focus) continue
    if (seen.has(focus.index)) break
    seen.add(focus.index)
    if (!focus.visible) findings.push({ check: 'focus', element: focus.element, detail: 'looks the same focused as unfocused' })
  }
  await page.evaluate(() => {
    document.activeElement?.blur()
    window.scrollTo(0, 0)
    delete window.__verifyUnfocused
  })
  return findings
}
