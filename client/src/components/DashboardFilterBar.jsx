import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'

export const FILTER_ALL     = 'all'
export const FILTER_ANYONE  = '__anyone__'
export const FILTER_STARRED = '__starred__'

export const CATEGORY_FILTERS = [
  { key: 'all',                 label: 'All' },
  { key: 'client_followup',     label: 'Client F/U' },
  { key: 'instructor_followup', label: 'Instructor F/U' },
  { key: 'recruiting',          label: 'Recruiting' },
  { key: 'reference',           label: 'Reference' },
  { key: 'other',               label: 'Other' },
]

// Renders the two rows of dashboard filter pills.
// On the dashboard: pass activeDelegate/activeCategory + onChange handlers.
// On other pages: omit handlers — clicking navigates to /dashboard?delegate=X&category=Y.
export default function DashboardFilterBar({
  delegates: delegatesProp,
  activeDelegate = FILTER_ALL,
  activeCategory = 'all',
  onDelegateChange,
  onCategoryChange,
}) {
  const navigate = useNavigate()
  const [fetchedDelegates, setFetchedDelegates] = useState([])

  useEffect(() => {
    if (!delegatesProp) api.getDelegates().then(setFetchedDelegates).catch(() => {})
  }, [delegatesProp])

  const delegates = delegatesProp ?? fetchedDelegates

  const delegateFilters = [
    { key: FILTER_ALL,     label: 'All' },
    { key: FILTER_STARRED, label: '★ Starred' },
    { key: FILTER_ANYONE,  label: 'Anyone' },
    ...delegates.map(d => ({ key: d.name, label: d.name })),
  ]

  function handleDelegate(key) {
    if (onDelegateChange) {
      onDelegateChange(key)
    } else {
      navigate(`/dashboard?delegate=${encodeURIComponent(key)}&category=${encodeURIComponent(activeCategory)}`)
    }
  }

  function handleCategory(key) {
    if (onCategoryChange) {
      onCategoryChange(key)
    } else {
      navigate(`/dashboard?delegate=${encodeURIComponent(activeDelegate)}&category=${encodeURIComponent(key)}`)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {delegateFilters.map(({ key, label }) => (
          <button key={key} onClick={() => handleDelegate(key)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              activeDelegate === key
                ? key === FILTER_STARRED ? 'bg-yellow-400 text-white' : 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mr-1">Type:</span>
        {CATEGORY_FILTERS.map(({ key, label }) => (
          <button key={key} onClick={() => handleCategory(key)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              activeCategory === key
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
      </div>
    </div>
  )
}
