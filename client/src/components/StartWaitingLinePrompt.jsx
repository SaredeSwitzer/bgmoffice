import { useEffect, useState } from 'react'
import { api } from '../api/client'

// After texting someone who isn't on the Waiting On sheet: "want a line for this?"
//
// Asked, never assumed. Most texts are not something we're waiting on — a confirmation, a
// thank-you, an answer — and a sheet that grew a line every time somebody was messaged
// would be noise within a week. So this appears only when the person is known, only when
// they have no open line already, and it goes away the moment it's dismissed.
export default function StartWaitingLinePrompt({ person, lastSent, onOpened }) {
  const [state, setState] = useState('checking')   // checking | offer | writing | hidden
  const [what, setWhat] = useState('')
  const [saving, setSaving] = useState(false)

  const key = person ? `${person.kind}-${person.id}` : null

  useEffect(() => {
    if (!person?.id || !person?.kind) { setState('hidden'); return }
    let cancelled = false
    setState('checking')
    api.getWaitingSheetFor(person.kind, person.id)
      .then(rows => { if (!cancelled) setState(rows.length ? 'hidden' : 'offer') })
      .catch(() => { if (!cancelled) setState('hidden') })
    return () => { cancelled = true }
    // Re-checked per person and per message sent: texting them again is a fresh moment to
    // ask, and they may have been added to the sheet in between.
  }, [key, lastSent]) // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    const text = what.trim()
    if (!text) return
    setSaving(true)
    try {
      await api.addWaitingRow({
        what: text,
        people: [{ kind: person.kind, person_id: person.id, name: person.name }],
      })
      setState('hidden')
      setWhat('')
      onOpened?.()
    } finally {
      setSaving(false)
    }
  }

  if (state === 'checking' || state === 'hidden') return null

  return (
    <div className="mx-3 mb-2 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2">
      {state === 'offer' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-blue-900">
            Waiting on {person.name} for something?
          </span>
          <button type="button" onClick={() => setState('writing')}
            className="text-xs font-semibold text-blue-700 hover:underline">
            Add a Waiting On line
          </button>
          <button type="button" onClick={() => setState('hidden')}
            className="ml-auto text-xs text-blue-400 hover:text-blue-700">No thanks</button>
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); create() }} className="flex flex-wrap gap-2 items-center">
          <input
            value={what}
            onChange={e => setWhat(e.target.value)}
            autoFocus
            placeholder={`What are we waiting on ${person.name} for?`}
            className="flex-1 min-w-[220px] rounded-lg border border-blue-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button type="submit" disabled={saving || !what.trim()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:bg-blue-700">
            {saving ? 'Adding…' : 'Add'}
          </button>
          <button type="button" onClick={() => { setState('hidden'); setWhat('') }}
            className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs text-blue-700">Cancel</button>
        </form>
      )}
    </div>
  )
}
