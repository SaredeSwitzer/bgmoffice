import { useEffect, useState } from 'react'
import { api } from '../api/client'

// Preview + send the instructor confirmation email for a recurring class. The app fills the
// template from the class; staff review (and can tweak) before sending. Nothing sends on its own.
export default function ConfirmClassModal({ schedule, onClose, onSent }) {
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.getConfirmationPreview(schedule.id)
      .then(p => { setPreview(p); setSubject(p.subject); setBody(p.body) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [schedule.id])

  async function send() {
    setSending(true); setError(null)
    try {
      const r = await api.sendConfirmation(schedule.id, { subject, body })
      onSent?.(r)
      onClose()
    } catch (e) {
      setError(e.message); setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">Confirmation email · {schedule.client_name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-3">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : !preview?.to ? (
            <div className="text-sm text-gray-600">
              <p className="font-medium text-gray-800 mb-1">No email on file for {preview?.instructor_name || 'this instructor'}.</p>
              <p className="text-gray-500">Add an email on their instructor profile, then send from here.</p>
            </div>
          ) : (
            <>
              {preview.already_sent_at && (
                <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2">
                  Already sent {new Date(preview.already_sent_at).toLocaleDateString()} to {preview.already_sent_to}. Sending again will re-send it.
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <div className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                  {preview.instructor_name} &lt;{preview.to}&gt;
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={12}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed" />
              </div>
              <p className="text-[11px] text-gray-400">The app filled this in from the class — edit anything before sending.</p>
            </>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg">Cancel</button>
          {preview?.to && (
            <button onClick={send} disabled={sending}
              className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {sending ? 'Sending…' : (preview.already_sent_at ? 'Send again' : 'Send email')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
