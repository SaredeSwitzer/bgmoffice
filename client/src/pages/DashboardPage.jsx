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

// ── Star button ───────────────────────────────────────────────────────────────

function StarButton({ starred, onToggle, size = 'sm' }) {
  const sz = size === 'sm' ? 'text-base' : 'text-lg'
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle() }}
      title={starred ? 'Unstar' : 'Star this item'}
      className={`transition-colors ${sz} leading-none ${
        starred ? 'text-yellow-400 hover:text-yellow-500' : 'text-gray-200 hover:text-yellow-300'
      }`}
    >
      ★
    </button>
  )
}

// ── Sortable column header ────────────────────────────────────────────────────

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

// ── Task row ──────────────────────────────────────────────────────────────────

function TaskRow({ item, onClick, isOwn, onStar }) {
  const days = daysOpen(item.created_at)
  const isOverdue = days > 7
  const isPriority = item.action_type_name === 'PRIORITY'

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors hover:bg-gray-50 ${
        isPriority
          ? 'bg-red-50 hover:bg-red-100'
          : item.starred
          ? 'bg-yellow-50/60 hover:bg-yellow-50'
          : isOwn
          ? 'bg-blue-50/40 hover:bg-blue-50'
          : isOverdue
          ? 'bg-amber-50 hover:bg-amber-100'
          : ''
      }`}
    >
      <td className="px-2 py-2.5 w-7">
        <StarButton starred={!!item.starred} onToggle={() => onStar(item.id, !item.starred)} />
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-900 whitespace-nowrap">
        {item.client_name || <span className="text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-600 whitespace-nowrap">
        {item.instructor_name || <span className="text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2.5">
        <ActionTypeBadge name={item.action_type_name} color={item.action_type_color} />
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <DelegateChip name={item.delegate_name} />
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-right">
        <span className={`text-xs font-semibold tabular-nums ${
          isPriority ? 'text-red-700' : isOverdue ? 'text-amber-700' : 'text-gray-500'
        }`}>
          {days}d
          {isOverdue && !isPriority && <span className="ml-1 text-amber-600 font-bold">!</span>}
          {isPriority && <span className="ml-1 text-red-600 font-bold">↑</span>}
        </span>
      </td>
      <td className="px-3 py-2.5 max-w-xs">
        {item.last_note ? (
          <span className="text-xs text-gray-500 truncate block max-w-[180px]">
            <span className="font-medium text-gray-700">{item.last_note.author_initials}:</span>{' '}
            {item.last_note.text}
          </span>
        ) : (
          <span className="text-xs text-gray-400 italic">—</span>
        )}
      </td>
    </tr>
  )
}

// ── Filter / sort constants ───────────────────────────────────────────────────

const FILTER_ALL     = 'all'
const FILTER_ANYONE  = '__anyone__'
const FILTER_STARRED = '__starred__'

const AGE_OPTIONS = [
  { value: 'all',     label: 'All ages' },
  { value: 'overdue', label: 'Overdue (>7d)' },
  { value: 'new',     label: 'New (≤7d)' },
]

// ── Section table ─────────────────────────────────────────────────────────────

function SectionTable({ title, items, emptyMsg, onRowClick, accent, myDelegateName, showFilter, delegates, onStar }) {
  const accentMap = {
    gray:  'border-gray-300 text-gray-700',
    green: 'border-green-400 text-green-700',
    blue:  'border-blue-400 text-blue-700',
  }

  const [delegateFilter,   setDelegateFilter]   = useState(() => myDelegateName || FILTER_ALL)
  const [actionTypeFilter, setActionTypeFilter] = useState(FILTER_ALL)
  const [ageFilter,        setAgeFilter]        = useState(FILTER_ALL)
  const [sortCol,          setSortCol]          = useState(null)
  const [sortDir,          setSortDir]          = useState('asc')

  useEffect(() => {
    if (myDelegateName) setDelegateFilter(myDelegateName)
  }, [myDelegateName])

  // Unique action types present in this section
  const availableActionTypes = useMemo(() =>
    [...new Map(items.map(i => [i.action_type_name, { name: i.action_type_name }])).values()]
      .sort((a, b) => a.name.localeCompare(b.name))
  , [items])

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const displayItems = useMemo(() => {
    let filtered = [...items]

    // Delegate filter
    if (delegateFilter === FILTER_ANYONE)  filtered = filtered.filter(i => !i.delegate_name)
    else if (delegateFilter === FILTER_STARRED) filtered = filtered.filter(i => i.starred)
    else if (delegateFilter !== FILTER_ALL) filtered = filtered.filter(i => i.delegate_name === delegateFilter)

    // Action type filter
    if (actionTypeFilter !== FILTER_ALL)
      filtered = filtered.filter(i => i.action_type_name === actionTypeFilter)

    // Age filter
    if (ageFilter === 'overdue') filtered = filtered.filter(i => daysOpen(i.created_at) > 7)
    if (ageFilter === 'new')     filtered = filtered.filter(i => daysOpen(i.created_at) <= 7)

    // Sort
    filtered.sort((a, b) => {
      // Fixed tiers: PRIORITY → starred → rest
      const tierA = a.action_type_name === 'PRIORITY' ? 0 : a.starred ? 1 : 2
      const tierB = b.action_type_name === 'PRIORITY' ? 0 : b.starred ? 1 : 2
      if (tierA !== tierB) return tierA - tierB

      // Within own-tasks tier (All view)
      if (delegateFilter === FILTER_ALL && myDelegateName) {
        const ownA = a.delegate_name === myDelegateName ? 0 : 1
        const ownB = b.delegate_name === myDelegateName ? 0 : 1
        if (ownA !== ownB) return ownA - ownB
      }

      // User-selected column sort
      let cmp = 0
      if (sortCol === 'client')     cmp = (a.client_name     || '').localeCompare(b.client_name     || '')
      if (sortCol === 'instructor') cmp = (a.instructor_name || '').localeCompare(b.instructor_name || '')
      if (sortCol === 'action')     cmp = (a.action_type_name || '').localeCompare(b.action_type_name || '')
      if (sortCol === 'delegate')   cmp = (a.delegate_name   || '').localeCompare(b.delegate_name   || '')
      if (sortCol === 'age')        cmp = new Date(a.created_at) - new Date(b.created_at)
      if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp

      // Default secondary: oldest first
      return new Date(a.created_at) - new Date(b.created_at)
    })

    return filtered
  }, [items, delegateFilter, actionTypeFilter, ageFilter, sortCol, sortDir, myDelegateName])

  const delegateFilters = [
    { key: FILTER_ALL,     label: 'All' },
    { key: FILTER_STARRED, label: '★ Starred' },
    { key: FILTER_ANYONE,  label: 'Anyone' },
    ...delegates.map(d => ({ key: d.name, label: d.name })),
  ]

  const hasFilters = delegateFilter !== (myDelegateName || FILTER_ALL)
    || actionTypeFilter !== FILTER_ALL
    || ageFilter !== FILTER_ALL

  function resetFilters() {
    setDelegateFilter(myDelegateName || FILTER_ALL)
    setActionTypeFilter(FILTER_ALL)
    setAgeFilter(FILTER_ALL)
  }

  return (
    <section>
      {/* Section header */}
      <div className={`flex items-center gap-2 mb-3 pl-1 border-l-4 ${accentMap[accent] || accentMap.gray}`}>
        <h2 className="text-sm font-bold uppercase tracking-widest">{title}</h2>
        <span className="text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
          {displayItems.length}
          {displayItems.length !== items.length ? ` of ${items.length}` : ''}
        </span>
        {hasFilters && (
          <button onClick={resetFilters} className="text-xs text-gray-400 hover:text-gray-700 ml-1">
            ✕ clear filters
          </button>
        )}
      </div>

      {/* Delegate pills + extra filter dropdowns */}
      {(showFilter || true) && (
        <div className="mb-3 space-y-2">
          {/* Delegate pills */}
          <div className="flex flex-wrap gap-1.5">
            {delegateFilters.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setDelegateFilter(key)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  delegateFilter === key
                    ? key === FILTER_STARRED ? 'bg-yellow-400 text-white' : 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Action type + age dropdowns */}
          <div className="flex flex-wrap gap-2">
            <select
              value={actionTypeFilter}
              onChange={e => setActionTypeFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-gray-300"
            >
              <option value={FILTER_ALL}>All action types</option>
              {availableActionTypes.map(at => (
                <option key={at.name} value={at.name}>{at.name}</option>
              ))}
            </select>
            <select
              value={ageFilter}
              onChange={e => setAgeFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-gray-300"
            >
              {AGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {displayItems.length === 0 ? (
        <p className="text-sm text-gray-400 italic px-2 py-4">
          {hasFilters ? 'No items match the current filters.' : emptyMsg}
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
                  <SortTh label="Delegate"   col="delegate"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Age"        col="age"        sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Last note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayItems.map(item => (
                  <TaskRow
                    key={item.id}
                    item={item}
                    isOwn={delegateFilter === FILTER_ALL && !!myDelegateName && item.delegate_name === myDelegateName}
                    onClick={() => onRowClick(item.case_id)}
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
  const [data, setData] = useState(null)
  const [delegates, setDelegates] = useState([])
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([api.dashboard(), api.getDelegates()])
      .then(([d, dels]) => { setData(d); setDelegates(dels) })
      .catch(e => setError(e.message))
  }, [])

  const myDelegateName = useMemo(() => {
    if (!user || !delegates.length) return null
    const firstName = user.name.split(' ')[0].toLowerCase()
    return delegates.find(d => d.name.toLowerCase() === firstName)?.name || null
  }, [user, delegates])

  // Update starred in all three lists without a full refetch
  const handleStar = useCallback(async (itemId, starred) => {
    await api.starActionItem(itemId, starred)
    setData(prev => {
      if (!prev) return prev
      const update = list => list.map(i => i.id === itemId ? { ...i, starred: starred ? 1 : 0 } : i)
      return {
        open_tasks:           update(prev.open_tasks),
        client_followups:     update(prev.client_followups),
        instructor_followups: update(prev.instructor_followups),
      }
    })
  }, [])

  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (!data)  return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>

  const shared = { onRowClick: id => navigate(`/cases/${id}`), delegates, myDelegateName, onStar: handleStar }

  return (
    <div className="space-y-8">
      <SectionTable title="Open Tasks"           items={data.open_tasks}           emptyMsg="No open tasks — all caught up!"    accent="gray"  {...shared} />
      <SectionTable title="Client Follow-ups"    items={data.client_followups}     emptyMsg="No open client follow-ups."        accent="green" {...shared} />
      <SectionTable title="Instructor Follow-ups" items={data.instructor_followups} emptyMsg="No open instructor follow-ups."    accent="blue"  {...shared} />
    </div>
  )
}
