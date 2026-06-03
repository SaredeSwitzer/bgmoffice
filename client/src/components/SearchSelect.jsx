import { useState, useEffect, useRef } from 'react'

/**
 * Searchable combobox for selecting from a list of { id, name } objects.
 *
 * Props:
 *   label       — field label text
 *   required    — show asterisk if true
 *   options     — array of { id, name, ... }
 *   value       — currently selected object (or null)
 *   onChange    — called with selected object or null
 *   placeholder — input placeholder
 *   clearable   — show an "× clear" button when a value is selected (default true)
 */
export default function SearchSelect({
  label, required = false, options = [], value, onChange,
  placeholder = 'Search…', clearable = true,
}) {
  const [query, setQuery] = useState(value?.name || '')
  const [open,  setOpen]  = useState(false)
  const containerRef = useRef(null)

  // Keep display text in sync when parent changes value
  useEffect(() => { setQuery(value?.name || '') }, [value])

  const filtered = options
    .filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 10)

  function select(o) {
    onChange(o)
    setQuery(o.name)
    setOpen(false)
  }

  function clear(e) {
    e.stopPropagation()
    onChange(null)
    setQuery('')
  }

  function handleBlur(e) {
    if (!containerRef.current?.contains(e.relatedTarget)) {
      setOpen(false)
      // If text doesn't match selection, clear
      if (!value || query !== value.name) {
        onChange(null)
        setQuery('')
      }
    }
  }

  return (
    <div>
      {label && (
        <label className="block text-xs font-medium text-gray-600 mb-1">
          {label}{required && ' *'}
        </label>
      )}
      <div ref={containerRef} className="relative" onBlur={handleBlur}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); onChange(null); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 pr-16"
        />

        {/* Status badges */}
        <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {value && clearable && (
            <button
              type="button"
              onMouseDown={clear}
              className="text-[10px] text-gray-400 hover:text-red-500 leading-none px-1"
              title="Clear"
            >✕</button>
          )}
          {value && (
            <span className="text-teal-500 text-xs font-bold pointer-events-none">✓</span>
          )}
        </span>

        {/* Dropdown */}
        {open && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-44 overflow-y-auto">
            {filtered.length > 0 ? filtered.map(o => (
              <button
                key={o.id}
                type="button"
                tabIndex={0}
                onMouseDown={() => select(o)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  value?.id === o.id
                    ? 'bg-teal-50 text-teal-800 font-medium'
                    : 'text-gray-800 hover:bg-gray-50'
                }`}
              >
                {o.name}
              </button>
            )) : (
              <p className="px-3 py-2 text-xs text-gray-400 italic">
                {query ? `No results for "${query}"` : 'No options'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
