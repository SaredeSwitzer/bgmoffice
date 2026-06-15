import { useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import ActionTypeBadge from '../components/ActionTypeBadge'

const DELEGATES = ['Sarede', 'Maria', 'Claire', 'Anyone']

function QuickAddOther({ onAdd }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  function show() { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const t = await api.createTask({ title: title.trim(), assigned_to: assignedTo, task_type: 'other', priority: 'normal', description: '', due_date: '', notes: '' })
      onAdd(t)
      setTitle('')
      setAssignedTo('')
      setOpen(false)
    } finally { setSaving(false) }
  }

  if (!open) return (
    <button onClick={show}
      className="text-xs font-semibold text-gray-500 hover:text-gray-800 border border-dashed border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded-lg transition-colors">
      + Add Other task
    </button>
  )

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm">
      <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Task title…" required
        className="flex-1 text-sm border-none outline-none bg-transparent" />
      <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
        className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600">
        <option value="">Unassigned</option>
        {DELEGATES.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      <button type="submit" disabled={saving || !title.trim()}
        className="text-xs font-semibold bg-gray-900 text-white px-3 py-1 rounded disabled:opacity-40">
        {saving ? '…' : 'Save'}
      </button>
      <button type="button" onClick={() => { setOpen(false); setTitle(''); setAssignedTo('') }}
        className="text-gray-400 hover:text-gray-600 text-xs px-1">✕</button>
    </form>
  )
}

function daysOpen(createdAt) {
  return Math.floor((Date.now() - new Date(createdAt)) / 86400000)
}

// Mirror of server constants for client-side category derivation
const CLIENT_FACING_TYPES = [
  'FOLLOW UP WITH CLIENT',
  'SET UP CLASS ON CALENDAR AND SEND CONFIRMATION EMAIL',
  'FOLLOW UP ON BLAST RESPONSES',
  'ADD TO RECRUITING / SEND BLAST',
]
const INSTRUCTOR_FACING_TYPES = [
  'FOLLOW UP WITH INSTRUCTOR',
  'INSTRUCTOR AWAY - INFORM ALL CLIENTS',
]

function getItemCategories(item) {
  if (item.categories?.length) return item.categories
  if (item.source === 'recruiting') return ['recruiting']
  if (item.source === 'standalone') return [item.task_type || 'task']
  const typeNames = (item.action_types || []).map(at => at.name)
  const cats = []
  if (typeNames.some(n => CLIENT_FACING_TYPES.includes(n))) cats.push('client_followup')
  if (typeNames.some(n => INSTRUCTOR_FACING_TYPES.includes(n))) cats.push('instructor_followup')
  return cats.length ? cats : ['other']
}

const CATEGORY_FILTERS = [
  { key: 'all',                 label: 'All' },
  { key: 'client_followup',     label: 'Client F/U' },
  { key: 'instructor_followup', label: 'Instructor F/U' },
  { key: 'recruiting',          label: 'Recruiting' },
  { key: 'reference',           label: 'Reference' },
  { key: 'other',               label: 'Other' },
]

function MyTaskRow({ item, onClick }) {
  const days = daysOpen(item.created_at)
  const isRecruiting = item.source === 'recruiting'
  const isReference  = item.task_type === 'reference'
  const actionTypes  = item.action_types || []

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors ${
        item.starred ? 'bg-yellow-50/60 hover:bg-yellow-50' : 'hover:bg-gray-50'
      }`}
    >
      <td className="px-3 py-2.5 text-sm text-gray-900 whitespace-nowrap">
        {item.client_name || <span className="text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-600 whitespace-nowrap">
        {item.instructor_name || <span className="text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2.5">
        {isRecruiting ? (
          <span className="inline-block text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-wide">
            Recruiting ↗
          </span>
        ) : isReference ? (
          <span className="inline-block text-[10px] font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full uppercase tracking-wide">
            Reference
          </span>
        ) : actionTypes.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {actionTypes.map(at => <ActionTypeBadge key={at.id} name={at.name} color={at.color} />)}
          </div>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-right">
        <span className="text-xs font-semibold tabular-nums text-gray-500">{days}d</span>
      </td>
      <td className="px-3 py-2.5 max-w-xs">
        {item.last_note ? (
          <span className="text-xs text-gray-500 truncate block max-w-[180px]">
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

export default function MyTasksPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState([])
  const [delegateName, setDelegateName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')

  function handleAddOther(newTask) {
    setTasks(prev => [{ ...newTask, source: 'standalone', categories: ['other'] }, ...prev])
  }

  useEffect(() => {
    api.myTasks()
      .then(({ tasks: t, delegate_name }) => {
        setTasks(t)
        setDelegateName(delegate_name)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const displayTasks = useMemo(() => {
    if (categoryFilter === 'all') return tasks
    return tasks.filter(t => getItemCategories(t).includes(categoryFilter))
  }, [tasks, categoryFilter])

  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  function handleClick(item) {
    if (item.source === 'recruiting' && item.recruiting_entry_id) {
      navigate(`/recruiting?entry=${item.recruiting_entry_id}`)
    } else if (item.source === 'recruiting') {
      navigate('/recruiting')
    } else if (item.source === 'standalone') {
      navigate('/tasks')
    } else if (item.case_id) {
      navigate(`/cases/${item.case_id}`)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Tasks</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {delegateName
              ? `Open action items assigned to ${delegateName}`
              : `No delegate match found for ${user?.name?.split(' ')[0]} — showing all`}
          </p>
        </div>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
          {displayTasks.length}{displayTasks.length !== tasks.length ? ` of ${tasks.length}` : ''} total
        </span>
      </div>

      {/* Type filter */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mr-1">Type:</span>
        {CATEGORY_FILTERS.map(({ key, label }) => (
          <button key={key} onClick={() => setCategoryFilter(key)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              categoryFilter === key
                ? key === 'recruiting'          ? 'bg-amber-500 text-white'
                : key === 'client_followup'     ? 'bg-green-600 text-white'
                : key === 'instructor_followup' ? 'bg-blue-600 text-white'
                : key === 'reference'           ? 'bg-purple-600 text-white'
                : 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {label}
          </button>
        ))}
        {categoryFilter !== 'all' && (
          <button onClick={() => setCategoryFilter('all')} className="text-xs text-gray-400 hover:text-gray-700 ml-1">
            ✕ clear
          </button>
        )}
        {categoryFilter === 'other' && (
          <QuickAddOther onAdd={handleAddOther} />
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-16 text-center">
          <p className="text-2xl mb-2">✓</p>
          <p className="text-sm font-medium text-gray-700">All caught up!</p>
          <p className="text-xs text-gray-400 mt-1">No open tasks assigned to you.</p>
        </div>
      ) : displayTasks.length === 0 ? (
        <p className="text-sm text-gray-400 italic px-2">No items match the current filter.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Instructor</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Type / Action</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Age</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Last note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayTasks.map(item => (
                  <MyTaskRow
                    key={`${item.source}-${item.id}`}
                    item={item}
                    onClick={() => handleClick(item)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
