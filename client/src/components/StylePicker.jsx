import { useState } from 'react'
import { api } from '../api/client'

// Tap-to-toggle chip picker for "styles taught" — plus an inline "+ Add style" for
// adding a fitness style that isn't in the list yet. A style added here is saved to the
// shared class_styles list (same one recruiting/other instructor forms pull from), so it
// shows up as an option everywhere immediately, not just on this instructor.
//   styleNames  — canonical styles + anything already typed on this record, deduped/sorted
//   value       — comma-separated string of this instructor's selected styles
//   onChange    — called with the updated comma-separated string
//   onStyleAdded — called with the new { id, name } row so the parent's style list updates
export default function StylePicker({ styleNames, value, onChange, onStyleAdded }) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selected = (value || '').split(',').map(s => s.trim()).filter(Boolean)

  function toggle(name) {
    const next = selected.includes(name) ? selected.filter(s => s !== name) : [...selected, name]
    onChange(next.join(', '))
  }

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true); setError('')
    try {
      const style = await api.createClassStyle(newName.trim())
      onStyleAdded?.(style)
      onChange([...selected, style.name].join(', '))
      setNewName('')
      setAdding(false)
    } catch (err) {
      setError(err.message || 'Could not add that style')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center">
        {styleNames.map(name => {
          const checked = selected.includes(name)
          return (
            <button key={name} type="button" onClick={() => toggle(name)}
              className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                checked ? 'bg-purple-100 border-purple-400 text-purple-800' : 'bg-gray-50 border-gray-300 text-gray-600 hover:border-gray-400'
              }`}>
              {name}
            </button>
          )
        })}
        {adding ? (
          // Deliberately not a <form> — this renders inside another <form> (the
          // instructor edit form) in every caller, and a nested <form> is invalid HTML;
          // browsers flatten it into the outer form, so a "submit" button here actually
          // submits/saves the *outer* form instead of just adding the style.
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
                if (e.key === 'Escape') { setAdding(false); setNewName('') }
              }}
              onBlur={() => { if (!newName.trim()) setAdding(false) }}
              placeholder="New style name"
              className="border border-gray-300 rounded-full px-2.5 py-1 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-purple-300"
            />
            <button type="button" onClick={handleAdd} disabled={saving} className="text-xs text-emerald-600 hover:text-emerald-800 disabled:opacity-50">✓</button>
            <button type="button" onClick={() => { setAdding(false); setNewName('') }} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
          </span>
        ) : (
          <button type="button" onClick={() => setAdding(true)}
            className="px-2.5 py-1 rounded-full border border-dashed border-gray-300 text-gray-500 text-xs font-medium hover:border-gray-400 hover:text-gray-700">
            + Add style
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}
