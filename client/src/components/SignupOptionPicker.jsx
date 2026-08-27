import { useState } from 'react'

// Tap-to-toggle multi-select used on the public /join sign-up page and on an
// instructor's own profile. Every option is on screen as a chip so you pick by
// recognising it, not by guessing what to type; the only typing is "+ Other", for a
// name genuinely not on the list yet — which saves to the shared list so every picker
// across the app offers it from then on (and flags it to Sarede, see
// server/routes/instructorSignup.js notifySaredeNewOption).
//
//   options   — [{ id, name }] current canonical list
//   value     — comma-separated string of what's selected
//   onChange  — called with the updated comma-separated string
//   onAdd     — async (name) => saved row; called only for a genuinely new name
//   addLabel  — noun used in the "Other" affordance + error copy
export default function SignupOptionPicker({ options, value, onChange, onAdd, addLabel = 'option' }) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selected = (value || '').split(',').map(s => s.trim()).filter(Boolean)

  // Anything already saved on this record that isn't in the canonical list (e.g. typed
  // in before this picker existed) still needs to show as a chip, or editing anything
  // else on the form would silently drop it.
  const names = [...new Set([...options.map(o => o.name), ...selected])]
    .sort((a, b) => a.localeCompare(b))

  function toggle(name) {
    const next = selected.some(s => s.toLowerCase() === name.toLowerCase())
      ? selected.filter(s => s.toLowerCase() !== name.toLowerCase())
      : [...selected, name]
    onChange(next.join(', '))
  }

  async function handleAdd() {
    const trimmed = newName.trim()
    if (!trimmed) return
    // Already on the list (or already picked) — just select it rather than creating a
    // near-duplicate like "yoga" alongside "Yoga".
    const existing = names.find(n => n.toLowerCase() === trimmed.toLowerCase())
    if (existing) {
      if (!selected.some(s => s.toLowerCase() === existing.toLowerCase())) toggle(existing)
      setNewName(''); setAdding(false)
      return
    }
    setSaving(true); setError('')
    try {
      const row = await onAdd(trimmed)
      onChange([...selected, row?.name || trimmed].join(', '))
      setNewName(''); setAdding(false)
    } catch (err) {
      setError(err.message || `Could not add that ${addLabel}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center">
        {names.map(name => {
          const checked = selected.some(s => s.toLowerCase() === name.toLowerCase())
          return (
            <button key={name} type="button" onClick={() => toggle(name)}
              className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                checked
                  ? 'bg-purple-100 border-purple-400 text-purple-800'
                  : 'bg-gray-50 border-gray-300 text-gray-600 hover:border-gray-400'
              }`}>
              {checked && <span className="mr-1">✓</span>}{name}
            </button>
          )
        })}

        {adding ? (
          // Deliberately not a <form> — this renders inside the profile/sign-up <form>,
          // and a nested form is invalid HTML that browsers flatten, so a submit here
          // would submit the outer form instead of just adding the option.
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={newName}
              onChange={e => { setNewName(e.target.value); setError('') }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
                if (e.key === 'Escape') { setAdding(false); setNewName(''); setError('') }
              }}
              placeholder={`Add a ${addLabel}`}
              className="border border-gray-300 rounded-full px-2.5 py-1 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-purple-300"
            />
            <button type="button" onClick={handleAdd} disabled={saving}
              className="text-xs text-emerald-600 hover:text-emerald-800 disabled:opacity-50">
              {saving ? '…' : '✓'}
            </button>
            <button type="button" onClick={() => { setAdding(false); setNewName(''); setError('') }}
              className="text-xs text-gray-400 hover:text-gray-600">✕</button>
          </span>
        ) : (
          <button type="button" onClick={() => setAdding(true)}
            className="px-2.5 py-1 rounded-full border border-dashed border-gray-400 text-gray-500 text-xs font-medium hover:border-gray-500 hover:text-gray-700">
            + Other
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}
