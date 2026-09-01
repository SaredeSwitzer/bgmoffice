import { useEffect, useState } from 'react'
import { api } from '../api/client'
import SearchSelect from './SearchSelect'

// The working sheet an admin keeps through a shift.
//
// A row is one thread of work, not one person: "getting Sharon to teach Etty's group" is a
// single row with Sharon on the instructor side and Etty on the client side. Click whichever
// name currently owes us a reply and the row shows the ball is with them. Click them again
// when they've come back to us.
//
// A row works just as well with only an instructor, only a client, or several of either —
// one instructor being lined up for three clients is three names on one side.

function PersonChip({ person, isWaiting, onClick, onRemove, readOnly }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-0.5 text-xs transition-colors ${
        isWaiting
          ? 'bg-amber-100 border-amber-400 text-amber-900 font-semibold'
          : 'bg-white border-gray-200 text-gray-600 hover:border-amber-300'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={readOnly}
        title={isWaiting ? 'They came back to us — clear the flag' : "We're waiting on them"}
        className="disabled:cursor-default"
      >
        {isWaiting && <span className="mr-1">⏳</span>}
        {person.name}
      </button>
      {!readOnly && (
        <button type="button" onClick={onRemove} title="Take off this row"
          className="text-gray-300 hover:text-red-500 px-0.5 leading-none">✕</button>
      )}
    </span>
  )
}

function AddPerson({ kind, options, onAdd }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="text-[11px] text-gray-400 hover:text-gray-700 border border-dashed border-gray-300 rounded-full px-2 py-0.5">
        + {kind === 'instructor' ? 'instructor' : 'client'}
      </button>
    )
  }
  return (
    <div className="w-full max-w-[240px]">
      <SearchSelect
        options={options}
        value={null}
        onChange={v => {
          if (v) onAdd({ kind, person_id: v.id, name: v.name })
          setOpen(false)
        }}
        placeholder={`Search ${kind}…`}
      />
      <button type="button" onClick={() => setOpen(false)}
        className="text-[10px] text-gray-400 hover:underline mt-0.5">cancel</button>
    </div>
  )
}

function fmtWhen(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function Row({ row, clients, instructors, onChanged, readOnly }) {
  const [busy, setBusy] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [noteText, setNoteText] = useState('')
  const notes = row.notes || []
  const instructorsOn = (row.people || []).filter(p => p.kind === 'instructor')
  const clientsOn     = (row.people || []).filter(p => p.kind === 'client')

  async function act(fn) {
    setBusy(true)
    try { await fn() } finally { setBusy(false); onChanged() }
  }

  // Postgres bigints come back from node-pg as strings, while the ids inside the people
  // JSON are numbers — comparing them directly is always false, which meant the flag never
  // showed and clicking a name could only ever set it, never clear it.
  const isWaitingOn = p => String(row.waiting_on_id ?? '') === String(p.id)
  const toggleWaiting = p => act(() =>
    api.setWaitingOnPerson(row.id, isWaitingOn(p) ? null : p.id))

  return (
    <tr className={row.urgent ? 'bg-red-50/60' : ''}>
      <td className="align-top px-3 py-2.5 w-8">
        {!readOnly && (
          <button
            type="button"
            onClick={() => act(() => api.setWaitingRowUrgent(row.id, !row.urgent))}
            title={row.urgent ? 'Not urgent' : 'Mark urgent'}
            className={`text-base leading-none ${row.urgent ? 'text-red-500' : 'text-gray-200 hover:text-red-300'}`}
          >★</button>
        )}
        {readOnly && row.urgent && <span className="text-red-500">★</span>}
      </td>

      <td className="align-top px-3 py-2.5">
        <div className="flex flex-wrap gap-1.5 items-center">
          {instructorsOn.map(p => (
            <PersonChip key={p.id} person={p} isWaiting={isWaitingOn(p)}
              onClick={() => toggleWaiting(p)} readOnly={readOnly}
              onRemove={() => act(() => api.removeWaitingRowPerson(row.id, p.id))} />
          ))}
          {!readOnly && (
            <AddPerson kind="instructor" options={instructors}
              onAdd={p => act(() => api.addWaitingRowPerson(row.id, p))} />
          )}
        </div>
      </td>

      <td className="align-top px-3 py-2.5">
        <div className="flex flex-wrap gap-1.5 items-center">
          {clientsOn.map(p => (
            <PersonChip key={p.id} person={p} isWaiting={isWaitingOn(p)}
              onClick={() => toggleWaiting(p)} readOnly={readOnly}
              onRemove={() => act(() => api.removeWaitingRowPerson(row.id, p.id))} />
          ))}
          {!readOnly && (
            <AddPerson kind="client" options={clients}
              onAdd={p => act(() => api.addWaitingRowPerson(row.id, p))} />
          )}
        </div>
      </td>

      <td className="align-top px-3 py-2.5 text-sm text-gray-700">
        {row.what}

        {/* The last note sits on the row itself — it's the bit the next person needs,
            and burying it behind a click means nobody reads it. */}
        {notes.length > 0 && !showNotes && (
          <p className="text-xs text-gray-500 mt-1">
            <span className="font-semibold text-gray-600">{notes[notes.length - 1].author}:</span>{' '}
            {notes[notes.length - 1].text}
          </p>
        )}

        {!readOnly && (
          <button type="button" onClick={() => setShowNotes(v => !v)}
            className="text-[11px] text-blue-600 hover:underline mt-1 print:hidden">
            {showNotes ? 'Hide notes' : notes.length ? `Notes (${notes.length})` : 'Add a note'}
          </button>
        )}

        {showNotes && (
          <div className="mt-2 space-y-1.5 print:hidden">
            {notes.map(n => (
              <div key={n.id} className="group flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-gray-400">
                    <span className="font-semibold text-gray-500">{n.author}</span> &middot; {fmtWhen(n.created_at)}
                  </p>
                  <p className="text-xs text-gray-700 whitespace-pre-wrap">{n.text}</p>
                </div>
                <button type="button"
                  onClick={() => act(() => api.deleteWaitingRowNote(row.id, n.id))}
                  className="opacity-0 group-hover:opacity-100 text-xs text-gray-300 hover:text-red-500 shrink-0">✕</button>
              </div>
            ))}
            <form
              onSubmit={e => {
                e.preventDefault()
                if (!noteText.trim()) return
                const text = noteText.trim()
                setNoteText('')
                act(() => api.addWaitingRowNote(row.id, text))
              }}
              className="flex gap-1.5"
            >
              <input
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Called 2pm, VM full — try her husband"
                className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button type="submit" disabled={busy || !noteText.trim()}
                className="px-2.5 py-1 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 hover:bg-blue-700">
                Add
              </button>
            </form>
          </div>
        )}
      </td>

      <td className="align-top px-2 py-2.5 w-20 text-right whitespace-nowrap print:hidden">
        {!readOnly && (
          <button type="button" disabled={busy}
            onClick={() => act(() => api.markWaitingRowDone(row.id))}
            className="text-[11px] text-green-700 hover:underline">Done</button>
        )}
      </td>
    </tr>
  )
}

export default function WaitingSheet() {
  const [rows, setRows] = useState(null)
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ what: '', instructor: null, client: null })
  const [saving, setSaving] = useState(false)

  function load() {
    api.getWaitingSheet().then(setRows).catch(() => setRows([]))
  }

  useEffect(() => {
    load()
    api.getClients().then(cs => setClients(cs.map(c => ({ id: c.id, name: c.name })))).catch(() => {})
    api.getInstructors().then(is => setInstructors(is.map(i => ({ id: i.id, name: i.name })))).catch(() => {})
  }, [])

  async function handleAdd(e) {
    e.preventDefault()
    if (!draft.what.trim()) return
    setSaving(true)
    try {
      const people = []
      if (draft.instructor) people.push({ kind: 'instructor', person_id: draft.instructor.id, name: draft.instructor.name })
      if (draft.client)     people.push({ kind: 'client',     person_id: draft.client.id,     name: draft.client.name })
      await api.addWaitingRow({ what: draft.what.trim(), people })
      setDraft({ what: '', instructor: null, client: null })
      setAdding(false)
      load()
    } finally { setSaving(false) }
  }

  if (rows === null) return null

  const waitingCount = rows.filter(r => r.waiting_on_id).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-gray-600">
          {rows.length} open
          {waitingCount > 0 && <span className="text-gray-400"> &middot; {waitingCount} waiting on someone</span>}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()}
            className="text-xs text-gray-500 hover:text-gray-800 border border-gray-300 rounded-lg px-2.5 py-1.5">
            Print
          </button>
          {!adding && (
            <button onClick={() => setAdding(true)}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700">
              + Add a line
            </button>
          )}
        </div>
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-xl p-3 space-y-2 print:hidden">
          <input
            value={draft.what}
            onChange={e => setDraft(d => ({ ...d, what: e.target.value }))}
            placeholder="What are we waiting for? e.g. confirming Tues 8pm works for both"
            autoFocus
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Instructor (optional)</label>
              <SearchSelect options={instructors} value={draft.instructor}
                onChange={v => setDraft(d => ({ ...d, instructor: v }))} placeholder="Search instructor…" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Client (optional)</label>
              <SearchSelect options={clients} value={draft.client}
                onChange={v => setDraft(d => ({ ...d, client: v }))} placeholder="Search client…" />
            </div>
          </div>
          <p className="text-[11px] text-gray-400">
            Add either, both, or neither &mdash; you can put more names on the line afterwards.
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={saving || !draft.what.trim()}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 hover:bg-blue-700">
              {saving ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => { setAdding(false); setDraft({ what: '', instructor: null, client: null }) }}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">Cancel</button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 italic px-1">
          Nothing on the sheet. Add a line whenever you&rsquo;re waiting on somebody.
        </p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-8" />
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Instructor</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">What we&rsquo;re waiting for</th>
                <th className="w-20 print:hidden" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(row => (
                <Row key={row.id} row={row} clients={clients} instructors={instructors} onChanged={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 px-1 print:hidden">
        Click a name to flag that we&rsquo;re waiting on <em>them</em> right now. Click again once
        they&rsquo;ve come back to you. There&rsquo;s one sheet and everyone sees it, so the next shift
        picks up exactly where you left off.
      </p>
    </div>
  )
}
