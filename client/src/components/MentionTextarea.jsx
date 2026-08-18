import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Detects "@partial" immediately before the cursor (no newline in between) so a
// dropdown of matching users can be shown. Matching itself (on save) lives in
// server/lib/mentions.js — this only has to agree on the "@Full Name" format.
function activeQuery(text, caret) {
  const upToCaret = text.slice(0, caret)
  const at = upToCaret.lastIndexOf('@')
  if (at === -1) return null
  const between = upToCaret.slice(at + 1)
  if (between.includes('\n') || between.length > 40) return null
  return between
}

// Plain <textarea> with @mention autocomplete against a small `users` list — types
// "@" to open a dropdown, arrow keys + Enter (or click) to pick. Selecting inserts
// "@Full Name " as plain text; forwardRef so callers can still call .focus()/etc.
// on it like a native textarea (matches existing NotesThread usage).
//
// The dropdown is rendered through a portal into document.body, positioned via the
// textarea's bounding rect — several callers (e.g. RecruitingPage's EntryCard) wrap
// this in an `overflow-hidden` card for rounded corners, which would otherwise clip
// an absolutely-positioned dropdown right at the point it needs to be visible.
const MentionTextarea = forwardRef(function MentionTextarea(
  { value, onChange, users = [], placeholder, rows = 2, className = '', onKeyDown, autoFocus },
  forwardedRef
) {
  const innerRef = useRef(null)
  useImperativeHandle(forwardedRef, () => innerRef.current)
  const [query, setQuery] = useState(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [coords, setCoords] = useState(null)

  const matches = query === null ? [] :
    users.filter(u => u.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6)

  useLayoutEffect(() => {
    if (query === null || !innerRef.current) { setCoords(null); return }
    const rect = innerRef.current.getBoundingClientRect()
    setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width })
  }, [query])

  function handleChange(e) {
    const text = e.target.value
    onChange(text)
    setQuery(activeQuery(text, e.target.selectionStart))
    setActiveIdx(0)
  }

  function pick(u) {
    const el = innerRef.current
    const caret = el.selectionStart
    const upToCaret = value.slice(0, caret)
    const at = upToCaret.lastIndexOf('@')
    const before = value.slice(0, at)
    const after = value.slice(caret)
    const inserted = `@${u.name} `
    onChange(before + inserted + after)
    setQuery(null)
    requestAnimationFrame(() => {
      el.focus()
      const pos = before.length + inserted.length
      el.setSelectionRange(pos, pos)
    })
  }

  function handleKeyDown(e) {
    if (matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, matches.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); pick(matches[activeIdx]); return }
      if (e.key === 'Escape') { setQuery(null); return }
    }
    onKeyDown?.(e)
  }

  return (
    <>
      <textarea
        ref={innerRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setQuery(null)}
        rows={rows}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={className}
      />
      {matches.length > 0 && coords && createPortal(
        <div
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width }}
          className="z-50 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto"
        >
          {matches.map((u, i) => (
            <button key={u.id} type="button" onMouseDown={e => { e.preventDefault(); pick(u) }}
              className={`w-full text-left px-3 py-1.5 text-sm ${i === activeIdx ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
              @{u.name}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
})

export default MentionTextarea
