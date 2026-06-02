import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useRemindersContext } from '../context/RemindersContext'
import AddReminderModal from '../components/AddReminderModal'

function fmtDate(iso) {
  if (!iso) return ''
  // iso is YYYY-MM-DD
  const [y, m, d] = iso.split('-')
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ReminderRow({ reminder, onDone, onDelete, isOverdue }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  async function handleDone() {
    setLoading(true)
    await onDone(reminder.id)
  }

  return (
    <div className={`flex items-start gap-4 px-4 py-3 rounded-xl border ${
      isOverdue ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${isOverdue ? 'text-red-800' : 'text-gray-900'}`}>
            {reminder.title}
          </span>
          {isOverdue && (
            <span className="text-xs font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">Overdue</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
          <span className={`text-xs ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
            📅 {fmtDate(reminder.remind_on)}
          </span>
          {reminder.client_name && (
            <span className="text-xs text-gray-500">👤 {reminder.client_name}</span>
          )}
          {reminder.instructor_name && (
            <span className="text-xs text-gray-500">🏋️ {reminder.instructor_name}</span>
          )}
          {reminder.case_id && (
            <button
              onClick={() => navigate(`/cases/${reminder.case_id}`)}
              className="text-xs text-blue-600 hover:underline"
            >
              View Case →
            </button>
          )}
        </div>

        {reminder.notes && (
          <p className="text-xs text-gray-500 mt-1 italic">{reminder.notes}</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleDone}
          disabled={loading}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            isOverdue
              ? 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50'
              : 'bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50'
          }`}
        >
          {loading ? '…' : 'Mark Done'}
        </button>
        <button
          onClick={() => onDelete(reminder.id)}
          className="text-xs text-gray-400 hover:text-red-600"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function Section({ title, accent, items, emptyMsg, onDone, onDelete, isOverdue }) {
  const accentClass = accent === 'red'
    ? 'border-red-400 text-red-700'
    : 'border-blue-400 text-blue-700'

  return (
    <section>
      <div className={`flex items-center gap-2 mb-3 pl-1 border-l-4 ${accentClass}`}>
        <h2 className="text-sm font-bold uppercase tracking-widest">{title}</h2>
        <span className="text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-400 italic px-2 py-4">{emptyMsg}</p>
      ) : (
        <div className="space-y-2">
          {items.map(r => (
            <ReminderRow
              key={r.id}
              reminder={r}
              isOverdue={isOverdue}
              onDone={onDone}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default function RemindersPage() {
  const { refresh: refreshBadge } = useRemindersContext()
  const [overdue, setOverdue] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  function load() {
    return api.getReminders().then(({ overdue: o, upcoming: u }) => {
      setOverdue(o)
      setUpcoming(u)
    })
  }

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [])

  async function handleDone(id) {
    await api.markReminderDone(id)
    await load()
    refreshBadge()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this reminder?')) return
    await api.deleteReminder(id)
    await load()
    refreshBadge()
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Reminders</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          + Add Reminder
        </button>
      </div>

      <Section
        title="Overdue"
        accent="red"
        items={overdue}
        emptyMsg="No overdue reminders."
        isOverdue
        onDone={handleDone}
        onDelete={handleDelete}
      />

      <Section
        title="Upcoming"
        accent="blue"
        items={upcoming}
        emptyMsg="No upcoming reminders — all clear!"
        isOverdue={false}
        onDone={handleDone}
        onDelete={handleDelete}
      />

      {showAdd && (
        <AddReminderModal
          onClose={() => { setShowAdd(false); load(); refreshBadge() }}
        />
      )}
    </div>
  )
}
