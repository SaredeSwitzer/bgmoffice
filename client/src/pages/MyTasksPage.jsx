import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import ActionTypeBadge from '../components/ActionTypeBadge'

function daysOpen(createdAt) {
  return Math.floor((Date.now() - new Date(createdAt)) / 86400000)
}

function MyTaskRow({ item, onClick }) {
  const days = daysOpen(item.created_at)
  const isOverdue = days > 7
  const isPriority = item.action_type_name === 'PRIORITY'

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors ${
        isPriority
          ? 'bg-red-50 hover:bg-red-100'
          : isOverdue
          ? 'bg-red-50 hover:bg-red-100'
          : 'hover:bg-gray-50'
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
      <td className="px-4 py-3 whitespace-nowrap text-right">
        <span className={`text-xs font-semibold tabular-nums ${
          isPriority ? 'text-red-700' : isOverdue ? 'text-red-600' : 'text-gray-500'
        }`}>
          {days}d
          {isOverdue && !isPriority && (
            <span className="ml-1 font-bold">!</span>
          )}
          {isPriority && <span className="ml-1 font-bold">↑</span>}
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

export default function MyTasksPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState([])
  const [delegateName, setDelegateName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.myTasks()
      .then(({ tasks: t, delegate_name }) => {
        setTasks(t)
        setDelegateName(delegate_name)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const overdue = tasks.filter(t => daysOpen(t.created_at) > 7 && t.action_type_name !== 'PRIORITY')
  const priority = tasks.filter(t => t.action_type_name === 'PRIORITY')

  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Tasks</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {delegateName
              ? `Open action items assigned to ${delegateName}`
              : `No delegate match found for ${user?.name?.split(' ')[0]} — showing all`}
          </p>
        </div>

        {/* Summary chips */}
        <div className="flex items-center gap-2">
          {priority.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
              ↑ {priority.length} priority
            </span>
          )}
          {overdue.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 text-red-600 text-xs font-semibold border border-red-200">
              ! {overdue.length} overdue
            </span>
          )}
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
            {tasks.length} total
          </span>
        </div>
      </div>

      {/* Table */}
      {tasks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-16 text-center">
          <p className="text-2xl mb-2">✓</p>
          <p className="text-sm font-medium text-gray-700">All caught up!</p>
          <p className="text-xs text-gray-400 mt-1">No open tasks assigned to you.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Instructor</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Age</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Last note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tasks.map(item => (
                <MyTaskRow
                  key={item.id}
                  item={item}
                  onClick={() => navigate(`/cases/${item.case_id}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
