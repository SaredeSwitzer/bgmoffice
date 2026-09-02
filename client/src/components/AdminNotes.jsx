import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { noteTime } from '../utils/dates'
import NoteBody from './NoteBody'
import MentionTextarea from './MentionTextarea'

// Same idea as ClassNotes, but backed by admin_notes — a separate table the server only
// serves to Sarede/Claire/Maria (requireOwnerAccess). This component doesn't re-check
// who's viewing; callers gate whether to render it at all (see OWNER_EMAILS usage in
// ClassSessionModal / SchedulePage) so the section doesn't even appear for anyone else.
export default function AdminNotes({ kind, id, onCountChange }) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [mentionableUsers, setMentionableUsers] = useState([])

  useEffect(() => { api.getMentionableUsers().then(setMentionableUsers).catch(() => {}) }, [])

  function load() {
    setLoading(true)
    api.getAdminNotes(kind, id)
      .then(rows => { setNotes(rows); onCountChange?.(rows) })
      .catch(() => setNotes([]))
      .finally(() => setLoading(false))
  }
  useEffect(load, [kind, id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    setSaving(true)
    try {
      await api.addAdminNote(kind, id, { text: t })
      setText(''); load()
    } finally { setSaving(false) }
  }

  async function remove(note) {
    setNotes(prev => prev.filter(n => n.id !== note.id))
    try { await api.deleteAdminNote(note.id) } finally { load() }
  }

  async function edit(note, text) {
    const updated = await api.updateAdminNote(note.id, { text })
    setNotes(prev => prev.map(n => (n.id === note.id ? updated : n)))
  }

  return (
    <div className="bg-amber-50 border-t border-amber-100 px-4 py-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-700 flex items-center gap-1">
        🔒 Admin notes — Sarede, Claire &amp; Maria only
      </p>
      {loading ? (
        <p className="text-xs text-amber-700/60">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-amber-700/50 italic">Nothing here yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {notes.map(n => (
            <li key={n.id} id={`note-admin_notes-${n.id}`} className="flex items-start gap-2 group">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              <div className="flex-1 min-w-0">
                <NoteBody text={n.text} editedAt={n.edited_at} users={mentionableUsers} rows={2}
                  onSave={t => edit(n, t)}
                  className="text-xs leading-snug text-amber-900" />
                <span className="text-[10px] text-amber-500/70">
                  {n.author ? `${n.author}` : null}
                  {n.author && n.created_at ? ' · ' : null}
                  {n.created_at ? noteTime(n.created_at) : null}
                </span>
              </div>
              <button onClick={() => remove(n)}
                className="text-amber-300 hover:text-red-500 text-sm leading-none opacity-0 group-hover:opacity-100">×</button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex items-center gap-2 pt-1">
        <MentionTextarea value={text} onChange={setText} users={mentionableUsers} rows={1}
          placeholder="New admin note… (@ to tag someone)"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(e) } }}
          className="flex-1 border border-amber-200 rounded-lg px-2.5 py-1 text-xs bg-white resize-none" />
        <button type="submit" disabled={saving || !text.trim()}
          className="px-2.5 py-1 bg-amber-600 text-white text-[11px] font-medium rounded-lg disabled:opacity-50">
          Add
        </button>
      </form>
    </div>
  )
}
