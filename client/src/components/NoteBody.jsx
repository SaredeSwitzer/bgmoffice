import { useState } from 'react'
import MentionTextarea from './MentionTextarea'
import { renderWithMentions } from '../utils/mentions'

// One note's text, editable in place.
//
// Every note thread in the app uses this, so "fix the typo" works the same way wherever
// you are: hover the note, click the pencil, Ctrl+Enter or Save to keep it, Esc to back
// out. A note that's been changed says "edited" — the log stays honest without hiding
// that somebody went back and reworded it.
//
// Pass `onSave` to make a note editable and leave it off for the ones that shouldn't be.
// The pencil only shows on hover, and only if the surrounding row has Tailwind's `group`.
export default function NoteBody({
  text, onSave, users = [], editedAt, context,
  className = 'text-sm text-gray-800 whitespace-pre-wrap',
  mentions = true, rows = 2, editLabel = '✏︎',
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(text)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  function start() { setDraft(text); setError(''); setEditing(true) }
  function stop()  { setDraft(text); setError(''); setEditing(false) }

  async function save() {
    const t = draft.trim()
    if (!t) return
    if (t === text) return stop()
    setSaving(true)
    try {
      await onSave(t)
      setEditing(false)
    } catch (e) {
      setError(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    const keys = e => {
      if (e.key === 'Escape') stop()
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
    }
    return (
      <div className="space-y-1">
        {mentions ? (
          <MentionTextarea value={draft} onChange={setDraft} users={users} rows={rows} autoFocus
            onKeyDown={keys}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
        ) : (
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={rows} autoFocus
            onKeyDown={keys}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={save} disabled={saving || !draft.trim()}
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={stop} className="text-[11px] text-gray-400 hover:text-gray-700">
            Cancel
          </button>
          {error && <span className="text-[11px] text-red-500">{error}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      {mentions ? renderWithMentions(text, users, context) : text}
      {editedAt && <span className="text-[10px] text-gray-400 italic ml-1 font-normal">· edited</span>}
      {onSave && (
        <button type="button" onClick={start} title="Edit this note"
          className="ml-1.5 align-baseline text-[10px] text-gray-300 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
          {editLabel}
        </button>
      )}
    </div>
  )
}
