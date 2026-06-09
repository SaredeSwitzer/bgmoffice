import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { useRemindersContext } from '../context/RemindersContext'
import SearchSelect from './SearchSelect'
import DateInput from './DateInput'

export default function AddReminderModal({
  onClose,
  clientId, instructorId, caseId, actionItemId,
  defaultTitle = '',
  defaultDelegate = '',
}) {
  const { refresh } = useRemindersContext()
  const [clients,     setClients]     = useState([])
  const [instructors, setInstructors] = useState([])
  const [delegates,   setDelegates]   = useState([])
  const [selectedClients,     setSelectedClients]     = useState([])
  const [selectedInstructors, setSelectedInstructors] = useState([])
  const [form, setForm] = useState({
    title:         defaultTitle,
    notes:         '',
    remind_on:     '',
    delegate_name: defaultDelegate,
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  useEffect(() => {
    Promise.all([api.getClients(), api.getInstructors(), api.getDelegates()])
      .then(([c, i, d]) => {
        setClients(c)
        setInstructors(i)
        setDelegates(d)
        if (clientId) {
          const found = c.find(x => x.id === Number(clientId))
          if (found) setSelectedClients([found])
        }
        if (instructorId) {
          const found = i.find(x => x.id === Number(instructorId))
          if (found) setSelectedInstructors([found])
        }
      })
      .catch(() => {})
  }, [clientId, instructorId])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim() || !form.remind_on) return
    setSaving(true)
    setError('')

    const base = {
      title:          form.title.trim(),
      notes:          form.notes.trim() || null,
      remind_on:      form.remind_on,
      delegate_name:  form.delegate_name || null,
      case_id:        caseId        || null,
      action_item_id: actionItemId  || null,
    }

    // Build one entry per selected person; if none selected, create one unlinked reminder
    const people = [
      ...selectedClients.map(c     => ({ client_id: c.id, instructor_id: null })),
      ...selectedInstructors.map(i => ({ client_id: null, instructor_id: i.id })),
    ]
    const entries = people.length > 0 ? people : [{ client_id: null, instructor_id: null }]

    try {
      await Promise.all(entries.map(p => api.createReminder({ ...base, ...p })))
      refresh()
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const totalCount = selectedClients.length + selectedInstructors.length

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900">Add Reminder</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
            <input
              required
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Follow up on payment"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Remind on *</label>
            <DateInput
              required
              value={form.remind_on}
              onChange={v => setForm(f => ({ ...f, remind_on: v }))}
              className="w-full"
            />
          </div>

          {/* Clients (multi) */}
          <SearchSelect
            label="Client(s) (optional)"
            options={clients}
            value={selectedClients}
            onChange={setSelectedClients}
            placeholder="Search clients…"
            multi
          />

          {/* Instructors (multi) */}
          <SearchSelect
            label="Instructor(s) (optional)"
            options={instructors}
            value={selectedInstructors}
            onChange={setSelectedInstructors}
            placeholder="Search instructors…"
            multi
          />

          {/* Fan-out hint */}
          {totalCount > 1 && (
            <p className="text-xs text-gray-500 pl-0.5">
              Creates {totalCount} separate reminders — one per person.
            </p>
          )}

          {/* Delegate */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Delegated to</label>
            <select
              value={form.delegate_name}
              onChange={e => setForm(f => ({ ...f, delegate_name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            >
              <option value="">Anyone</option>
              {delegates.map(d => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={3}
              placeholder="Optional details…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving || !form.title.trim() || !form.remind_on}
              className="flex-1 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors"
            >
              {saving ? 'Saving…' : totalCount > 1 ? `Add ${totalCount} Reminders` : 'Add Reminder'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
