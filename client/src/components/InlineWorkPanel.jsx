import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import MentionTextarea from './MentionTextarea'
import { renderWithMentions } from '../utils/mentions.jsx'

// Working on a task or a reminder without leaving My Tasks — the same idea as
// MentionThread, extended to the other two things on this page.
//
// Three sources land here and none of them store their notes the same way: a standalone
// task keeps replies in a JSON column, a case follow-up has its own notes table, a
// reminder has another. The differences are absorbed by the loaders below so the panel
// itself is one thing.

function fmtWhen(ts) {
  if (!ts) return ''
  const d = new Date(String(ts).includes('T') ? ts : String(ts).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// { load, send, finish } per source. `finish` is what "done" means for that thing —
// they're different verbs in different tables.
const SOURCES = {
  standalone: {
    label: 'Task',
    load: async item => {
      let replies = []
      try { replies = item.replies ? JSON.parse(item.replies) : [] } catch { replies = [] }
      return {
        body: item.description || item.notes || '',
        thread: replies.map(r => ({ id: r.id, text: r.text, author: r.author, created_at: r.created_at })),
      }
    },
    send:   (item, text) => api.addTaskReply(item.id, text),
    finish: item => api.updateTask(item.id, { ...item, status: 'done' }),
    finishLabel: 'Mark done',
  },
  recruiting: {
    label: 'Recruiting task',
    load: async item => {
      let replies = []
      try { replies = item.replies ? JSON.parse(item.replies) : [] } catch { replies = [] }
      return {
        body: item.description || item.notes || '',
        thread: replies.map(r => ({ id: r.id, text: r.text, author: r.author, created_at: r.created_at })),
      }
    },
    send:   (item, text) => api.addTaskReply(item.id, text),
    finish: item => api.updateTask(item.id, { ...item, status: 'done' }),
    finishLabel: 'Mark done',
  },
  action_item: {
    label: 'Case follow-up',
    load: async item => ({
      body: item.what || item.title || '',
      thread: await api.getActionItemNotes(item.id).catch(() => []),
    }),
    send:   (item, text) => api.addNote(item.id, { text }),
    finish: item => api.setActionItemStatus(item.id, 'done'),
    finishLabel: 'Mark done',
  },
  reminder: {
    label: 'Reminder',
    load: async item => ({
      body: item.notes || item.title || '',
      thread: (await api.getReminderNotes(item.id).catch(() => []))
        .map(n => ({ id: n.id, text: n.text, author: n.author_initials, created_at: n.created_at })),
    }),
    send:   (item, text) => api.addReminderNote(item.id, text),
    finish: item => api.markReminderDone(item.id),
    finishLabel: 'Mark done',
  },
}

export default function InlineWorkPanel({ item, mentionableUsers = [], openPath, onFinish, onClose }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const source = SOURCES[item.source] || SOURCES.standalone

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [text,    setText]    = useState('')
  const [sending, setSending] = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    source.load(item)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not open this one.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.source, item.id])

  async function handleSend(e) {
    e?.preventDefault()
    if (!text.trim()) return
    setSending(true)
    setError('')
    try {
      await source.send(item, text.trim())
      const now = new Date().toISOString()
      setData(d => ({
        ...d,
        thread: [...(d?.thread || []), { id: `local-${now}`, text: text.trim(), author: user?.initials, created_at: now }],
      }))
      setText('')
    } catch (err) {
      setError(err.message || 'That did not save.')
    } finally { setSending(false) }
  }

  async function handleFinish() {
    setSending(true)
    setError('')
    try {
      await source.finish(item)
      onFinish(item)
    } catch (err) {
      setError(err.message || 'Could not mark that done.')
      setSending(false)
    }
  }

  const thread = data?.thread || []

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600">{source.label}</p>
          <p className="text-sm font-semibold text-gray-900 truncate">{item.title || item.what}</p>
        </div>
        <button onClick={onClose} title="Collapse"
          className="text-xs text-gray-400 hover:text-gray-700 leading-none shrink-0">✕</button>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 italic">Opening…</p>
      ) : (
        <>
          {data?.body && (
            <p className="text-xs text-gray-700 whitespace-pre-wrap mb-2">
              {renderWithMentions(data.body, mentionableUsers)}
            </p>
          )}

          {thread.length > 0 && (
            <div className="space-y-1.5 mb-3 max-h-64 overflow-y-auto pr-1">
              {thread.map(n => (
                <div key={n.id} className="rounded-lg bg-white border border-gray-100 px-3 py-2 text-xs">
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="font-semibold text-gray-600">{n.author || '—'}</span>
                    <span className="text-[10px] text-gray-400">{fmtWhen(n.created_at)}</span>
                  </div>
                  <div className="text-gray-700 whitespace-pre-wrap">
                    {renderWithMentions(n.text, mentionableUsers)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSend} className="space-y-1.5">
            <MentionTextarea
              value={text}
              onChange={setText}
              users={mentionableUsers}
              rows={2}
              placeholder={`Add a note as ${user?.initials}… (type @ to tag someone)`}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(e) }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={sending || !text.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 hover:bg-blue-700">
                {sending ? 'Saving…' : 'Add note'}
              </button>
              <button type="button" onClick={handleFinish} disabled={sending}
                className="px-3 py-1.5 border border-green-200 bg-green-50 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-100 disabled:opacity-50">
                ✓ {source.finishLabel}
              </button>
              <button type="button" onClick={onClose}
                className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg hover:bg-white">
                Leave it open
              </button>
              {openPath && (
                <button type="button" onClick={() => navigate(openPath)}
                  className="text-[11px] text-blue-600 hover:underline ml-auto">
                  Open the full screen ↗
                </button>
              )}
            </div>
            {error && <p className="text-[11px] text-red-600">{error}</p>}
          </form>
        </>
      )}
    </div>
  )
}
