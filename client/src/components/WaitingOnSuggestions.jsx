import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

// "Looks like you're waiting on…" — proposals read out of the notes staff write as they
// work (server/lib/detectWaitingOn.js). Deliberately a staging strip and not the list
// itself: a wrong guess costs one tap here, where on the real list it would be a person
// someone has to chase, or worse, someone quietly dropped from it.
//
// Each card shows the sentence it was read out of. That's the whole trust model — you can
// see why it thinks this without opening the note.
export default function WaitingOnSuggestions({ onAccepted }) {
  const [suggestions, setSuggestions] = useState([])
  const [busyId, setBusyId] = useState(null)
  // Only asked for when the name couldn't be tied to a client or instructor record.
  const [kindFor, setKindFor] = useState({})

  useEffect(() => {
    api.getWaitingOnSuggestions().then(setSuggestions).catch(() => {})
  }, [])

  async function accept(s) {
    setBusyId(s.id)
    try {
      await api.acceptWaitingOnSuggestion(s.id, kindFor[s.id] || s.kind)
      setSuggestions(prev => prev.filter(x => x.id !== s.id))
      onAccepted?.()
    } finally { setBusyId(null) }
  }

  async function dismiss(s) {
    setBusyId(s.id)
    try {
      await api.dismissWaitingOnSuggestion(s.id)
      setSuggestions(prev => prev.filter(x => x.id !== s.id))
    } finally { setBusyId(null) }
  }

  if (suggestions.length === 0) return null

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wide text-indigo-800">
        ✨ Picked up from your notes
        <span className="ml-2 rounded-full bg-indigo-200 px-1.5 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-indigo-800">
          {suggestions.length}
        </span>
      </p>
      <p className="mt-0.5 text-[11px] text-indigo-700">
        Nothing here is on your list yet — these are guesses from what you wrote.
      </p>

      <ul className="mt-2 space-y-2">
        {suggestions.map(s => {
          const linked = s.client_name || s.instructor_name
          const needsKind = s.suggestion_type === 'add' && !linked && !['client', 'instructor'].includes(s.kind)
          return (
            <li key={s.id} className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  {s.suggestion_type === 'resolve' ? (
                    <p className="text-sm text-gray-900">
                      <span className="font-semibold">{s.waiting_on_name}</span> looks like they got back to you
                      {s.waiting_on_what ? <span className="text-gray-500"> — {s.waiting_on_what}</span> : null}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-900">
                      Waiting on <span className="font-semibold">{linked || s.name}</span>
                      {s.what ? <span className="text-gray-500"> — {s.what}</span> : null}
                    </p>
                  )}
                  {s.evidence && (
                    <p className="mt-0.5 text-xs italic text-gray-500">"{s.evidence}"</p>
                  )}
                  {s.link_path && (
                    <Link to={s.link_path} className="text-[11px] text-indigo-600 hover:underline">
                      See the note →
                    </Link>
                  )}
                </div>

                <div className="flex flex-shrink-0 items-center gap-2">
                  {needsKind && (
                    <select
                      value={kindFor[s.id] || 'client'}
                      onChange={e => setKindFor(p => ({ ...p, [s.id]: e.target.value }))}
                      className="rounded border border-gray-200 px-1.5 py-1 text-[11px] text-gray-600"
                    >
                      <option value="client">Client</option>
                      <option value="instructor">Instructor</option>
                    </select>
                  )}
                  <button onClick={() => dismiss(s)} disabled={busyId === s.id}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                    Not this
                  </button>
                  <button onClick={() => accept(s)} disabled={busyId === s.id}
                    className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                    {busyId === s.id ? '…' : s.suggestion_type === 'resolve' ? 'Mark heard back' : 'Add to list'}
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
