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

// The same scroll-and-flash, callable directly.
//
// The hook only fires when its dependencies change, which is right on arrival but useless
// when you are ALREADY on the page and the hash you are setting is the one already there —
// React Router sees no change, nothing re-renders, and the note is never pointed at. Call
// this instead in that case.
export function highlightNote(hash, attempt = 0) {
  if (!hash || !hash.startsWith('#note-')) return
  const el = document.getElementById(hash.slice(1))
  // The note may not be on screen yet: the page may still be switching view, or the
  // thread it lives in may still be opening, and the sheet has to fetch its rows
  // first. Keep looking for a couple of seconds before giving up.
  if (!el) {
    if (attempt < 30) setTimeout(() => highlightNote(hash, attempt + 1), 80)
    return
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.style.transition = 'background-color 0.3s ease, box-shadow 0.3s ease'
  el.style.backgroundColor = '#fef9c3'
  el.style.boxShadow = '0 0 0 2px #fbbf24'
  setTimeout(() => {
    el.style.backgroundColor = ''
    el.style.boxShadow = ''
  }, 2400)
}
