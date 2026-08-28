import { useState } from 'react'
import { api } from '../api/client'

// Read-only "📍 neighborhood / street, city, zip" block with an inline edit mode —
// used wherever a class shows its client's location (ClassSessionModal, SchedulePage's
// recurring-class form) so staff can fix a missing/wrong address on the spot instead of
// navigating to the client's own profile page. Saves straight to the client record via
// PATCH /clients/:id (address lives on the client, not the class/schedule/session).
//
// No <form> here on purpose: this renders inside another <form> (the class edit form)
// in every caller, and nested <form> elements are invalid HTML / submit unpredictably.
export default function ClientAddressEditor({ client, onUpdated, className = '' }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function startEdit() {
    setForm({
      neighborhood: client.neighborhood || '',
      street: client.street || '',
      city: client.city || '',
      state: client.state || '',
      zip: client.zip || '',
    })
    setError('')
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await api.updateClientAddress(client.id, form)
      onUpdated(form)
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className={`text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 space-y-1.5 ${className}`}>
        <div className="grid grid-cols-2 gap-1.5">
          <input value={form.neighborhood} onChange={e => setForm(f => ({ ...f, neighborhood: e.target.value }))}
            placeholder="Neighborhood" className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <input value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))}
            placeholder="Zip" className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-gray-300" />
        </div>
        <input value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))}
          placeholder="Street" className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <div className="grid grid-cols-2 gap-1.5">
          <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
            placeholder="City" className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
            placeholder="State" className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-gray-300" />
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex gap-1.5 pt-0.5">
          <button type="button" onClick={handleSave} disabled={saving}
            className="px-2.5 py-1 bg-gray-900 text-white rounded text-xs font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditing(false)}
            className="px-2.5 py-1 border border-gray-300 rounded text-xs text-gray-600">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const hasAddress = client.neighborhood || client.street

  return hasAddress ? (
    <div className={`text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 flex items-start justify-between gap-2 ${className}`}>
      <div className="min-w-0">
        {client.neighborhood && <p className="font-medium">📍 {client.neighborhood}</p>}
        {(client.street || client.city || client.state || client.zip) && (
          <p className="text-gray-500 truncate">{[client.street, [client.city, client.state].filter(Boolean).join(', '), client.zip].filter(Boolean).join(', ')}</p>
        )}
      </div>
      <button type="button" onClick={startEdit} className="text-gray-400 hover:text-gray-700 flex-shrink-0">Edit</button>
    </div>
  ) : (
    <div className={`text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 ${className}`}>
      <span>No address on file for {client.name}.</span>
      <button type="button" onClick={startEdit} className="text-amber-700 hover:text-amber-900 font-medium flex-shrink-0">+ Add</button>
    </div>
  )
}
