import { useEffect, useState } from 'react'
import { api } from '../api/client'

// Clients who are taught in more than one place — a Brooklyn home and an upstate house,
// a main site and an annexe. One of them is the primary: it's what the client record,
// invoices and confirmation emails use, and what a new class defaults to.

const BLANK = { label: '', street: '', city: '', state: '', zip: '', neighborhood: '', notes: '' }

function AddressForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...BLANK, ...initial })
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function submit(e) {
    e.preventDefault()
    if (!form.label.trim()) { setError('Give it a name so staff can tell them apart — "Brooklyn", "Upstate".'); return }
    setError('')
    onSave(form)
  }

  const input = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <form onSubmit={submit} className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
          What to call it
        </label>
        <input value={form.label} onChange={e => set('label', e.target.value)}
          placeholder="Brooklyn, Upstate, Main site…" className={input} autoFocus />
      </div>
      <input value={form.street} onChange={e => set('street', e.target.value)}
        placeholder="Street address" className={input} />
      <div className="grid grid-cols-3 gap-2">
        <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="City" className={input} />
        <input value={form.state} onChange={e => set('state', e.target.value)} placeholder="State" className={input} />
        <input value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="Zip" className={input} />
      </div>
      <input value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)}
        placeholder="Neighborhood" className={input} />
      <input value={form.notes} onChange={e => set('notes', e.target.value)}
        placeholder="Anything the instructor needs to know — parking, side entrance…" className={input} />
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 hover:bg-blue-700">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">Cancel</button>
      </div>
    </form>
  )
}

export function formatAddress(a) {
  return [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ')
}

export default function ClientAddresses({ clientId, onChanged }) {
  const [rows, setRows]     = useState(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  function load() {
    api.getClientAddresses(clientId).then(setRows).catch(() => setRows([]))
  }
  useEffect(load, [clientId])

  async function handleAdd(form) {
    setSaving(true)
    try { await api.addClientAddress(clientId, form); setAdding(false); load(); onChanged?.() }
    finally { setSaving(false) }
  }

  async function handleEdit(form) {
    setSaving(true)
    try { await api.updateClientAddressRow(clientId, editing.id, form); setEditing(null); load(); onChanged?.() }
    finally { setSaving(false) }
  }

  async function makePrimary(id) {
    await api.setPrimaryClientAddress(clientId, id)
    load(); onChanged?.()
  }

  async function remove(a) {
    if (!confirm(`Remove "${a.label}"? Classes booked at it will fall back to the main address.`)) return
    await api.deleteClientAddress(clientId, a.id)
    load(); onChanged?.()
  }

  if (rows === null) return null

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-blue-400">
          Addresses
          {rows.length > 1 && (
            <span className="ml-2 text-xs font-semibold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">{rows.length}</span>
          )}
        </h2>
        {!adding && !editing && (
          <button onClick={() => setAdding(true)}
            className="text-xs text-gray-500 hover:text-gray-800 border border-dashed border-gray-300 hover:border-gray-400 px-2.5 py-1 rounded-lg">
            + Add address
          </button>
        )}
      </div>

      {rows.length === 0 && !adding && (
        <p className="text-sm text-gray-400 italic">No address on file.</p>
      )}

      <div className="space-y-1.5">
        {rows.map(a => (
          editing?.id === a.id ? (
            <AddressForm key={a.id} initial={a} onSave={handleEdit} onCancel={() => setEditing(null)} saving={saving} />
          ) : (
            <div key={a.id} className="flex items-start justify-between gap-3 border border-gray-200 rounded-xl px-3 py-2 group">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                  {a.label}
                  {a.is_primary && (
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">
                      Main
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-600">{formatAddress(a) || <span className="italic text-gray-400">No street address</span>}</p>
                {a.neighborhood && <p className="text-[11px] text-gray-400">{a.neighborhood}</p>}
                {a.notes && <p className="text-[11px] text-gray-500 mt-0.5">{a.notes}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {!a.is_primary && (
                  <button onClick={() => makePrimary(a.id)} className="text-[11px] text-blue-600 hover:underline">
                    Make main
                  </button>
                )}
                <button onClick={() => setEditing(a)} className="text-xs text-gray-400 hover:text-gray-700" title="Edit">✎</button>
                <button onClick={() => remove(a)} className="text-xs text-gray-300 hover:text-red-500" title="Remove">✕</button>
              </div>
            </div>
          )
        ))}
      </div>

      {adding && <AddressForm initial={BLANK} onSave={handleAdd} onCancel={() => setAdding(false)} saving={saving} />}

      {rows.length > 1 && (
        <p className="text-[11px] text-gray-400">
          The main address is what invoices and confirmation emails use. When you add a class you
          can pick which of these it&rsquo;s at.
        </p>
      )}
    </section>
  )
}

// A dropdown for "which address is this class at?", for the schedule and recruiting forms.
// Renders nothing when the client only has one address — there'd be nothing to choose.
export function AddressPicker({ clientId, value, onChange, label = 'Address' }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!clientId) { setRows([]); return }
    let cancelled = false
    api.getClientAddresses(clientId)
      .then(r => { if (!cancelled) setRows(r) })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [clientId])

  if (rows.length < 2) return null

  // A class with no address of its own runs at the client's main one. The select has to
  // SHOW that, or it silently displays the first option while holding nothing — which is
  // what made picking an address look like it worked and then change nothing.
  const primary = rows.find(a => a.is_primary) || rows[0]
  const shown = value ?? primary?.id ?? ''

  return (
    <div>
      <label className="block text-[10px] font-medium text-gray-500 mb-1">{label}</label>
      <select
        value={String(shown)}
        onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
        className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {rows.map(a => (
          <option key={a.id} value={String(a.id)}>
            {a.label}{a.is_primary ? ' (main)' : ''}{a.city ? ` — ${a.city}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
