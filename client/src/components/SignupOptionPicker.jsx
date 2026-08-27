import { useMemo, useRef, useState } from 'react'

// Type-ahead multi-select for the public /join sign-up page: start typing, matching
// existing options appear to pick from, and anything genuinely new can be added — which
// saves it to the shared list so every picker across the app offers it from then on
// (and flags it to Sarede, see server/routes/instructorSignup.js notifySaredeNewOption).
//
// Deliberately its own component rather than reusing StylePicker: that one renders every
// option as a chip up front (fine for ~15 class styles on a staff page) and its add-new
// path hits an authenticated route. Here the lists are longer, the audience is a stranger
// on their phone, and there's no session — so it's search-first, and it takes its
// onAdd/onChange from the caller instead of calling the API itself.
//
//   options   — [{ id, name }] current canonical list
//   value     — comma-separated string of what's selected
//   onChange  — called with the updated comma-separated string
//   onAdd     — async (name) => saved row; called only for a genuinely new name
//   placeholder, addLabel — copy tweaks per use
export default function SignupOptionPicker({
  options, value, onChange, onAdd, placeholder = 'Start typing…', addLabel = 'option',
}) {
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const selected = useMemo(
    () => (value || '').split(',').map(s => s.trim()).filter(Boolean),
    [value]
  )

  const q = query.trim().toLowerCase()
  const matches = q
    ? options
        .filter(o => o.name.toLowerCase().includes(q) && !selected.some(s => s.toLowerCase() === o.name.toLowerCase()))
        .slice(0, 6)
    : []

  // Only offer "add" when what they typed isn't already an option or already picked —
  // otherwise a near-miss like "yoga" vs "Yoga" would quietly create a duplicate.
  const exactExists =
    options.some(o => o.name.toLowerCase() === q) || selected.some(s => s.toLowerCase() === q)
  const canAdd = q.length > 0 && !exactExists

  function pick(name) {
    if (!selected.some(s => s.toLowerCase() === name.toLowerCase())) {
      onChange([...selected, name].join(', '))
    }
    setQuery('')
    inputRef.current?.focus()
  }

  function remove(name) {
    onChange(selected.filter(s => s !== name).join(', '))
  }

  async function handleAdd() {
    if (!canAdd) return
    setSaving(true); setError('')
    try {
      const row = await onAdd(query.trim())
      pick(row?.name || query.trim())
    } catch (err) {
      setError(err.message || `Could not add that ${addLabel}`)
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (matches.length > 0) pick(matches[0].name)
      else if (canAdd) handleAdd()
    }
    if (e.key === 'Backspace' && !query && selected.length > 0) {
      remove(selected[selected.length - 1])
    }
  }

  return (
    <div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(name => (
            <span key={name}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-100 border border-purple-300 text-purple-800 text-xs font-medium">
              {name}
              <button type="button" onClick={() => remove(name)}
                className="text-purple-500 hover:text-purple-900 leading-none">✕</button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); setError('') }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
      />

      {(matches.length > 0 || canAdd) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {matches.map(o => (
            <button key={o.id} type="button" onClick={() => pick(o.name)}
              className="px-2.5 py-1 rounded-full border border-gray-300 bg-gray-50 text-gray-700 text-xs font-medium hover:border-gray-400 hover:bg-gray-100">
              {o.name}
            </button>
          ))}
          {canAdd && (
            <button type="button" onClick={handleAdd} disabled={saving}
              className="px-2.5 py-1 rounded-full border border-dashed border-emerald-400 text-emerald-700 text-xs font-medium hover:bg-emerald-50 disabled:opacity-50">
              {saving ? 'Adding…' : `+ Add "${query.trim()}"`}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}
