import { useEffect, useState } from 'react'
import { api } from '../api/client'

// Notes + checkable to-do tasks on a class. `kind` is 'schedule' (recurring class) or
// 'session' (a single dated class). Self-contained: loads its own list on mount.
export default function ClassNotes({ kind, id, onCountChange }) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [isTask, setIsTask] = useState(false)
  const [saving, setSaving] = useState(false)

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

  return (
    <div className="bg-gray-50 border-t border-gray-100 px-4 py-3 space-y-2">
      {loading ? (
        <p className="text-xs text-gray-400">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No notes or tasks yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {notes.map(n => (
            <li key={n.id} className="flex items-start gap-2 group">
              {n.is_task ? (
                <button onClick={() => toggle(n)} title={n.is_done ? 'Mark not done' : 'Mark done'}
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center text-[10px] leading-none
                    ${n.is_done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 bg-white text-transparent hover:border-gray-400'}`}>
                  ✓
                </button>
              ) : (
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
              )}
              <span className={`flex-1 text-xs leading-snug ${n.is_done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                {n.text}
                {n.author ? <span className="text-gray-300"> · {n.author}</span> : null}
              </span>
              <button onClick={() => remove(n)}
                className="text-gray-300 hover:text-red-500 text-sm leading-none opacity-0 group-hover:opacity-100">×</button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex items-center gap-2 pt-1">
        <input value={text} onChange={e => setText(e.target.value)}
          placeholder={isTask ? 'New task…' : 'New note…'}
          className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1 text-xs bg-white" />
        <label className="flex items-center gap-1 text-[11px] text-gray-500 select-none cursor-pointer">
          <input type="checkbox" checked={isTask} onChange={e => setIsTask(e.target.checked)} className="accent-gray-700" />
          task
        </label>
        <button type="submit" disabled={saving || !text.trim()}
          className="px-2.5 py-1 bg-gray-900 text-white text-[11px] font-medium rounded-lg disabled:opacity-40">
          Add
        </button>
      </form>
    </div>
  )
}
