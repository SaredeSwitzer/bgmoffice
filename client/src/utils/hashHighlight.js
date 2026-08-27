import { useEffect } from 'react'

// Scrolls to and briefly flashes the element matching the current URL's "#note-<id>"
// hash — used so clicking a mention notification (My Tasks) lands right on the specific
// note instead of just the page/entity it's on. Call once the note that might be the
// target has actually rendered (pass a dependency array that changes when it does,
// e.g. [notes] or [loading]).
export function useHashHighlight(deps = []) {
  useEffect(() => {
    const hash = window.location.hash
    if (!hash || !hash.startsWith('#note-')) return
    const el = document.getElementById(hash.slice(1))
    if (!el) return
    const t0 = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.style.transition = 'background-color 0.3s ease, box-shadow 0.3s ease'
      el.style.backgroundColor = '#fef9c3'
      el.style.boxShadow = '0 0 0 2px #fbbf24'
    }, 50)
    const t1 = setTimeout(() => {
      el.style.backgroundColor = ''
      el.style.boxShadow = ''
    }, 2400)
    return () => { clearTimeout(t0); clearTimeout(t1) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
