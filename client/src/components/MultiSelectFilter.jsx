import { useEffect, useRef, useState } from 'react'

// A filter box you can tick more than one thing in.
//
// A plain dropdown can only ask "which one?", and the real question is usually "which of
// these?" — Pilates *or* Zumba, Brooklyn *or* Queens. Ticking two used to mean running the
// search twice and holding both lists in your head.
//
// Closed, it says what's chosen: "All styles", then "Pilates", then "3 styles" once the
// list is too long to read at a glance. Open, it's checkboxes.
export default function MultiSelectFilter({
  options,            // array of strings, or { value, label }
  values,             // array of chosen values
  onChange,           // (nextValues) => void
  allLabel,           // "All styles" — what it says when nothing is chosen
  noun,               // "styles" — used for "3 styles"
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  // Clicking anywhere else closes it, the way every other dropdown on the page does.
  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o))
  const chosen = new Set(values)

  function toggle(value) {
    onChange(chosen.has(value) ? values.filter(v => v !== value) : [...values, value])
  }

  const label = values.length === 0 ? allLabel
    : values.length === 1 ? (items.find(i => i.value === values[0])?.label || values[0])
    : `${values.length} ${noun}`

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 border rounded-xl px-3 py-2 text-sm bg-white text-left ${
          values.length ? 'border-gray-400 text-gray-900 font-medium' : 'border-gray-300 text-gray-600'
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="text-gray-400 text-xs shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[190px] max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg py-1">
          {values.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-gray-50">
              Clear ({values.length})
            </button>
          )}
          {items.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400 italic">Nothing to choose from yet.</p>
          ) : items.map(item => (
            <label key={item.value}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={chosen.has(item.value)}
                onChange={() => toggle(item.value)} className="rounded" />
              <span className="truncate">{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
