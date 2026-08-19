import { useState } from 'react'
import { api } from '../api/client'

export default function MeetingInviteModal({ onClose }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [time, setTime] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) { setError('Please enter an email address.'); return }
    setSending(true)
    setError('')
    try {
      await api.sendMeetingInvite({ name: name.trim(), email: email.trim(), time: time.trim() })
      setSent(true)
    } catch (err) {
      setError(err.message || 'Failed to send invite.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        {sent ? (
          <>
            <h3 className="font-bold text-gray-900 mb-2">Invite sent</h3>
            <p className="text-sm text-gray-600 mb-4">The meeting link was emailed to {email}.</p>
            <button onClick={onClose}
              className="w-full bg-gray-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-700">
              Done
            </button>
          </>
        ) : (
          <>
            <h3 className="font-bold text-gray-900 mb-1">Invite to Meeting</h3>
            <p className="text-xs text-gray-500 mb-4">Emails a candidate the meeting link — no instructor record needed.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
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
                <button type="submit" disabled={sending}
                  className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors">
                  {sending ? 'Sending…' : 'Send Invite'}
                </button>
                <button type="button" onClick={onClose}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
