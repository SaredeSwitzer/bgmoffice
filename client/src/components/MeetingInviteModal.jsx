import { useState } from 'react'
import { api } from '../api/client'

// Step 1: who/when. Step 2: preview the filled-in email and edit it before sending —
// same pattern as the instructor confirmation email (see ConfirmClassModal).
export default function MeetingInviteModal({ onClose }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [time, setTime] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [preview, setPreview] = useState(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handlePreview(e) {
    e.preventDefault()
    if (!email.trim()) { setError('Please enter an email address.'); return }
    setLoadingPreview(true)
    setError('')
    try {
      const p = await api.getMeetingInvitePreview({ name: name.trim(), time: time.trim() })
      setSubject(p.subject)
      setBody(p.body)
      setPreview(p)
    } catch (err) {
      setError(err.message || 'Failed to build preview.')
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleSend() {
    setSending(true)
    setError('')
    try {
      await api.sendMeetingInvite({ email: email.trim(), subject, body })
      setSent(true)
    } catch (err) {
      setError(err.message || 'Failed to send invite.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6">
          <h3 className="font-bold text-gray-900">Invite to Meeting</h3>
          <p className="text-xs text-gray-500 mt-1 mb-4">Emails a candidate the meeting link — no instructor record needed.</p>
        </div>

        {sent ? (
          <div className="px-6 pb-6">
            <p className="text-sm text-gray-600 mb-4">The meeting invite was emailed to {email}.</p>
            <button onClick={onClose}
              className="w-full bg-gray-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-700">
              Done
            </button>
          </div>
        ) : !preview ? (
          <form onSubmit={handlePreview} className="px-6 pb-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="Jane Doe"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email <span className="text-red-500">*</span></label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="jane@example.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
              <input value={time} onChange={e => setTime(e.target.value)}
                placeholder="3:00pm"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={loadingPreview}
                className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors">
                {loadingPreview ? 'Loading…' : 'Preview Email'}
              </button>
              <button type="button" onClick={onClose}
                className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="px-6 pb-6 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <div className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                {email}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <p className="text-[11px] text-gray-400">The app filled this in from the template — edit anything before sending.</p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={handleSend} disabled={sending}
                className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors">
                {sending ? 'Sending…' : 'Send Invite'}
              </button>
              <button type="button" onClick={() => setPreview(null)}
                className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
