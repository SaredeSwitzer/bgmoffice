import { useState } from 'react'
import { api } from '../api/client'

// Mark a dated class as "pending" (instructor can't teach it, waiting to hear back from
// the client about a sub / skip / reschedule, etc.) with a reason, and optionally drop
// that same reason as a reminder on the client's and/or instructor's profile — those
// pages already show a Reminders section, so this is how the "pending" note becomes
// visible there without a separate notes system to keep in sync.
export default function PendingClassModal({ session, onClose, onSaved }) {
  const [reason, setReason] = useState(session.notes || '')
  const [noteClient, setNoteClient] = useState(true)
  const [noteInstructor, setNoteInstructor] = useState(!!session.instructor_id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!reason.trim()) { setError('Please explain why this class is pending.'); return }
    setSaving(true); setError('')
    try {
      const updated = await api.updateClassSession(session.id, { status: 'pending', notes: reason.trim() })
      const title = `Pending class — ${session.client_name}${session.instructor_name ? ` / ${session.instructor_name}` : ''} (${session.session_date})`
      const reminderJobs = []
      if (noteClient) {
        reminderJobs.push(api.createReminder({
          title, notes: reason.trim(), remind_on: session.session_date, client_id: session.client_id,
        }))
      }
      if (noteInstructor && session.instructor_id) {
        reminderJobs.push(api.createReminder({
          title, notes: reason.trim(), remind_on: session.session_date, instructor_id: session.instructor_id,
        }))
      }
      await Promise.all(reminderJobs)
      onSaved(updated)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 px-4 py-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-900 text-base">Mark Class Pending</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs text-gray-500">
              {session.client_name}{session.instructor_name ? ` with ${session.instructor_name}` : ''} · {session.session_date}
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Why is this pending?</label>
              <textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} rows={3}
                placeholder="e.g. Instructor can't make it — waiting to hear if client wants a sub or to skip"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={noteClient} onChange={e => setNoteClient(e.target.checked)} />
                Also add a reminder on {session.client_name}'s profile
              </label>
              {session.instructor_id && (
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={noteInstructor} onChange={e => setNoteInstructor(e.target.checked)} />
                  Also add a reminder on {session.instructor_name}'s profile
                </label>
              )}
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            <button type="submit" disabled={saving}
              className="flex-1 bg-amber-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-amber-700">
              {saving ? 'Saving…' : 'Mark Pending'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
