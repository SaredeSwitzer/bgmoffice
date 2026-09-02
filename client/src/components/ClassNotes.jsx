import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { noteTime } from '../utils/dates'
import NoteBody from './NoteBody'
import MentionTextarea from './MentionTextarea'

// Notes + checkable to-do tasks on a class. `kind` is 'schedule' (recurring class) or
// 'session' (a single dated class). Self-contained: loads its own list on mount.
export default function ClassNotes({ kind, id, onCountChange }) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [isTask, setIsTask] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mentionableUsers, setMentionableUsers] = useState([])

  useEffect(() => { api.getMentionableUsers().then(setMentionableUsers).catch(() => {}) }, [])

  // Arriving from a mention: the note is on screen (the page opened this panel for it),
  // so put the cursor in the box — replying is the reason they clicked.
  const { hash } = useLocation()
  const inputRef = useRef(null)
  useEffect(() => {
    const m = /^#note-class_notes-(\d+)$/.exec(hash || '')
    if (!m || !notes.some(n => String(n.id) === m[1])) return
    const t = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [hash, notes])

  function load() {
    setLoading(true)
    api.getClassNotes(kind, id)
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
      await api.addClassNote(kind, id, { text: t, is_task: isTask })
      setText(''); setIsTask(false); load()
    } finally { setSaving(false) }
  }

  async function toggle(note) {
    setNotes(prev => prev.map(n => n.id === note.id ? { ...n, is_done: !n.is_done } : n))
    try { await api.toggleClassNoteDone(note.id) } finally { load() }
  }

  async function remove(note) {
    setNotes(prev => prev.filter(n => n.id !== note.id))
    try { await api.deleteClassNote(note.id) } finally { load() }
  }

  async function edit(note, text) {
    const updated = await api.updateClassNote(note.id, { text })
    setNotes(prev => prev.map(n => (n.id === note.id ? updated : n)))
  }

  return (
    <div className="bg-sky-50/60 border-t border-sky-100 px-4 py-3 space-y-2">
      {/* Deliberately styled apart from AdminNotes (amber, lock icon): these two sat
          side by side looking identical, which is a bad way to find out which one the
          instructor can read. */}
      <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-700">
        👁 Class notes — the instructor can see these
      </p>
      {loading ? (
        <p className="text-xs text-gray-400">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No notes or tasks yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {notes.map(n => (
            <li key={n.id} id={`note-class_notes-${n.id}`} className="flex items-start gap-2 group">
              {n.is_task ? (
                <button onClick={() => toggle(n)} title={n.is_done ? 'Mark not done' : 'Mark done'}
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center text-[10px] leading-none
                    ${n.is_done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 bg-white text-transparent hover:border-gray-400'}`}>
                  ✓
                </button>
              ) : (
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
              )}
              <div className="flex-1 min-w-0">
                <NoteBody text={n.text} editedAt={n.edited_at} users={mentionableUsers} rows={2}
                  onSave={t => edit(n, t)}
                  className={`text-xs leading-snug ${n.is_done ? 'line-through text-gray-400' : 'text-gray-700'}`} />
                <span className="text-[10px] text-gray-300">
                  {n.author ? `${n.author}` : null}
                  {n.author && n.created_at ? ' · ' : null}
                  {n.created_at ? noteTime(n.created_at) : null}
                </span>
              </div>
              <button onClick={() => remove(n)}
                className="text-gray-300 hover:text-red-500 text-sm leading-none opacity-0 group-hover:opacity-100">×</button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex items-center gap-2 pt-1">
        <MentionTextarea ref={inputRef} value={text} onChange={setText} users={mentionableUsers} rows={1}
          placeholder={isTask ? 'New task… (@ to tag someone)' : 'New note… (@ to tag someone)'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(e) } }}
          className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1 text-xs bg-white resize-none focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <label className="flex items-center gap-1 text-[11px] text-gray-500 select-none cursor-pointer">
          <input type="checkbox" checked={isTask} onChange={e => setIsTask(e.target.checked)} className="accent-gray-700" />
          task
        </label>
        <button type="submit" disabled={saving || !text.trim()}
          className="px-2.5 py-1 bg-gray-900 text-white text-[11px] font-medium rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors">
          Add
        </button>
      </form>
    </div>
  )
}
