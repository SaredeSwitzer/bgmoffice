import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import MentionTextarea from './MentionTextarea'
import { renderWithMentions } from '../utils/mentions.jsx'

// An @mention opened in place on My Tasks. Before this, the only way to find out what
// somebody wanted was to click through to whichever screen the note lived on — which
// also marked it read on the way, so a half-answered mention had no way back.
//
// Here you read the whole thread, reply into it, and then decide: done with it, or
// leave it sitting on the list.

function fmtWhen(ts) {
  if (!ts) return ''
  const d = new Date(String(ts).includes('T') ? ts : String(ts).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function MentionThread({ mention, mentionableUsers = [], onResolve, onClose }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [reply,   setReply]   = useState('')
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [error,   setError]   = useState('')
  const boxRef = useRef(null)

  // My Tasks gives every row a composite id ("mention-62") so ids from different
  // sources can't collide; the mentions row's own id is mention_id.
  const mentionId = mention.mention_id ?? mention.id

  useEffect(() => {
    let cancelled = false
    api.getMentionThread(mentionId)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not load this one.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mentionId])

  async function handleReply(e) {
    e?.preventDefault()
    if (!reply.trim() || !data?.reply_to) return
    setSending(true)
    setError('')
    try {
      await api.replyToMention(data.reply_to.path, reply.trim())
      const now = new Date().toISOString()
      setData(d => ({
        ...d,
        thread: [...(d.thread || []), { id: `local-${now}`, text: reply.trim(), author: user?.initials, created_at: now }],
      }))
      setReply('')
      setSent(true)
    } catch (err) {
      setError(err.message || 'That reply did not save.')
    } finally { setSending(false) }
  }

  const noteText = data?.note?.text || mention.last_note?.text || mention.snippet || ''
  const thread   = data?.thread || []
  const openPath = mention.link_path

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">
          {mention.author_initials || data?.note?.author} tagged you
        </p>
        <button onClick={onClose} title="Collapse"
          className="text-xs text-gray-400 hover:text-gray-700 leading-none">✕</button>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 italic">Loading the note…</p>
      ) : (
        <>
          {/* The conversation. The note you were tagged in is called out; the rest is
              there so a one-line "@Sarede thoughts?" isn't stranded without context. */}
          <div className="space-y-1.5 mb-3 max-h-72 overflow-y-auto pr-1">
            {(thread.length ? thread : [{ id: 'only', text: noteText, author: mention.author_initials }]).map(n => {
              const isTheOne = data?.note && String(n.id) === String(data.note.id)
              return (
                <div key={n.id}
                  className={`rounded-lg px-3 py-2 text-xs ${
                    isTheOne ? 'bg-white border border-indigo-300' : 'bg-white/70 border border-gray-100'
                  }`}>
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="font-semibold text-gray-600">{n.author || '—'}</span>
                    <span className="text-[10px] text-gray-400">{fmtWhen(n.created_at)}</span>
                    {isTheOne && (
                      <span className="text-[9px] font-bold uppercase tracking-wide text-indigo-600">this one</span>
                    )}
                  </div>
                  <div className="text-gray-700 whitespace-pre-wrap">
                    {renderWithMentions(n.text, mentionableUsers)}
                  </div>
                </div>
              )
            })}
          </div>

          {data?.reply_to ? (
            <form onSubmit={handleReply} className="space-y-1.5">
              <MentionTextarea
                ref={boxRef}
                value={reply}
                onChange={setReply}
                users={mentionableUsers}
                rows={2}
                placeholder={`Reply as ${user?.initials}… (type @ to tag someone)`}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply(e) }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" disabled={sending || !reply.trim()}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 hover:bg-blue-700">
                  {sending ? 'Sending…' : 'Reply'}
                </button>
                <button type="button" onClick={() => onResolve(mention)}
                  className="px-3 py-1.5 border border-green-200 bg-green-50 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-100">
                  ✓ Read — no follow-up needed
                </button>
                <button type="button" onClick={onClose}
                  className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg hover:bg-white">
                  Leave it unread
                </button>
                {openPath && (
                  <button type="button" onClick={() => navigate(openPath)}
                    className="text-[11px] text-blue-600 hover:underline ml-auto">
                    Open where it lives ↗
                  </button>
                )}
              </div>
              {sent && !error && (
                <p className="text-[11px] text-green-700">
                  Replied. It stays on your list until you mark it read.
                </p>
              )}
              {error && <p className="text-[11px] text-red-600">{error}</p>}
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => onResolve(mention)}
                className="px-3 py-1.5 border border-green-200 bg-green-50 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-100">
                ✓ Read — no follow-up needed
              </button>
              <button type="button" onClick={onClose}
                className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg hover:bg-white">
                Leave it unread
              </button>
              {openPath && (
                <button type="button" onClick={() => navigate(openPath)}
                  className="text-[11px] text-blue-600 hover:underline ml-auto">
                  Open where it lives ↗
                </button>
              )}
              {error && <p className="text-[11px] text-red-600 w-full">{error}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
