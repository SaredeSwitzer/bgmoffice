import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import ActionTypeBadge from '../components/ActionTypeBadge'

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

function StarButton({ starred, onToggle }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle() }}
      title={starred ? 'Unstar' : 'Star this item'}
      className={`text-base leading-none transition-colors ${
        starred ? 'text-yellow-400 hover:text-yellow-500' : 'text-gray-300 hover:text-yellow-300'
      }`}
    >
      {starred ? '★' : '☆'}
    </button>
  )
}

function SortTh({ label, col, sortCol, sortDir, onSort, className = '' }) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 whitespace-nowrap ${className}`}
    >
      {label}
      <span className="ml-1 inline-block w-3 text-center">
        {active ? (sortDir === 'asc' ? '↑' : '↓') : <span className="text-gray-300">↕</span>}
      </span>
    </th>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getItemUrl(item) {
  if (item.source === 'recruiting') {
    return item.recruiting_entry_id ? `/recruiting?entry=${item.recruiting_entry_id}` : '/recruiting'
  }
  if (item.source === 'standalone') return `/tasks?id=${item.id}`
  if (item.case_id) return `/cases/${item.case_id}`
  return null
}

// ── Task row ──────────────────────────────────────────────────────────────────

function TaskRow({ item, onClick, isOwn, onStar }) {
  const url = getItemUrl(item)

  function handleClick(e) {
    if (url && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    onClick()
  }

  function handleAuxClick(e) {
    if (e.button === 1 && url) {
      e.preventDefault()
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }
  const days = daysOpen(item.created_at)
  const isRecruiting = item.source === 'recruiting'
  const isReference  = item.task_type === 'reference'
  const actionTypes = item.action_types || []

  return (
    <tr
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      className={`group cursor-pointer transition-colors hover:bg-gray-50 ${
        item.starred ? 'bg-yellow-50/60 hover:bg-yellow-50'
        : isOwn      ? 'bg-blue-50/40 hover:bg-blue-50'
        : ''
      }`}
    >
      <td className="px-2 py-2.5 w-7">
        <StarButton starred={!!item.starred} onToggle={() => onStar(item, !item.starred)} />
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="text-sm text-gray-900">{item.client_name || <span className="text-gray-400">—</span>}</div>
        {item.case_title && <div className="text-xs text-gray-400 truncate max-w-[160px]">{item.case_title}</div>}
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-600 whitespace-nowrap">
        {item.instructor_name || <span className="text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2.5">
        {isRecruiting ? (
          <span className="inline-block text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">
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
          <span className="text-gray-300 text-xs">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <DelegateChip name={item.delegate_name} />
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-right">
        <span className="text-xs font-semibold tabular-nums text-gray-500">{days}d</span>
      </td>
      <td className="px-3 py-2.5 max-w-xs">
        {item.last_note ? (
          <span className="text-xs text-gray-500 truncate block max-w-[200px]">
            <span className="font-medium text-gray-700">{item.last_note.author_initials}: </span>
            {item.last_note.text}
          </span>
        ) : (
          <span className="text-xs text-gray-400 italic">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 w-7 text-center">
        {url && (
          <button
            onClick={e => { e.stopPropagation(); window.open(url, '_blank', 'noopener,noreferrer') }}
            title="Open in new tab"
            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-blue-500 transition-all text-base leading-none"
          >
            ↗
          </button>
        )}
      </td>
    </tr>
  )
}

// ── Filter constants ──────────────────────────────────────────────────────────

const FILTER_ALL     = 'all'
const FILTER_ANYONE  = '__anyone__'
const FILTER_STARRED = '__starred__'

// Mirror of server constants — used for client-side category fallback
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

// ── Open Tasks table ──────────────────────────────────────────────────────────

function OpenTasksTable({ items, onRowClick, myDelegateName, delegates, onStar }) {
  const [delegateFilter,  setDelegateFilter]  = useState(FILTER_ALL)
  const [categoryFilter,  setCategoryFilter]  = useState('all')
  const [sortCol,         setSortCol]         = useState(null)
  const [sortDir,         setSortDir]         = useState('asc')

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const displayItems = useMemo(() => {
    let filtered = [...items]

    if (delegateFilter === FILTER_ANYONE)       filtered = filtered.filter(i => !i.delegate_name)
    else if (delegateFilter === FILTER_STARRED)  filtered = filtered.filter(i => i.starred)
    else if (delegateFilter !== FILTER_ALL)      filtered = filtered.filter(i => i.delegate_name === delegateFilter)

    if (categoryFilter !== 'all')
      filtered = filtered.filter(i => getItemCategories(i).includes(categoryFilter))

    filtered.sort((a, b) => {
      if ((b.starred ? 0 : 1) !== (a.starred ? 0 : 1)) return (a.starred ? 0 : 1) - (b.starred ? 0 : 1)
      if (delegateFilter === FILTER_ALL && myDelegateName) {
        const ownA = a.delegate_name === myDelegateName ? 0 : 1
        const ownB = b.delegate_name === myDelegateName ? 0 : 1
        if (ownA !== ownB) return ownA - ownB
      }
      let cmp = 0
      if (sortCol === 'client')     cmp = (a.client_name     || '').localeCompare(b.client_name     || '')
      if (sortCol === 'instructor') cmp = (a.instructor_name || '').localeCompare(b.instructor_name || '')
      if (sortCol === 'action')     cmp = (a.action_type_name || '').localeCompare(b.action_type_name || '')
      if (sortCol === 'delegate')   cmp = (a.delegate_name   || '').localeCompare(b.delegate_name   || '')
      if (sortCol === 'age')        cmp = new Date(a.created_at) - new Date(b.created_at)
      if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp
      return new Date(a.created_at) - new Date(b.created_at)
    })

    return filtered
  }, [items, delegateFilter, categoryFilter, sortCol, sortDir, myDelegateName])

  const delegateFilters = [
    { key: FILTER_ALL,     label: 'All' },
    { key: FILTER_STARRED, label: '★ Starred' },
    { key: FILTER_ANYONE,  label: 'Anyone' },
    ...delegates.map(d => ({ key: d.name, label: d.name })),
  ]

  const hasFilters = delegateFilter !== FILTER_ALL || categoryFilter !== 'all'

  function resetFilters() {
    setDelegateFilter(FILTER_ALL)
    setCategoryFilter('all')
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-3 pl-1 border-l-4 border-gray-300 text-gray-700">
        <h2 className="text-sm font-bold uppercase tracking-widest">Open Tasks</h2>
        <span className="text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
          {displayItems.length}{displayItems.length !== items.length ? ` of ${items.length}` : ''}
        </span>
        {hasFilters && (
          <button onClick={resetFilters} className="text-xs text-gray-400 hover:text-gray-700 ml-1">
            ✕ clear filters
          </button>
        )}
      </div>

      <div className="mb-3 space-y-2">
        {/* Assignee filter */}
        <div className="flex flex-wrap gap-1.5">
          {delegateFilters.map(({ key, label }) => (
            <button key={key} onClick={() => setDelegateFilter(key)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                delegateFilter === key
                  ? key === FILTER_STARRED ? 'bg-yellow-400 text-white' : 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Category filter */}
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
        </div>
      </div>

      {displayItems.length === 0 ? (
        <p className="text-sm text-gray-400 italic px-2 py-4">
          {hasFilters ? 'No items match the current filters.' : 'No open tasks — all caught up!'}
        </p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[580px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-2 py-2 w-7" />
                  <SortTh label="Client"     col="client"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Instructor" col="instructor" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Action"     col="action"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Assigned"   col="delegate"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Age"        col="age"        sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Note / Task</th>
                  <th className="px-2 py-2 w-7" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayItems.map(item => (
                  <TaskRow
                    key={`${item.source || 'ai'}-${item.id}`}
                    item={item}
                    isOwn={delegateFilter === FILTER_ALL && !!myDelegateName && item.delegate_name === myDelegateName}
                    onClick={() => onRowClick(item)}
                    onStar={onStar}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const [data,              setData]              = useState(null)
  const [delegates,         setDelegates]         = useState([])
  const [completedPackages, setCompletedPackages] = useState([])
  const [error,             setError]             = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([api.dashboard(), api.getDelegates(), api.getRecentlyCompletedPackages()])
      .then(([d, dels, pkgs]) => { setData(d); setDelegates(dels); setCompletedPackages(pkgs) })
      .catch(e => setError(e.message))
  }, [])

  const myDelegateName = useMemo(() => {
    if (!user || !delegates.length) return null
    const firstName = user.name.split(' ')[0].toLowerCase()
    return delegates.find(d => d.name.toLowerCase() === firstName)?.name || null
  }, [user, delegates])

  const handleStar = useCallback(async (item, starred) => {
    if (item.source === 'recruiting' || item.source === 'standalone') {
      await api.starTask(item.id, starred)
    } else {
      await api.starActionItem(item.id, starred)
    }
    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        open_tasks: prev.open_tasks.map(i =>
          i.id === item.id && i.source === item.source ? { ...i, starred: starred ? 1 : 0 } : i
        ),
      }
    })
  }, [])

  function handleRowClick(item) {
    if (item.source === 'recruiting' && item.recruiting_entry_id) {
      navigate(`/recruiting?entry=${item.recruiting_entry_id}`)
    } else if (item.source === 'recruiting') {
      navigate('/recruiting')
    } else if (item.source === 'standalone') {
      navigate(`/tasks?id=${item.id}`)
    } else if (item.case_id) {
      navigate(`/cases/${item.case_id}`)
    }
  }

  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (!data)  return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="space-y-8">
      {completedPackages.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-green-700 mb-3">
            🎉 Packages Completed (Last 7 Days)
            <span className="ml-2 text-xs font-semibold bg-green-200 text-green-800 px-1.5 py-0.5 rounded-full normal-case tracking-normal">
              {completedPackages.length}
            </span>
          </h2>
          <div className="space-y-2">
            {completedPackages.map(pkg => (
              <div key={pkg.id} className="flex items-center justify-between gap-3 bg-white border border-green-100 rounded-xl px-4 py-2.5">
                <div>
                  <span className="text-sm font-semibold text-gray-800">{pkg.client_name}</span>
                  <span className="text-xs text-gray-500 ml-2">{pkg.total_classes}-class package</span>
                  {pkg.instructor_name && <span className="text-xs text-gray-400 ml-2">w/ {pkg.instructor_name}</span>}
                  {pkg.last_session && (
                    <span className="text-xs text-gray-400 ml-2">
                      — last session {new Date(pkg.last_session + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
                <button onClick={() => navigate(`/clients/${pkg.client_id}`)}
                  className="text-xs text-blue-600 hover:underline flex-shrink-0">View client →</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <OpenTasksTable
        items={data.open_tasks}
        onRowClick={handleRowClick}
        delegates={delegates}
        myDelegateName={myDelegateName}
        onStar={handleStar}
      />
    </div>
  )
}
