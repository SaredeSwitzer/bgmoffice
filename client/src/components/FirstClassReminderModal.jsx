import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { useRemindersContext } from '../context/RemindersContext'
import SearchSelect from './SearchSelect'
import DateInput from './DateInput'

// ── Modal ─────────────────────────────────────────────────────────────────────

export default function FirstClassReminderModal({ onClose }) {
  const { refresh } = useRemindersContext()
  const [clients,     setClients]     = useState([])
  const [instructors, setInstructors] = useState([])
  const [delegates,   setDelegates]   = useState([])
  const [client,      setClient]      = useState(null)
  const [instructor,  setInstructor]  = useState(null)
  const [classDate,   setClassDate]   = useState('')
  const [delegate,    setDelegate]    = useState('')
  const [notes,       setNotes]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  useEffect(() => {
    Promise.all([api.getClients(), api.getInstructors(), api.getDelegates()])
      .then(([c, i, d]) => { setClients(c); setInstructors(i); setDelegates(d) })
      .catch(() => {})
  }, [])

  const autoTitle = client && instructor
    ? `Follow up with ${client.name} about first class with ${instructor.name}`
    : ''

  const canSave = !!(client && instructor && classDate)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      await api.createReminder({
        title:         autoTitle,
        notes:         notes.trim() || null,
        remind_on:     classDate,
        delegate_name: delegate  || null,
        client_id:     client.id,
        instructor_id: instructor.id,
      })
      refresh()
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  // Close on backdrop click
  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 px-4 pt-16 pb-8 overflow-y-auto"
      onClick={handleBackdrop}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-gray-900 text-base">🎓 First Class Follow-Up</h3>
            <p className="text-xs text-gray-500 mt-0.5">Reminder to follow up after a client's first class</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none ml-4 flex-shrink-0"
          >✕</button>
        </div>

        {/* Live title preview */}
        {autoTitle ? (
          <div className="mb-3 px-3 py-2.5 bg-teal-50 rounded-xl border border-teal-200">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-teal-600 mb-0.5">Reminder title (auto-generated)</p>
            <p className="text-sm text-teal-900 font-medium leading-snug">{autoTitle}</p>
          </div>
        ) : (
          <div className="mb-3 px-3 py-2.5 bg-gray-50 rounded-xl border border-dashed border-gray-300">
            <p className="text-xs text-gray-400 italic">Select a client and instructor to see the auto-generated title</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <SearchSelect
            label="Client" required
            options={clients}
            value={client}
            onChange={setClient}
            placeholder="Search clients…"
            clearable={false}
          />

          <SearchSelect
            label="Instructor" required
            options={instructors}
            value={instructor}
            onChange={setInstructor}
            placeholder="Search instructors…"
            clearable={false}
          />

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date of First Class *</label>
            <DateInput
              required
              value={classDate}
              onChange={v => setClassDate(v)}
              className="w-full"
            />
            <p className="text-[10px] text-gray-400 mt-0.5">The reminder will fire on this date</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Delegated to</label>
            <select
              value={delegate}
              onChange={e => setDelegate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 bg-white"
            >
              <option value="">Anyone</option>
              {delegates.map(d => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Any extra context…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving || !canSave}
              className="flex-1 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:bg-teal-700 transition-colors"
            >
              {saving ? 'Saving…' : '🎓 Add Follow-Up Reminder'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-xl hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
