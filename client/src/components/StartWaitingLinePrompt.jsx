import { useEffect, useState } from 'react'
import { api } from '../api/client'
import SearchSelect from './SearchSelect'

// After texting someone who isn't on the Waiting On sheet: "want a line for this?"
//
// Asked, never assumed. Most texts are not something we're waiting on — a confirmation, a
// thank-you, an answer — and a sheet that grew a line every time somebody was messaged
// would be noise within a week. So this appears only when the person is known, only when
// they have no open line already, and it goes away the moment it's dismissed.
//
// A line is one thread of work, and most threads have two people in them: "Aneya covering
// Etty's Thursday" belongs on one line with the instructor and the client both on it. The
// message usually names the other one — so it's read out of the conversation and offered
// with the name showing, changeable, and droppable. Never attached silently: a wrong name
// added by itself is worse than no name, because nobody would think to check it.
//
// THE THIRD INSTRUCTOR. Chasing cover means texting one instructor after another about the
// same class, and the first version asked only "does the person I just texted have a line?"
// — which they never do, so it offered a new line every time. Chaya Retek ended up with one
// line for Hannah and Rachel and a second for Shadea, about the same Thursday. So the
// client is checked too: if the one this message is about already has a line open, joining
// it is the first thing offered. Starting a fresh line is still there, one click away, for
// when it really is a new thread.
export default function StartWaitingLinePrompt({ person, phone, lastSent, onOpened }) {
  const [state, setState] = useState('checking')   // checking | join | offer | writing | hidden
  const [what, setWhat] = useState('')
  const [saving, setSaving] = useState(false)

  // The other half of the line: suggested from the text, then whatever she chooses.
  const otherKind = person?.kind === 'client' ? 'instructor' : 'client'
  const [others, setOthers] = useState([])         // the pickable list, loaded on demand
  const [other, setOther] = useState(null)
  const [about, setAbout] = useState(null)         // who the message named, for the label
  const [aboutRows, setAboutRows] = useState([])   // lines they already have open

  const key = person ? `${person.kind}-${person.id}` : null

  useEffect(() => {
    if (!person?.id || !person?.kind) { setState('hidden'); return }
    let cancelled = false
    setState('checking')
    setAbout(null); setAboutRows([]); setOther(null)

    ;(async () => {
      // Already on the sheet themselves? Then there's nothing to offer.
      let mine = []
      try { mine = await api.getWaitingSheetFor(person.kind, person.id) } catch { /* offer anyway */ }
      if (cancelled) return
      if (mine.length) { setState('hidden'); return }

      // Read the conversation before showing anything, not after. The earlier version put
      // this off until she opened the form, to save a lookup on an offer she might wave
      // away — but what the offer should SAY depends on the answer, so it has to come first.
      let named = null
      if (phone) {
        try {
          const found = await api.smsThreadAbout(phone, person.kind)
          named = found?.[0] || null
        } catch { /* no suggestion, carry on */ }
      }
      if (cancelled) return
      setAbout(named)
      setOther(named)

      let openLines = []
      if (named?.id) {
        try { openLines = await api.getWaitingSheetFor(otherKind, named.id) } catch { /* carry on */ }
      }
      if (cancelled) return
      setAboutRows(openLines)
      setState(openLines.length ? 'join' : 'offer')
    })()

    return () => { cancelled = true }
    // Re-checked per person and per message sent: texting them again is a fresh moment to
    // ask, and they may have been added to the sheet in between.
  }, [key, lastSent])

  // The full pickable list is only worth fetching once she's actually writing a line.
  useEffect(() => {
    if (state !== 'writing') return
    let cancelled = false
    const load = otherKind === 'client' ? api.getClients() : api.getInstructors()
    load.then(rows => { if (!cancelled) setOthers(rows.map(r => ({ id: r.id, name: r.name }))) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [state])

  // Joining an existing line: the person texted goes on it, and a note says why they
  // appeared there. A name that turns up on a line with no explanation is a small mystery
  // for whoever reads it next.
  async function join(row) {
    setSaving(true)
    try {
      await api.addWaitingRowPerson(row.id, {
        kind: person.kind, person_id: person.id, name: person.name,
      })
      await api.addWaitingRowNote(row.id, `Texted ${person.name}.`)
      setState('hidden')
      onOpened?.()
    } finally {
      setSaving(false)
    }
  }

  async function create() {
    const text = what.trim()
    if (!text) return
    setSaving(true)
    try {
      // The person texted goes on first — they're the one the hourglass starts on.
      const people = [{ kind: person.kind, person_id: person.id, name: person.name }]
      if (other?.id) people.push({ kind: otherKind, person_id: other.id, name: other.name })
      await api.addWaitingRow({ what: text, people })
      setState('hidden')
      setWhat(''); setOther(null); setAbout(null)
      onOpened?.()
    } finally {
      setSaving(false)
    }
  }

  if (state === 'checking' || state === 'hidden') return null

  return (
    <div className="mx-3 mb-2 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2">
      {state === 'join' ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-blue-900">
              <span className="font-semibold">{about.name}</span> already has
              {aboutRows.length > 1 ? ' lines' : ' a line'} open — put {person.name} on
              {aboutRows.length > 1 ? ' one?' : ' it?'}
            </span>
            <button type="button" onClick={() => setState('hidden')}
              className="ml-auto text-xs text-blue-400 hover:text-blue-700">No thanks</button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {aboutRows.map(row => (
              <button key={row.id} type="button" disabled={saving} onClick={() => join(row)}
                className="max-w-full truncate rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:bg-blue-700">
                {saving ? 'Adding…' : `Add to “${row.what}”`}
              </button>
            ))}
          </div>

          <button type="button" onClick={() => setState('writing')}
            className="text-xs font-semibold text-blue-700 hover:underline">
            Start a new line instead
          </button>
        </div>
      ) : state === 'offer' ? (
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
        <form onSubmit={e => { e.preventDefault(); create() }} className="space-y-2">
          <input
            value={what}
            onChange={e => setWhat(e.target.value)}
            autoFocus
            placeholder={`What are we waiting on ${person.name} for?`}
            className="w-full rounded-lg border border-blue-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />

          <div>
            <label className="block text-[11px] font-medium text-blue-900 mb-1">
              {otherKind === 'client' ? 'Which client is this about?' : 'Which instructor is this about?'}
              {about && other && about.id === other.id && (
                <span className="ml-1 font-normal text-blue-500">— from the message, change it if it&rsquo;s wrong</span>
              )}
            </label>
            <SearchSelect
              options={others}
              value={other}
              onChange={setOther}
              placeholder={otherKind === 'client' ? 'Search clients… (optional)' : 'Search instructors… (optional)'}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving || !what.trim()}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:bg-blue-700">
              {saving ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => { setState('hidden'); setWhat(''); setOther(null) }}
              className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs text-blue-700">Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
