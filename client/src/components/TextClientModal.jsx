import { useEffect, useState } from 'react'
import { api } from '../api/client'

// Text the client their class confirmation — the short version of the instructor's
// confirmation email: what's booked, with whom, and the 24-hour cancellation notice.
//
// Same shape as ConfirmClassModal on purpose: the app writes it, you read it, you press
// send. Nothing goes out on its own, and what's on screen is exactly what's sent, so
// changing a word here changes the text that arrives.
//
// A text is not an email — 160 characters is one message and every 153 after that is
// another, so the count is on screen. Nobody minds a two-part text; six is a wall.
function segments(text) {
  const n = text.length
  if (n === 0) return 0
  return n <= 160 ? 1 : Math.ceil(n / 153)
}

export default function TextClientModal({ classRow, kind = 'schedule', onClose, onSent }) {
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    api.getClientTextPreview(kind, classRow.id)
      .then(p => { if (cancelled) return; setPreview(p); setText(p.text) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [classRow.id, kind])

  async function send() {
    setSending(true); setError(null)
    try {
      const r = await api.sendClientText(kind, classRow.id, { text })
      onSent?.(r)
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const count = segments(text.trim())

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-base">Text {preview?.client_name || 'the client'}</h3>
          {preview?.to && <p className="text-xs text-gray-400 mt-0.5">To {preview.to}</p>}
        </div>

        <div className="px-5 py-4 space-y-3">
          {loading ? (
            <p className="text-sm text-gray-400 italic">Writing it…</p>
          ) : !preview?.to ? (
            <p className="text-sm text-gray-600">
              {preview?.client_name || 'This client'} has no phone number on file. Add one on their
              profile and this will work.
            </p>
          ) : (
            <>
              {preview.already_sent_at && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  A confirmation text already went out for this class. Sending again is fine — it just
                  sends another one.
                </p>
              )}
              {!preview.has_instructor && (
                <p className="text-xs text-gray-500">
                  No instructor on this class yet, so the text doesn’t name one.
                </p>
              )}
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={6}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-gray-400">
                {text.trim().length} characters · {count} text{count === 1 ? '' : 's'}
              </p>
            </>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
          <button
            onClick={send}
            disabled={sending || loading || !preview?.to || !text.trim()}
            className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-blue-700"
          >
            {sending ? 'Sending…' : 'Send text'}
          </button>
          <button onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
