import { useState, useEffect } from 'react'
import { api } from '../api/client'
import SearchSelect from './SearchSelect'

const REASONS = [
  'Away/Unavailable',
  'Requested Check-In',
  'End of Hiatus',
  'Other',
]

const DELEGATES = ['Sarede', 'Lyra', 'Maria', 'Claire', 'Anyone']

export default function InstructorCheckInModal({ onClose }) {
  const [instructors, setInstructors] = useState([])
  const [form, setForm] = useState({
    instructor: null,
    reason: '',
    follow_up_date: '',
    delegate_name: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getInstructors().then(setInstructors)
  }, [])

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.instructor) { setError('Please select an instructor.'); return }
    if (!form.reason)     { setError('Please select a reason.'); return }
    if (!form.follow_up_date) { setError('Please choose a follow-up date.'); return }
    setSaving(true)
    setError('')
    try {
      const title = `Check in with ${form.instructor.name} (${form.reason})`
      await api.createReminder({
        title,
        notes:          form.notes.trim() || null,
        remind_on:      form.follow_up_date,
        instructor_id:  form.instructor.id,
        delegate_name:  form.delegate_name || null,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to save reminder.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h3 className="font-bold text-gray-900 mb-4">Instructor Check-In</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Instructor <span className="text-red-500">*</span></label>
            <SearchSelect
              options={instructors}
              value={form.instructor}
              onChange={v => set('instructor', v)}
              placeholder="Search instructor…"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reason <span className="text-red-500">*</span></label>
            <select
              value={form.reason}
              onChange={e => set('reason', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select reason…</option>
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Follow-up Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={form.follow_up_date}
              onChange={e => set('follow_up_date', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Delegate</label>
            <select
              value={form.delegate_name}
              onChange={e => set('delegate_name', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {DELEGATES.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Any additional context…"
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving}
              className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-indigo-700 transition-colors">
              {saving ? 'Saving…' : 'Save Reminder'}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
