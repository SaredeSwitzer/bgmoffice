import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import ActionTypeBadge from '../components/ActionTypeBadge'
import AddReminderModal from '../components/AddReminderModal'

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysOpen(createdAt) {
  return Math.floor((Date.now() - new Date(createdAt)) / 86400000)
}

function DelegateChip({ name }) {
  if (!name) return <span className="text-gray-400 text-xs italic">Anyone</span>
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
      {name}
    </span>
  )
}

// ── Task row ──────────────────────────────────────────────────────────────────

function TaskRow({ item, onClick, isOwn }) {
  const days = daysOpen(item.created_at)
  const isOverdue = days > 7
  const isPriority = item.action_type_name === 'PRIORITY'

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors hover:bg-gray-50 ${
        isPriority
          ? 'bg-red-50 hover:bg-red-100'
          : isOwn
          ? 'bg-blue-50/40 hover:bg-blue-50'
          : isOverdue
          ? 'bg-amber-50 hover:bg-amber-100'
          : ''
      }`}
    >
      <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
        {item.client_name || <span className="text-gray-400">—</span>}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
        {item.instructor_name || <span className="text-gray-400">—</span>}
      </td>
      <td className="px-4 py-3">
        <ActionTypeBadge name={item.action_type_name} color={item.action_type_color} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <DelegateChip name={item.delegate_name} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-right">
        <span className={`text-xs font-semibold tabular-nums ${
          isPriority ? 'text-red-700' : isOverdue ? 'text-amber-700' : 'text-gray-500'
        }`}>
          {days}d
          {isOverdue && !isPriority && <span className="ml-1 text-amber-600 font-bold">!</span>}
          {isPriority && <span className="ml-1 text-red-600 font-bold">↑</span>}
        </span>
      </td>
      <td className="px-4 py-3 max-w-xs">
        {item.last_note ? (
          <span className="text-xs text-gray-500 truncate block max-w-[220px]">
            <span className="font-medium text-gray-700">{item.last_note.author_initials}:</span>{' '}
            {item.last_note.text}
          </span>
        ) : (
          <span className="text-xs text-gray-400 italic">No notes yet</span>
        )}
      </td>
    </tr>
  )
}

// ── Delegate filter bar ───────────────────────────────────────────────────────

// Special sentinel values for the filter
const FILTER_ALL    = 'all'
const FILTER_ANYONE = '__anyone__'  // tasks with no delegate assigned

function DelegateFilterBar({ delegates, active, onChange }) {
  const filters = [
    { key: FILTER_ALL,    label: 'All' },
    { key: FILTER_ANYONE, label: 'Anyone' },
    ...delegates.map(d => ({ key: d.name, label: d.name })),
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {filters.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
            active === key
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Section table ─────────────────────────────────────────────────────────────

function SectionTable({ title, items, emptyMsg, onRowClick, accent, myDelegateName, showFilter, delegates }) {
  const accentMap = {
    gray:  'border-gray-300 text-gray-700',
    green: 'border-green-400 text-green-700',
    blue:  'border-blue-400 text-blue-700',
  }

  // For Open Tasks only: filter state defaults to "all", pre-selected to logged-in user if match found
  const [activeFilter, setActiveFilter] = useState(() => myDelegateName || 'all')

  // Re-sync if myDelegateName resolves after initial render
  useEffect(() => {
    if (myDelegateName) setActiveFilter(myDelegateName)
  }, [myDelegateName])

  const displayItems = useMemo(() => {
    if (!showFilter) return items

    // Filter by selected pill
    const filtered = activeFilter === FILTER_ALL
      ? items
      : activeFilter === FILTER_ANYONE
      ? items.filter(i => !i.delegate_name)
      : items.filter(i => i.delegate_name === activeFilter)

    // Sort: PRIORITY always first, then within each group own tasks float to top, then oldest first
    return [...filtered].sort((a, b) => {
      const aPriority = a.action_type_name === 'PRIORITY' ? 0 : 1
      const bPriority = b.action_type_name === 'PRIORITY' ? 0 : 1
      if (aPriority !== bPriority) return aPriority - bPriority

      // When "All" is selected, float logged-in user's tasks to top within each priority tier
      if (activeFilter === FILTER_ALL && myDelegateName) {
        const aOwn = a.delegate_name === myDelegateName ? 0 : 1
        const bOwn = b.delegate_name === myDelegateName ? 0 : 1
        if (aOwn !== bOwn) return aOwn - bOwn
      }

      return new Date(a.created_at) - new Date(b.created_at)
    })
  }, [items, activeFilter, myDelegateName, showFilter])

  return (
    <section>
      <div className={`flex items-center gap-2 mb-3 pl-1 border-l-4 ${accentMap[accent] || accentMap.gray}`}>
        <h2 className="text-sm font-bold uppercase tracking-widest">{title}</h2>
        <span className="text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
          {displayItems.length}{activeFilter !== FILTER_ALL && items.length !== displayItems.length ? ` of ${items.length}` : ''}
        </span>
      </div>

      {showFilter && (
        <div className="mb-3">
          <DelegateFilterBar
            delegates={delegates}
            active={activeFilter}
            onChange={setActiveFilter}
          />
        </div>
      )}

      {displayItems.length === 0 ? (
        <p className="text-sm text-gray-400 italic px-2 py-4">
          {activeFilter === FILTER_ANYONE
            ? 'No open tasks without an assigned delegate.'
            : activeFilter !== FILTER_ALL
            ? `No open tasks assigned to ${activeFilter}.`
            : emptyMsg}
        </p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Instructor</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Delegate</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Age</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Last note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayItems.map(item => (
                <TaskRow
                  key={item.id}
                  item={item}
                  isOwn={activeFilter === FILTER_ALL && !!myDelegateName && item.delegate_name === myDelegateName}
                  onClick={() => onRowClick(item.case_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [delegates, setDelegates] = useState([])
  const [error, setError] = useState('')
  const [showReminder, setShowReminder] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([api.dashboard(), api.getDelegates()])
      .then(([d, dels]) => { setData(d); setDelegates(dels) })
      .catch(e => setError(e.message))
  }, [])

  // Match logged-in user's first name to a delegate name (case-insensitive)
  const myDelegateName = useMemo(() => {
    if (!user || !delegates.length) return null
    const firstName = user.name.split(' ')[0].toLowerCase()
    const match = delegates.find(d => d.name.toLowerCase() === firstName)
    return match?.name || null
  }, [user, delegates])

  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (!data) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <button
          onClick={() => setShowReminder(true)}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          + Add Reminder
        </button>
      </div>

      {showReminder && <AddReminderModal onClose={() => setShowReminder(false)} />}

      <SectionTable
        title="Open Tasks"
        items={data.open_tasks}
        emptyMsg="No open tasks — all caught up!"
        onRowClick={id => navigate(`/cases/${id}`)}
        accent="gray"
        showFilter
        delegates={delegates}
        myDelegateName={myDelegateName}
      />
      <SectionTable
        title="Client Follow-ups"
        items={data.client_followups}
        emptyMsg="No open client follow-ups."
        onRowClick={id => navigate(`/cases/${id}`)}
        accent="green"
        myDelegateName={myDelegateName}
      />
      <SectionTable
        title="Instructor Follow-ups"
        items={data.instructor_followups}
        emptyMsg="No open instructor follow-ups."
        onRowClick={id => navigate(`/cases/${id}`)}
        accent="blue"
        myDelegateName={myDelegateName}
      />
    </div>
  )
}
