import { Link } from 'react-router-dom'
import ActionTypeBadge from './ActionTypeBadge'

function daysOpen(createdAt, resolvedAt) {
  const end = resolvedAt ? new Date(resolvedAt) : new Date()
  return Math.floor((end - new Date(createdAt)) / 86400000)
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CaseHistoryList({ cases }) {
  if (!cases.length) return (
    <p className="text-sm text-gray-400 italic px-2 py-4">No cases yet.</p>
  )

  return (
    <div className="space-y-2">
      {cases.map(c => {
        const openItems = (c.action_items || []).filter(i => i.status === 'open')
        const isResolved = c.status === 'resolved'
        return (
          <Link
            key={c.id}
            to={`/cases/${c.id}`}
            className="block bg-white border border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-xs font-bold text-gray-400">Case #{c.id}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                    isResolved ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {isResolved ? 'Resolved' : 'Open'}
                  </span>
                  {!isResolved && openItems.length > 0 && (
                    <span className="text-xs text-gray-500">{openItems.length} open item{openItems.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(c.action_items || []).slice(0, 4).map(ai => (
                    <ActionTypeBadge key={ai.id} name={ai.action_type_name} color={ai.action_type_color} size="xs" />
                  ))}
                  {(c.action_items || []).length > 4 && (
                    <span className="text-xs text-gray-400">+{c.action_items.length - 4} more</span>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-xs text-gray-400">{fmtDate(c.created_at)}</p>
                {!isResolved && (
                  <p className="text-xs text-amber-600 font-medium mt-0.5">{daysOpen(c.created_at)}d open</p>
                )}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
