import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import MentionTextarea from './MentionTextarea'
import DateInput from './DateInput'
import { useHashHighlight } from '../utils/hashHighlight'

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// need_by is a plain YYYY-MM-DD (no time component), so format it without going through
// the browser's local timezone — new Date('2026-08-30') would otherwise read back as
// Aug 29 for anyone west of UTC.
function fmtNeedBy(ymd) {
  if (!ymd) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function NoteThread({ itemId, mentionableUsers }) {
  const [notes, setNotes] = useState(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.getWaitingOnNotes(itemId).then(setNotes) }, [itemId])
  useHashHighlight([notes])

  async function handleAdd(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSaving(true)
    try {
      const note = await api.addWaitingOnNote(itemId, text.trim())
      setNotes(n => [...(n || []), note])
      setText('')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(noteId) {
    if (!confirm('Delete this note?')) return
    await api.deleteWaitingOnNote(itemId, noteId)
    setNotes(n => n.filter(x => x.id !== noteId))
  }

  return (
    <div className="mt-2 pl-3 border-l-2 border-gray-100 space-y-2">
      {notes === null ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No follow-ups logged yet.</p>
      ) : (
        notes.map(n => (
          <div key={n.id} id={`note-waiting_on_notes-${n.id}`} className="group flex gap-2 items-start">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-gray-400">
                {fmtDate(n.created_at)}{n.author_initials ? ` — ${n.author_initials}` : ''}
              </p>
              <p className="text-xs text-gray-700 whitespace-pre-wrap">{n.text}</p>
            </div>
            <button onClick={() => handleDelete(n.id)}
              className="text-gray-200 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              ✕
            </button>
          </div>
        ))
      )}
      <form onSubmit={handleAdd} className="flex gap-2 items-start">
        <MentionTextarea value={text} onChange={setText} users={mentionableUsers} rows={1}
          placeholder="Log a follow-up… type @ to tag someone"
          className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-gray-300" />
        <button type="submit" disabled={saving || !text.trim()}
          className="px-2 py-1 bg-gray-900 text-white text-[11px] rounded-lg disabled:opacity-40 hover:bg-gray-700">
          Add
        </button>
      </form>
    </div>
  )
}

function Item({ item, mentionableUsers, onResolve, onReopen, onDelete, onSetNeedBy, showLink, autoOpen }) {
  const [open, setOpen] = useState(!!autoOpen)
  const [editingDate, setEditingDate] = useState(false)
  const resolved = item.status === 'resolved'
  const linkedName = item.client_name || item.instructor_name
  const linkTo = item.client_id ? `/clients/${item.client_id}` : item.instructor_id ? `/instructors/${item.instructor_id}` : null
  const isOverdue = item.need_by && !resolved && item.need_by < new Date().toISOString().slice(0, 10)

  async function saveDate(v) {
    setEditingDate(false)
    if (v !== item.need_by) await onSetNeedBy(item.id, v || null)
  }

  return (
    <div className={`bg-white border rounded-xl px-4 py-3 ${resolved ? 'border-gray-100 opacity-70' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {showLink && linkTo ? <Link to={linkTo} className="hover:underline">{item.name}</Link> : item.name}
            {linkedName && linkedName.trim() !== item.name.trim() && <span className="text-gray-400 font-normal"> ({linkedName.trim()})</span>}
            {item.synthetic && (
              <span className="ml-2 text-[10px] font-semibold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full align-middle">
                Contract
              </span>
            )}
            {resolved && (
              <span className="ml-2 text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full align-middle">
                Resolved
              </span>
            )}
          </p>
          <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">{item.what}</p>
          <p className="text-[10px] text-gray-400 mt-1">
            {resolved
              ? `Resolved ${fmtDate(item.resolved_at)}${item.resolved_by ? ` — ${item.resolved_by}` : ''}`
              : `${fmtDate(item.created_at)}${item.created_by ? ` — ${item.created_by}` : ''}`}
          </p>
          {!item.synthetic && (
            editingDate ? (
              <div className="mt-1.5 max-w-[180px]" onClick={e => e.stopPropagation()}>
                <DateInput value={item.need_by || ''} onChange={saveDate} />
                <button type="button" onClick={() => setEditingDate(false)} className="text-[10px] text-gray-400 hover:underline mt-1">
                  Cancel
                </button>
              </div>
            ) : item.need_by ? (
              <button type="button" onClick={() => setEditingDate(true)}
                className={`mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  isOverdue ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'
                }`}>
                📅 {isOverdue ? 'Overdue — ' : 'Need reply by '}{fmtNeedBy(item.need_by)}
              </button>
            ) : (
              <button type="button" onClick={() => setEditingDate(true)}
                className="mt-1.5 text-[10px] text-gray-400 hover:text-gray-600 hover:underline">
                + Need-by date
              </button>
            )
          )}
        </div>
        {item.synthetic ? (
          linkTo && (
            <Link to={linkTo} className="text-xs font-medium text-blue-600 hover:underline flex-shrink-0">
              View →
            </Link>
          )
        ) : (
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <button onClick={() => resolved ? onReopen(item.id) : onResolve(item.id)}
              className={`text-xs font-medium rounded-lg px-2 py-1 ${resolved ? 'text-gray-500 hover:bg-gray-50' : 'text-green-700 hover:bg-green-50'}`}>
              {resolved ? 'Reopen' : 'Mark Resolved'}
            </button>
            <button onClick={() => onDelete(item.id)} className="text-[11px] text-gray-300 hover:text-red-500">Delete</button>
          </div>
        )}
      </div>
      {!item.synthetic && (
        <>
          <button onClick={() => setOpen(o => !o)} className="text-[11px] text-blue-600 hover:underline mt-2">
            {open ? 'Hide follow-ups' : `Follow-ups${item.note_count ? ` (${item.note_count})` : ''}`}
          </button>
          {open && <NoteThread itemId={item.id} mentionableUsers={mentionableUsers} />}
        </>
      )}
    </div>
  )
}

// kind: 'client' | 'instructor'
// linkedId + linkedName: profile-page mode — scoped to one client/instructor, name locked
// people: list mode (Clients/Instructors sub-tab) — [{id, name}] for the picker
export default function WaitingOnSection({ kind, linkedId, linkedName, people = [], mentionableUsers = [], showLink = false }) {
  const [searchParams] = useSearchParams()
  // Kept as a string — ids come back from Postgres as bigint strings, so comparing
  // against a Number() would silently never match.
  const targetItemId = searchParams.get('waiting') || null
  const [data, setData] = useState({ open: [], resolved: [] })
  const [loading, setLoading] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: linkedName || '', what: '', need_by: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function load() {
    const params = { kind }
    if (linkedId) params[kind === 'client' ? 'client_id' : 'instructor_id'] = linkedId
    api.getWaitingOn(params).then(d => {
      setData(d)
      // A mention notification links here with "?waiting=<id>" — if that item only
      // shows up under resolved ones, reveal that section so it's actually on screen.
      if (targetItemId && d.resolved.some(i => String(i.id) === targetItemId)) setShowResolved(true)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [kind, linkedId])
  useEffect(() => { setForm(f => ({ ...f, name: linkedName || '' })) }, [linkedName])

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.what.trim()) return
    setSaving(true)
    setError('')
    try {
      const match = linkedId ? null : people.find(p => p.name.trim().toLowerCase() === form.name.trim().toLowerCase())
      const body = {
        kind, what: form.what.trim(), need_by: form.need_by || null,
        name: linkedId ? linkedName : (form.name.trim() || match?.name),
        client_id: linkedId && kind === 'client' ? linkedId : (kind === 'client' ? match?.id : null),
        instructor_id: linkedId && kind === 'instructor' ? linkedId : (kind === 'instructor' ? match?.id : null),
      }
      if (!body.name) { setError('Name required'); setSaving(false); return }
      const item = await api.createWaitingOn(body)
      setData(d => ({ ...d, open: [item, ...d.open] }))
      setForm({ name: linkedName || '', what: '', need_by: '' })
      setAdding(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleResolve(id) {
    const item = await api.resolveWaitingOn(id)
    setData(d => ({ open: d.open.filter(x => x.id !== id), resolved: [item, ...d.resolved] }))
  }
  async function handleReopen(id) {
    const item = await api.reopenWaitingOn(id)
    setData(d => ({ resolved: d.resolved.filter(x => x.id !== id), open: [item, ...d.open] }))
  }
  async function handleDelete(id) {
    if (!confirm('Delete this item? This removes its follow-up notes too.')) return
    await api.deleteWaitingOn(id)
    setData(d => ({ open: d.open.filter(x => x.id !== id), resolved: d.resolved.filter(x => x.id !== id) }))
  }
  async function handleSetNeedBy(id, need_by) {
    const current = [...data.open, ...data.resolved].find(x => x.id === id)
    if (!current) return
    const updated = await api.updateWaitingOn(id, {
      name: current.name, what: current.what,
      client_id: current.client_id, instructor_id: current.instructor_id,
      need_by,
    })
    setData(d => ({
      open: d.open.map(x => x.id === id ? updated : x),
      resolved: d.resolved.map(x => x.id === id ? updated : x),
    }))
  }

  const total = data.open.length + data.resolved.length
  if (loading) return <p className="text-gray-400 text-sm text-center py-4">Loading…</p>
  if (linkedId && total === 0 && !adding) return null

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-purple-400">
          Waiting to Hear Back From
          {data.open.length > 0 && (
            <span className="ml-2 text-xs font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">
              {data.open.length}
            </span>
          )}
        </h2>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700">
            + Add
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-xl p-4 mb-3 space-y-2">
          {!linkedId && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {kind === 'client' ? 'Client' : 'Instructor'} name
              </label>
              <input list="waiting-on-people" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={`Pick an existing ${kind}, or type a name`}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              <datalist id="waiting-on-people">
                {people.map(p => <option key={p.id} value={p.name} />)}
              </datalist>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">What are we waiting on?</label>
            <textarea value={form.what} onChange={e => setForm(f => ({ ...f, what: e.target.value }))}
              rows={2} placeholder="e.g. waiver signature, callback about class times…"
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Need to hear back by (optional)</label>
            <DateInput value={form.need_by} onChange={v => setForm(f => ({ ...f, need_by: v }))} />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => { setAdding(false); setError('') }}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
              Cancel
            </button>
          </div>
        </form>
      )}

      {data.open.length === 0 ? (
        !adding && <p className="text-sm text-gray-400 italic">Nothing open.</p>
      ) : (
        <div className="space-y-2">
          {data.open.map(item => (
            <Item key={item.id} item={item} mentionableUsers={mentionableUsers}
              onResolve={handleResolve} onReopen={handleReopen} onDelete={handleDelete} onSetNeedBy={handleSetNeedBy} showLink={showLink}
              autoOpen={String(item.id) === targetItemId} />
          ))}
        </div>
      )}

      {data.resolved.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowResolved(v => !v)} className="text-xs text-gray-500 hover:underline">
            {showResolved ? 'Hide' : 'Show'} resolved ({data.resolved.length})
          </button>
          {showResolved && (
            <div className="space-y-2 mt-2">
              {data.resolved.map(item => (
                <Item key={item.id} item={item} mentionableUsers={mentionableUsers}
                  onResolve={handleResolve} onReopen={handleReopen} onDelete={handleDelete} onSetNeedBy={handleSetNeedBy} showLink={showLink}
                  autoOpen={String(item.id) === targetItemId} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
