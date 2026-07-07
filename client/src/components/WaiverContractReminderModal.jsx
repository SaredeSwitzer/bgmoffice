import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { useRemindersContext } from '../context/RemindersContext'
import SearchSelect from './SearchSelect'

export default function WaiverContractReminderModal({ onClose }) {
  const { refresh } = useRemindersContext()
  const [type, setType] = useState('client') // 'client' | 'instructor'
  const [clients,     setClients]     = useState([])
  const [instructors, setInstructors] = useState([])
  const [delegates,   setDelegates]   = useState([])
  const [people,      setPeople]      = useState([])
  const today = new Date().toLocaleDateString('en-CA')
  const [remindOn,  setRemindOn]  = useState(today)
  const [delegate,  setDelegate]  = useState('')
  const [notes,     setNotes]     = useState('')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  useEffect(() => {
    Promise.all([api.getClients(), api.getInstructors(), api.getDelegates()])
      .then(([c, i, d]) => { setClients(c); setInstructors(i); setDelegates(d) })
      .catch(() => {})
  }, [])

  // Reset selection when type toggles
  function handleTypeChange(newType) {
    setType(newType)
    setPeople([])
  }

  const docLabel = type === 'client' ? 'waiver' : 'contract'
  const options  = type === 'client' ? clients : instructors

  const autoTitle = people.length === 1
    ? `Remind ${people[0].name} to sign ${docLabel}`
    : people.length > 1
      ? `Remind ${people.length} ${type === 'client' ? 'clients' : 'instructors'} to sign ${docLabel}`
      : ''

  const canSave = people.length > 0 && !!remindOn

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      const base = {
        notes:         notes.trim() || null,
        remind_on:     remindOn,
        delegate_name: delegate || null,
      }
      await Promise.all(
        people.map((p, idx) =>
          api.createReminder({
            ...base,
            title: people.length === 1
              ? autoTitle
              : `Remind ${p.name} to sign ${docLabel}`,
            client_id:     type === 'client'     ? p.id : null,
            instructor_id: type === 'instructor' ? p.id : null,
          })
        )
      )
      refresh()
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

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
            <h3 className="font-bold text-gray-900 text-base">📝 Sign Waiver / Contract</h3>
            <p className="text-xs text-gray-500 mt-0.5">Remind a client to sign their waiver or an instructor to sign their contract</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none ml-4 flex-shrink-0"
          >✕</button>
        </div>

        {/* Type toggle */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => handleTypeChange('client')}
            className={`flex-1 py-2 text-sm font-semibold rounded-xl border transition-colors ${
              type === 'client'
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Client Waiver
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('instructor')}
            className={`flex-1 py-2 text-sm font-semibold rounded-xl border transition-colors ${
              type === 'instructor'
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Instructor Contract
          </button>
        </div>

        {/* Live title preview */}
        {autoTitle ? (
          <div className="mb-3 px-3 py-2.5 bg-amber-50 rounded-xl border border-amber-200">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 mb-0.5">Reminder title (auto-generated)</p>
            <p className="text-sm text-amber-900 font-medium leading-snug">{autoTitle}</p>
          </div>
        ) : (
          <div className="mb-3 px-3 py-2.5 bg-gray-50 rounded-xl border border-dashed border-gray-300">
            <p className="text-xs text-gray-400 italic">
              Select {type === 'client' ? 'one or more clients' : 'one or more instructors'} to see the auto-generated title
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <SearchSelect
            label={type === 'client' ? 'Client(s) *' : 'Instructor(s) *'}
            options={options}
            value={people}
            onChange={setPeople}
            placeholder={type === 'client' ? 'Search clients…' : 'Search instructors…'}
            multi
          />

          {people.length > 1 && (
            <p className="text-xs text-gray-500 pl-0.5">
              Creates {people.length} separate reminders — one per person.
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Remind on *</label>
            <input
              type="date"
              required
              value={remindOn}
              onChange={e => setRemindOn(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
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
              className="flex-1 py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:bg-amber-600 transition-colors"
            >
              {saving ? 'Saving…' : people.length > 1 ? `Add ${people.length} Reminders` : '📝 Add Reminder'}
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
