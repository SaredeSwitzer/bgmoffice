import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import ActionTypeBadge from '../components/ActionTypeBadge'

function daysOpen(createdAt) {
  return Math.floor((Date.now() - new Date(createdAt)) / 86400000)
}

function DelegateChip({ name }) {
  if (!name) return <span className="text-gray-400 text-xs">—</span>
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
      {name}
    </span>
  )
}

function TaskRow({ item, onClick }) {
  const days = daysOpen(item.created_at)
  const isOverdue = days > 7
  const isPriority = item.action_type_name === 'PRIORITY'

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors hover:bg-gray-50 ${
        isPriority ? 'bg-red-50 hover:bg-red-100' : isOverdue ? 'bg-amber-50 hover:bg-amber-100' : ''
      }`}
    >
      {/* Client */}
      <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
        {item.client_name || <span className="text-gray-400">—</span>}
      </td>

      {/* Instructor */}
      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
        {item.instructor_name || <span className="text-gray-400">—</span>}
      </td>

      {/* Action type badge */}
      <td className="px-4 py-3">
        <ActionTypeBadge name={item.action_type_name} color={item.action_type_color} />
      </td>

      {/* Delegate */}
      <td className="px-4 py-3 whitespace-nowrap">
        <DelegateChip name={item.delegate_name} />
      </td>

      {/* Days open */}
      <td className="px-4 py-3 whitespace-nowrap text-right">
        <span className={`text-xs font-semibold tabular-nums ${
          isPriority ? 'text-red-700' : isOverdue ? 'text-amber-700' : 'text-gray-500'
        }`}>
          {days}d
          {isOverdue && !isPriority && (
            <span className="ml-1 text-amber-600 font-bold">!</span>
          )}
          {isPriority && (
            <span className="ml-1 text-red-600 font-bold">↑</span>
          )}
        </span>
      </td>

      {/* Last note snippet */}
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

function SectionTable({ title, items, emptyMsg, onRowClick, accent }) {
  const accentMap = {
    gray:   'border-gray-300 text-gray-700',
    green:  'border-green-400 text-green-700',
    blue:   'border-blue-400 text-blue-700',
  }
  const accentCls = accentMap[accent] || accentMap.gray

  return (
    <section>
      <div className={`flex items-center gap-2 mb-3 pl-1 border-l-4 ${accentCls}`}>
        <h2 className="text-sm font-bold uppercase tracking-widest">{title}</h2>
        <span className="text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-400 italic px-2 py-4">{emptyMsg}</p>
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
              {items.map(item => (
                <TaskRow
                  key={item.id}
                  item={item}
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

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    api.dashboard()
      .then(setData)
      .catch(e => setError(e.message))
  }, [])

  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (!data) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  return (
    <div className="space-y-8">
      <SectionTable
        title="Open Tasks"
        items={data.open_tasks}
        emptyMsg="No open tasks — all caught up!"
        onRowClick={id => navigate(`/cases/${id}`)}
        accent="gray"
      />
      <SectionTable
        title="Client Follow-ups"
        items={data.client_followups}
        emptyMsg="No open client follow-ups."
        onRowClick={id => navigate(`/cases/${id}`)}
        accent="green"
      />
      <SectionTable
        title="Instructor Follow-ups"
        items={data.instructor_followups}
        emptyMsg="No open instructor follow-ups."
        onRowClick={id => navigate(`/cases/${id}`)}
        accent="blue"
      />
    </div>
  )
}
