import { useEffect, useState } from 'react'
import { api } from '../api/client'
import SearchSelect from './SearchSelect'
import { loadDirectory, findPeopleInText } from '../utils/directory'

// "waiting to hear back" typed into a note — offer to put it on the Waiting On sheet.
//
// The phrase was already highlighted wherever it appeared, which told you the app had
// noticed and then did nothing with it. Writing the note and adding the line were two
// separate jobs, so the second got forgotten and the sheet drifted out of date.
//
// WHO THE LINE IS ABOUT IS NOT WHOSE SCREEN YOU ARE ON. The first version attached
// whatever the page knew — a note on Chavy Strasser's recruiting entry made a line about
// Chavy. But the note said "asked Whitney and waiting to hear back": the line belongs to
// both of them, and the hourglass belongs on WHITNEY, because she is the one who owes us
// an answer. Only the sentence knows that, so the sentence is read.
//
// And then it is shown, not assumed. A name picked out of prose is a guess; the guess is
// offered with everyone listed, who is on the line tickable, and who we are waiting on
// changeable — plus a picker for anyone it missed. Nothing is saved until Add is pressed.

// The same phrase the note text highlights, so what gets offered matches what lit up.
// Deliberately narrow: "waiting" alone appears in plenty of notes that are not about
// waiting on a person ("waiting room", "worth waiting for").
const WAITING_RE = /waiting (?:to hear back|on a (?:reply|response|answer)|for (?:a|an) (?:reply|response|answer))/i;

export function mentionsWaiting(text) {
  return WAITING_RE.test(String(text || ''));
}


// A first draft of the line, taken from the note.
//
// It used to open empty, and an empty box leaves Add greyed out — so somebody who filled
// in the people, pressed Add and got nothing had done everything right. The note is
// already a description of what we are waiting for, so it starts there and can be edited.
// The "waiting to hear back" part is dropped: it is the reason the prompt appeared, not
// the thing we are waiting for.
function lineFromNote(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim()
  // Only when the phrase is hanging off one end. Cutting it out of the middle turns
  // "called Serina, waiting to hear back on the rate" into "called Serina, on the rate",
  // which is worse than leaving it in.
  t = t.replace(new RegExp(`^${WAITING_RE.source}\\b[\\s:,-]*`, 'i'), '')
  t = t.replace(new RegExp(`[\\s:,-]*\\b${WAITING_RE.source}\\s*$`, 'i'), '')
  // A note that is nothing but the phrase leaves nothing behind; keep the original rather
  // than handing back an empty box.
  return (t.trim() || String(text || '').replace(/\s+/g, ' ').trim()).slice(0, 120)
}

const keyOf = p => `${p.kind}-${p.id}`

export default function WaitingOnNudge({ text, client, instructor, onAdded }) {
  const [state, setState] = useState('idle')    // idle | writing | saving | hidden
  const [what, setWhat] = useState('')
  const [rows, setRows] = useState([])          // lines these people already have open
  const [people, setPeople] = useState([])      // [{ id, kind, name, on, waiting, from }]
  const [picking, setPicking] = useState(null)  // 'client' | 'instructor' | null
  const [options, setOptions] = useState([])
  const [error, setError] = useState('')

  const on = mentionsWaiting(text)

  // Whoever the page already knows about — the client whose profile this is, the
  // instructor on the class. They go on the line, but not necessarily with the hourglass.
  const fromPage = [
    client?.id ? { id: client.id, kind: 'client', name: client.name } : null,
    instructor?.id ? { id: instructor.id, kind: 'instructor', name: instructor.name } : null,
  ].filter(Boolean)
  const pageKey = fromPage.map(keyOf).join(',')

  useEffect(() => { loadDirectory() }, [])

  // Re-read as she types: the name often arrives after the phrase does.
  useEffect(() => {
    if (!on || state === 'saving' || state === 'hidden') return
    const named = findPeopleInText(text, { exclude: fromPage })
    setPeople(prev => {
      const byKey = new Map(prev.map(p => [keyOf(p), p]))
      const next = []
      // Someone named in the sentence is who we are waiting on, and goes first.
      for (const p of named) {
        const had = byKey.get(keyOf(p))
        next.push(had || { id: p.id, kind: p.kind, name: p.name, on: true, waiting: true, from: 'note' })
      }
      for (const p of fromPage) {
        const had = byKey.get(keyOf(p))
        // No name in the sentence means the page's own person is the one we are waiting on.
        next.push(had || { ...p, on: true, waiting: named.length === 0, from: 'page' })
      }
      // Anyone she added by hand stays put.
      for (const p of prev) if (p.from === 'picked' && !next.some(n => keyOf(n) === keyOf(p))) next.push(p)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, text, pageKey])

  // What these people already have open, so joining comes before starting a duplicate.
  useEffect(() => {
    if (!on || state === 'hidden') return
    const ids = people.filter(p => p.on)
    if (ids.length === 0) { setRows([]); return }
    let cancelled = false
    Promise.all(ids.map(p => api.getWaitingSheetFor(p.kind, p.id).catch(() => [])))
      .then(lists => {
        if (cancelled) return
        const seen = new Set()
        setRows(lists.flat().filter(r => (seen.has(r.id) ? false : seen.add(r.id))))
      })
    return () => { cancelled = true }
  }, [on, state, people.map(p => `${keyOf(p)}:${p.on}`).join(',')])

  useEffect(() => { if (!on) setState('idle') }, [on])

  // The pickable list is only worth fetching once she reaches for it.
  useEffect(() => {
    if (!picking) return
    let cancelled = false
    const load = picking === 'client' ? api.getClients() : api.getInstructors()
    load.then(rs => { if (!cancelled) setOptions(rs.map(r => ({ id: r.id, name: r.name }))) }).catch(() => {})
    return () => { cancelled = true }
  }, [picking])

  if (!on || state === 'hidden') return null

  const chosen = people.filter(p => p.on)
  const saving = state === 'saving'

  function toggleOn(p) {
    setPeople(prev => prev.map(x => (keyOf(x) === keyOf(p) ? { ...x, on: !x.on } : x)))
  }
  // Several people can carry the hourglass at once, which is how the sheet itself works —
  // five open lines already have more than one flagged, because chasing cover means waiting
  // on two instructors about the same class. The first version made these mutually
  // exclusive, so flagging a second cleared the first.
  function toggleWaiting(p) {
    setPeople(prev => prev.map(x => (keyOf(x) === keyOf(p) ? { ...x, waiting: !x.waiting } : x)))
  }
  function addPicked(kind, v) {
    setPicking(null)
    if (!v?.id) return
    const entry = { id: v.id, kind, name: v.name, on: true, waiting: false, from: 'picked' }
    setPeople(prev => (prev.some(x => keyOf(x) === keyOf(entry)) ? prev : [...prev, entry]))
  }

  async function addToExisting(row) {
    setState('saving'); setError('')
    try {
      await api.addWaitingRowNote(row.id, String(text).trim())
      setState('hidden')
      onAdded?.(row)
    } catch (e) {
      setError(e.message || 'Could not add that.'); setState('idle')
    }
  }

  async function create() {
    const line = what.trim()
    if (!line) return
    setState('saving'); setError('')
    try {
      const row = await api.addWaitingRow({
        what: line,
        people: chosen.map(p => ({ kind: p.kind, person_id: p.id, name: p.name, waiting: !!p.waiting })),
      })
      const note = String(text).trim()
      if (row?.id && note && note !== line) await api.addWaitingRowNote(row.id, note).catch(() => {})
      setState('hidden'); setWhat('')
      onAdded?.(row)
    } catch (e) {
      setError(e.message || 'Could not add that.'); setState('idle')
    }
  }

  // Names the people we are actually waiting on; falls back to everyone on the line.
  const flagged = chosen.filter(p => p.waiting)
  const summary = (flagged.length ? flagged : chosen).map(p => p.name).join(' and ')

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
      {state === 'writing' || saving ? (
        /* Deliberately NOT a <form>. Every place this appears sits inside the note
           composer's own form, and a nested form is invalid HTML that browsers drop — so
           Add submitted the OUTER form and reloaded the page instead of adding the line. */
        <div className="space-y-2">
          <div>
            <label className="block text-[11px] font-medium text-amber-900 mb-1">
              What are we waiting for?
            </label>
            <input
              value={what}
              onChange={e => setWhat(e.target.value)}
              autoFocus
              placeholder="e.g. whether she can teach Thursday"
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); create() }
              }}
              className="w-full rounded-lg border border-amber-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <p className="text-[11px] font-medium text-amber-900 mb-1">
              Who&rsquo;s on this line, and who are we waiting on?
            </p>
            <div className="space-y-1">
              {people.map(p => (
                <div key={keyOf(p)} className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={p.on} onChange={() => toggleOn(p)} className="rounded" />
                    <span className={p.on ? 'text-gray-800' : 'text-gray-400 line-through'}>{p.name}</span>
                  </label>
                  <span className="text-[10px] uppercase tracking-wide text-amber-600">{p.kind}</span>
                  {p.from === 'note' && <span className="text-[10px] text-amber-600">named in your note</span>}
                  {p.on && (
                    <button type="button" onClick={() => toggleWaiting(p)}
                      title="We're waiting on this person"
                      className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        p.waiting
                          ? 'bg-amber-500 text-white'
                          : 'border border-amber-300 text-amber-700 hover:bg-amber-100'}`}>
                      {p.waiting ? '⏳ waiting on them' : 'waiting on them?'}
                    </button>
                  )}
                </div>
              ))}
              {people.length === 0 && (
                <p className="text-[11px] text-amber-700">Nobody attached yet — add one below, or leave it blank.</p>
              )}
            </div>

            {picking ? (
              <div className="mt-1.5">
                <SearchSelect
                  options={options}
                  value={null}
                  onChange={v => v && addPicked(picking, v)}
                  placeholder={picking === 'client' ? 'Search clients…' : 'Search instructors…'}
                />
                <button type="button" onClick={() => setPicking(null)}
                  className="mt-1 text-[11px] text-amber-600 hover:underline">Cancel</button>
              </div>
            ) : (
              <div className="mt-1.5 flex gap-2">
                <button type="button" onClick={() => setPicking('client')}
                  className="text-[11px] font-medium text-amber-700 hover:underline">+ a client</button>
                <button type="button" onClick={() => setPicking('instructor')}
                  className="text-[11px] font-medium text-amber-700 hover:underline">+ an instructor</button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={create} disabled={saving || !what.trim()}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:bg-amber-700">
              {saving ? 'Adding…' : 'Add to Waiting On'}
            </button>
            <button type="button" onClick={() => setState('idle')}
              className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs text-amber-800">Cancel</button>
            {!what.trim() && (
              <span className="text-[11px] text-amber-700">Say what you&rsquo;re waiting for first.</span>
            )}
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-amber-900">
              Sounds like something to keep track of{summary ? ` with ${summary}` : ''}.
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
            <button type="button" onClick={() => { setWhat(lineFromNote(text)); setState('writing') }}
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
