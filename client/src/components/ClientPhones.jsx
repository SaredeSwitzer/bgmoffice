import { useEffect, useState } from 'react'
import { api } from '../api/client'
import PhoneLink from './PhoneLink'
import Byline from './Byline'

// A client can have as many numbers as they actually have, each ticked for what it's for.
// A cell does everything; an office line takes calls only; a husband's phone might be the
// one that answers texts. A new number defaults to calls and texts, because that is what
// almost every number is — the ticks are there for the exceptions.
//
// The main number is what invoices, the client list and the call button use. Texts go to
// the first number ticked for texts, main number first, and texting a number that isn't
// ticked for texts is refused with the right number offered instead.

const BLANK = { phone: '', label: '', for_calls: true, for_texts: true, for_whatsapp: false }

function Tick({ checked, onChange, children }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="rounded border-gray-300" />
      {children}
    </label>
  )
}

function PhoneForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...BLANK, ...initial })
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function submit(e) {
    e.preventDefault()
    if (!form.phone.trim()) { setError('Enter a phone number.'); return }
    if (!form.for_calls && !form.for_texts && !form.for_whatsapp) {
      setError("Say what the number is for — otherwise it's a number nobody can reach them at.")
      return
    }
    setError('')
    onSave(form)
  }

  const input = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <form onSubmit={submit} className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={form.phone} onChange={e => set('phone', e.target.value)}
          placeholder="718-555-0000" className={input} autoFocus />
        <input value={form.label || ''} onChange={e => set('label', e.target.value)}
          placeholder="What is it? cell, office, husband…" className={input} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Use it for</span>
        <Tick checked={form.for_calls} onChange={v => set('for_calls', v)}>Calls</Tick>
        <Tick checked={form.for_texts} onChange={v => set('for_texts', v)}>Texts</Tick>
        <Tick checked={form.for_whatsapp} onChange={v => set('for_whatsapp', v)}>WhatsApp</Tick>
      </div>
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

// The one-line summary under a number. "Calls and texts" is the ordinary case and says
// itself; the exceptions are what someone reading the profile needs to notice.
function usesLabel(p) {
  const on = [p.for_calls && 'Calls', p.for_texts && 'Texts', p.for_whatsapp && 'WhatsApp'].filter(Boolean)
  return on.length ? on.join(' · ') : 'Not in use'
}

export default function ClientPhones({ clientId, onChanged }) {
  const [rows, setRows]       = useState(null)
  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving]   = useState(false)

  function load() {
    api.getClientPhones(clientId).then(setRows).catch(() => setRows([]))
  }
  useEffect(load, [clientId])

  async function handleAdd(form) {
    setSaving(true)
    try { await api.addClientPhone(clientId, form); setAdding(false); load(); onChanged?.() }
    finally { setSaving(false) }
  }

  async function handleEdit(form) {
    setSaving(true)
    try { await api.updateClientPhone(clientId, editing.id, form); setEditing(null); load(); onChanged?.() }
    finally { setSaving(false) }
  }

  async function makeMain(id) {
    await api.setMainClientPhone(clientId, id)
    load(); onChanged?.()
  }

  async function remove(p) {
    if (!confirm(`Remove ${p.phone}?`)) return
    await api.deleteClientPhone(clientId, p.id)
    load(); onChanged?.()
  }

  if (rows === null) return null

  // Worth saying out loud: with numbers on file and none of them ticked for texts, no
  // text can go out at all — easier to see here than to discover on a Sunday night.
  const noTextable = rows.length > 0 && !rows.some(p => p.for_texts)

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-blue-400">
          Phone Numbers
          {rows.length > 1 && (
            <span className="ml-2 text-xs font-semibold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">{rows.length}</span>
          )}
        </h2>
        {!adding && !editing && (
          <button onClick={() => setAdding(true)}
            className="text-xs text-gray-500 hover:text-gray-800 border border-dashed border-gray-300 hover:border-gray-400 px-2.5 py-1 rounded-lg">
            + Add number
          </button>
        )}
      </div>

      {rows.length === 0 && !adding && (
        <p className="text-sm text-gray-400 italic">No phone number on file.</p>
      )}

      <div className="space-y-1.5">
        {rows.map(p => (
          editing?.id === p.id ? (
            <PhoneForm key={p.id} initial={p} onSave={handleEdit} onCancel={() => setEditing(null)} saving={saving} />
          ) : (
            <div key={p.id} className="flex flex-wrap items-start justify-between gap-2 border border-gray-200 rounded-xl px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                  <PhoneLink phone={p.phone} />
                  {p.label && <span className="text-xs font-normal text-gray-500">{p.label}</span>}
                  {p.is_primary && (
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">
                      Main
                    </span>
                  )}
                </p>
                <p className={`text-[11px] ${p.for_texts ? 'text-gray-500' : 'text-orange-600 font-medium'}`}>
                  {usesLabel(p)}
                </p>
                <Byline author={p.created_by} at={p.created_at} />
              </div>
              {/* Always visible, and words rather than glyphs. These used to appear only
                  on hover, copied from the addresses list — which means they do not exist
                  at all on a phone or tablet, and are easy to miss on a laptop. Editing a
                  number is the main thing anyone does here; it cannot be hidden. */}
              <div className="flex items-center gap-2 shrink-0">
                {!p.is_primary && (
                  <button onClick={() => makeMain(p.id)}
                    className="text-[11px] text-blue-600 hover:underline whitespace-nowrap">
                    Make main
                  </button>
                )}
                <button onClick={() => setEditing(p)}
                  className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
                  Edit
                </button>
                <button onClick={() => remove(p)}
                  className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50">
                  Remove
                </button>
              </div>
            </div>
          )
        ))}
      </div>

      {adding && <PhoneForm initial={BLANK} onSave={handleAdd} onCancel={() => setAdding(false)} saving={saving} />}

      {noTextable && (
        <p className="text-[11px] text-orange-600">
          None of these numbers is set for texts, so no text can go to this client — not reminders,
          not class confirmations. Tick Texts on whichever number they read texts at.
        </p>
      )}
      {rows.length > 1 && !noTextable && (
        <p className="text-[11px] text-gray-400">
          Texts go to the first number set for texts, main number first. The main number is what
          invoices and the client list show.
        </p>
      )}
    </section>
  )
}
