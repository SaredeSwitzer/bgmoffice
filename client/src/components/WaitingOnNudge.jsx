import { useEffect, useState } from 'react'
import { api } from '../api/client'

// "waiting to hear back" typed into a note — offer to put it on the Waiting On sheet.
//
// The phrase was already highlighted wherever it appeared, which told you the app had
// noticed and then did nothing with it. Writing it in a note and adding the line are two
// separate jobs, so the second one got forgotten and the sheet drifted out of date — the
// notes knew about things the sheet did not. The texts screen has offered this for a while
// (StartWaitingLinePrompt); this is the same idea where the phrase is actually typed most:
// 42 case follow-ups and 28 case notes carry it, against 13 on the sheet itself.
//
// Asked, never assumed. Someone writing "still waiting to hear back" in a note they are
// already keeping may not want a second place to keep it, and a sheet that grew a line
// every time the words appeared would be noise. It shows while the words are there, goes
// away when dismissed, and never adds anything on its own.

// The same phrase the note text highlights, so what gets offered matches what lit up.
// Deliberately narrow: "waiting" alone appears in plenty of notes that are not about
// waiting on a person ("waiting room", "worth waiting for").
const WAITING_RE = /waiting (?:to hear back|on a (?:reply|response|answer)|for (?:a|an) (?:reply|response|answer))/i;

export function mentionsWaiting(text) {
  return WAITING_RE.test(String(text || ''));
}

export default function WaitingOnNudge({ text, client, instructor, onAdded }) {
  const [state, setState] = useState('idle')    // idle | writing | saving | hidden
  const [what, setWhat] = useState('')
  const [rows, setRows] = useState([])          // lines these people already have open
  const [error, setError] = useState('')

  const people = [
    client?.id ? { kind: 'client', person_id: client.id, name: client.name } : null,
    instructor?.id ? { kind: 'instructor', person_id: instructor.id, name: instructor.name } : null,
  ].filter(Boolean)

  const on = mentionsWaiting(text)
  const key = people.map(p => `${p.kind}-${p.person_id}`).join(',')

  // What they already have open, so this offers joining before starting a duplicate — the
  // mistake the texts version had to be taught: chasing one thing across several notes
  // otherwise ends up as several lines about the same thing.
  useEffect(() => {
    if (!on || state === 'hidden' || people.length === 0) return
    let cancelled = false
    Promise.all(people.map(p => api.getWaitingSheetFor(p.kind, p.person_id).catch(() => [])))
      .then(lists => {
        if (cancelled) return
        const seen = new Set()
        const merged = []
        for (const row of lists.flat()) {
          if (seen.has(row.id)) continue
          seen.add(row.id)
          merged.push(row)
        }
        setRows(merged)
      })
    return () => { cancelled = true }
  }, [on, key, state])

  // Reappears if the words are typed again after a dismissal — a later note is a fresh
  // moment to ask, not the same one being nagged about.
  useEffect(() => { if (!on) setState('idle') }, [on])

  if (!on || state === 'hidden') return null

  async function addToExisting(row) {
    setState('saving'); setError('')
    try {
      await api.addWaitingRowNote(row.id, String(text).trim())
      setState('hidden')
      onAdded?.(row)
    } catch (e) {
      setError(e.message || 'Could not add that.')
      setState('idle')
    }
  }

  async function create() {
    const line = what.trim()
    if (!line) return
    setState('saving'); setError('')
    try {
      const row = await api.addWaitingRow({ what: line, people })
      // The note goes on as the first entry when it says more than the line itself does.
      const note = String(text).trim()
      if (row?.id && note && note !== line) await api.addWaitingRowNote(row.id, note).catch(() => {})
      setState('hidden')
      setWhat('')
      onAdded?.(row)
    } catch (e) {
      setError(e.message || 'Could not add that.')
      setState('idle')
    }
  }

  const who = people.map(p => p.name).filter(Boolean).join(' and ')
  const saving = state === 'saving'

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
      {state === 'writing' || state === 'saving' ? (
        /* Deliberately NOT a <form>. Every place this appears sits inside the note
           composer's own form, and a nested form is invalid HTML that browsers drop — so
           the Add button submitted the OUTER form and reloaded the page instead of adding
           the line. Caught by opening the screen; the build was perfectly happy. */
        <div className="space-y-1.5">
          <label className="block text-[11px] font-medium text-amber-900">
            What are we waiting on{who ? ` ${who}` : ''} for?
          </label>
          <input
            value={what}
            onChange={e => setWhat(e.target.value)}
            autoFocus
            placeholder="e.g. confirmation for Thursday"
            onKeyDown={e => {
              // Enter still adds it, since that is what the box invites — but it must not
              // reach the note form underneath and submit that instead.
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); create() }
            }}
            className="w-full rounded-lg border border-amber-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={create} disabled={saving || !what.trim()}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:bg-amber-700">
              {saving ? 'Adding…' : 'Add to Waiting On'}
            </button>
            <button type="button" onClick={() => setState('idle')}
              className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs text-amber-800">Cancel</button>
            {people.length === 0 && (
              <span className="text-[11px] text-amber-700">Nobody attached — add them on the sheet after.</span>
            )}
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-amber-900">
              Sounds like something to keep track of{who ? ` with ${who}` : ''}.
            </span>
            <button type="button" onClick={() => setState('hidden')}
              className="ml-auto text-xs text-amber-500 hover:text-amber-800">No thanks</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {/* Joining what is already open comes first: one thread of work, one line. */}
            {rows.map(row => (
              <button key={row.id} type="button" disabled={saving} onClick={() => addToExisting(row)}
                className="max-w-full truncate rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 disabled:opacity-50 hover:bg-amber-100">
                Add to “{row.what}”
              </button>
            ))}
            <button type="button" onClick={() => { setWhat(''); setState('writing') }}
              className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700">
              {rows.length ? 'New Waiting On line' : 'Add a Waiting On line'}
            </button>
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
