import { useState, useEffect, useRef } from 'react'

/**
 * Searchable combobox for selecting from a list of { id, name } objects.
 *
 * Props:
 *   label       — field label text
 *   required    — show asterisk if true
 *   options     — array of { id, name, ... }
 *   value       — single mode: selected object (or null)
 *                 multi mode:  array of selected objects
 *   onChange    — single mode: called with selected object or null
 *                 multi mode:  called with updated array
 *   placeholder — input placeholder
 *   clearable   — show an "× clear" button when a value is selected (default true, single mode only)
 *   multi       — enable multi-select chip mode (default false)
 */
export default function SearchSelect({
  label, required = false, options = [], value, onChange,
  placeholder = 'Search…', clearable = true, multi = false,
}) {
  const [query, setQuery] = useState(multi ? '' : (value?.name || ''))
  const [open,  setOpen]  = useState(false)
  const containerRef = useRef(null)

  // Single mode: keep display text in sync when parent changes value
  useEffect(() => {
    if (!multi) setQuery(value?.name || '')
  }, [value, multi])

  const selectedIds = multi ? new Set((value || []).map(v => v.id)) : new Set()

  const filtered = options
    .filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    .filter(o => !selectedIds.has(o.id))
    .slice(0, 10)

  function select(o) {
    if (multi) {
      onChange([...(value || []), o])
      setQuery('')
      // keep dropdown open for more selections
    } else {
      onChange(o)
      setQuery(o.name)
      setOpen(false)
    }
  }

  function clear(e) {
    e.stopPropagation()
    onChange(null)
    setQuery('')
  }

  function removeChip(e, o) {
    e.stopPropagation()
    onChange((value || []).filter(v => v.id !== o.id))
  }

  function handleBlur(e) {
    if (!containerRef.current?.contains(e.relatedTarget)) {
      setOpen(false)
      if (!multi) {
        if (!value || query !== value.name) {
          onChange(null)
          setQuery('')
        }
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
          onChange={e => {
            setQuery(e.target.value)
            if (!multi) onChange(null)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={multi && (value || []).length > 0 ? 'Add another…' : placeholder}
          autoComplete="off"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 pr-16"
        />

        {/* Status badges (single mode only) */}
        {!multi && (
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
        )}

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
                  !multi && value?.id === o.id
                    ? 'bg-teal-50 text-teal-800 font-medium'
                    : 'text-gray-800 hover:bg-gray-50'
                }`}
              >
                {o.name}
              </button>
            )) : (
              <p className="px-3 py-2 text-xs text-gray-400 italic">
                {query ? `No results for "${query}"` : (multi ? 'No more options' : 'No options')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Chips (multi mode) */}
      {multi && (value || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {(value || []).map(o => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 bg-gray-100 text-gray-800 text-xs font-medium px-2 py-1 rounded-full"
            >
              {o.name}
              <button
                type="button"
                onMouseDown={e => removeChip(e, o)}
                className="text-gray-400 hover:text-red-500 leading-none"
                title={`Remove ${o.name}`}
              >✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
