import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import ActionTypeBadge from '../components/ActionTypeBadge'
import { useSeenTasks } from '../hooks/useSeenTasks'
import { ClientLink, InstructorLink } from '../components/NameLink'
import WaitingOnOverview from '../components/WaitingOnOverview'
import CollapsibleSection from '../components/CollapsibleSection'

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
        className="text-xs font-semibold bg-gray-900 text-white px-3 py-1 rounded disabled:opacity-50 hover:bg-gray-700 transition-colors">
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

function getItemUrl(item) {
  if (item.source === 'mention') return item.link_path || null
  if (item.source === 'recruiting') {
    return item.recruiting_entry_id ? `/recruiting?entry=${item.recruiting_entry_id}` : '/recruiting'
  }
  if (item.source === 'standalone') return `/tasks?id=${item.id}`
  if (item.source === 'reminder') {
    if (item.client_id) return `/clients/${item.client_id}`
    if (item.instructor_id) return `/instructors/${item.instructor_id}`
    return '/reminders'
  }
  if (item.case_id) return `/cases/${item.case_id}`
  return null
}

function MyTaskRow({ item, onClick, onResolveMention, onResolveReminder, isNew }) {
  const days = daysOpen(item.created_at)
  const isMention    = item.source === 'mention'
  const isRecruiting = item.source === 'recruiting'
  const isReminder   = item.source === 'reminder'
  const actionTypes  = item.action_types || []
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

  return (
    <tr
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      className={`group cursor-pointer transition-colors ${
        item.starred ? 'bg-yellow-50/60 hover:bg-yellow-50'
        : isNew      ? 'bg-blue-50/50 hover:bg-blue-50'
        :              'hover:bg-gray-50'
      }`}
    >
      <td className="px-3 py-2.5 text-sm whitespace-nowrap">
        <span className={`flex items-center gap-1.5 ${isNew ? 'font-bold text-gray-900' : 'text-gray-900'}`}>
          {isNew && <span className="inline-block w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
          {item.client_name ? <ClientLink id={item.client_id} name={item.client_name} /> : <span className="text-gray-400 font-normal">—</span>}
        </span>
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-600 whitespace-nowrap">
        {item.instructor_name ? <InstructorLink id={item.instructor_id} name={item.instructor_name} /> : <span className="text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2.5">
        {isMention ? (
          <span className="inline-block text-[10px] font-semibold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full uppercase tracking-wide">
            @Mentioned ↗
          </span>
        ) : isRecruiting ? (
          <span className="inline-block text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-wide">
            Recruiting ↗
          </span>
        ) : isReminder ? (
          <span className="inline-block text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase tracking-wide">
            Reminder
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
          <span className={`text-xs truncate block max-w-[180px] ${isNew ? 'text-gray-700 font-semibold' : 'text-gray-500'}`}>
            <span className={isNew ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}>{item.last_note.author_initials}:</span>{' '}
            {item.last_note.text}
          </span>
        ) : (
          <span className="text-xs text-gray-400 italic">No notes yet</span>
        )}
      </td>
      <td className="px-2 py-2.5 w-14 text-center whitespace-nowrap">
        {isMention && (
          <button
            onClick={e => { e.stopPropagation(); onResolveMention(item) }}
            title="Dismiss this mention"
            className="text-gray-300 hover:text-gray-700 transition-all text-sm leading-none mr-1.5 font-bold"
          >
            ✕
          </button>
        )}
        {isReminder && (
          <button
            onClick={e => { e.stopPropagation(); onResolveReminder(item) }}
            title="Mark done"
            className="text-gray-300 hover:text-green-600 transition-all text-sm leading-none mr-1.5"
          >
            ✓
          </button>
        )}
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

// One table shared by both sections so the two piles look and behave identically —
// the only difference between them is which items go in.
function TaskTable({ items, onClick, onResolveMention, onResolveReminder, isNew }) {
  return (
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
              <th className="px-2 py-2 w-14" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map(item => (
              <MyTaskRow
                key={`${item.source}-${item.id}`}
                item={item}
                onClick={() => onClick(item)}
                onResolveMention={onResolveMention}
                onResolveReminder={onResolveReminder}
                isNew={isNew(item)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function MyTasksPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { seen, markSeen } = useSeenTasks(user?.initials)
  const [tasks, setTasks] = useState([])
  const [delegateName, setDelegateName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [readMentions, setReadMentions] = useState([])
  const [showRead, setShowRead] = useState(false)

  function isNew(item) {
    return !seen.has(item.id) && item.created_by !== user?.initials
  }

  function handleAddOther(newTask) {
    setTasks(prev => [{ ...newTask, source: 'standalone', categories: ['other'] }, ...prev])
  }

  function load() {
    return api.myTasks()
      .then(({ tasks: t, delegate_name }) => {
        setTasks(t)
        setDelegateName(delegate_name)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  function loadReadMentions() {
    return api.getReadMentions().then(setReadMentions).catch(() => {})
  }

  useEffect(() => { load(); loadReadMentions() }, [])


  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  function handleClick(item) {
    markSeen(item.id)
    if (item.source === 'mention') {
      // Opening it counts as reading it, so it drops off this list rather than sitting
      // here after it's been dealt with. Recoverable via "read @mentions" below.
      setTasks(prev => prev.filter(x => x.id !== item.id))
      api.resolveMention(item.mention_id).then(loadReadMentions).catch(() => {})
      if (item.link_path) navigate(item.link_path)
    } else if (item.source === 'recruiting') {
      navigate(item.recruiting_entry_id ? `/recruiting?entry=${item.recruiting_entry_id}` : '/recruiting')
    } else if (item.source === 'standalone') {
      navigate(`/tasks?id=${item.id}`)
    } else if (item.source === 'reminder') {
      const url = getItemUrl(item)
      if (url) navigate(url)
    } else if (item.case_id) {
      navigate(`/cases/${item.case_id}`)
    }
  }

  async function handleResolveMention(item) {
    setTasks(prev => prev.filter(t => t.id !== item.id))
    try {
      await api.resolveMention(item.mention_id)
    } catch {
      setTasks(prev => [...prev, item])
    }
  }

  async function handleUnreadMention(m) {
    setReadMentions(prev => prev.filter(x => x.mention_id !== m.mention_id))
    try {
      await api.unresolveMention(m.mention_id)
      load()
    } catch {
      setReadMentions(prev => [m, ...prev])
    }
  }

  async function handleResolveReminder(item) {
    setTasks(prev => prev.filter(t => t.id !== item.id))
    try {
      await api.markReminderDone(item.id)
    } catch {
      setTasks(prev => [...prev, item])
    }
  }

  // Two piles: what's yours, and what's up for grabs. Splitting them is the whole point —
  // an unassigned item that sat in a mixed list was nobody's job and quietly aged.
  const myTasks     = tasks.filter(t => !t.is_anyone)
  const anyoneTasks = tasks.filter(t => t.is_anyone)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">My Tasks</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {delegateName
            ? `Open action items and due reminders assigned to ${delegateName}, plus anything you're @mentioned in`
            : `No delegate match found for ${user?.name?.split(' ')[0]} — showing anything you're @mentioned in`}
        </p>
      </div>

      <CollapsibleSection id="mytasks_mine" title="Assigned to me" count={myTasks.length} defaultOpen={false}>
        {myTasks.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-12 text-center">
            <p className="text-2xl mb-2">✓</p>
            <p className="text-sm font-medium text-gray-700">All caught up!</p>
            <p className="text-xs text-gray-400 mt-1">Nothing assigned to you right now.</p>
          </div>
        ) : (
          <TaskTable
            items={myTasks} onClick={handleClick}
            onResolveMention={handleResolveMention} onResolveReminder={handleResolveReminder}
            isNew={isNew}
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id="mytasks_anyone" accent="amber" title="🙋 Anyone — up for grabs"
        count={anyoneTasks.length} defaultOpen={false}
        right={<QuickAddOther onAdd={handleAddOther} />}
      >
        {anyoneTasks.length === 0 ? (
          <p className="text-sm text-gray-400 italic px-2">Nothing unassigned right now.</p>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-2 px-1">
              Not assigned to anyone — Claire, Maria and Sarede all see these.
            </p>
            <TaskTable
              items={anyoneTasks} onClick={handleClick}
              onResolveMention={handleResolveMention} onResolveReminder={handleResolveReminder}
              isNew={isNew}
            />
          </>
        )}
      </CollapsibleSection>

      {/* Collapsible here, unlike the Dashboard: this page is a focused work queue and
          the waiting-on list is reference material you dip into, not the main event. */}
      <WaitingOnOverview id="mytasks_waiting" defaultOpen={false} />

      {readMentions.length > 0 && (
        <div>
          <button onClick={() => setShowRead(v => !v)}
            className="text-xs text-gray-500 hover:text-gray-800 hover:underline">
            {showRead ? 'Hide' : 'Show'} read @mentions ({readMentions.length})
          </button>
          {showRead && (
            <div className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
              {readMentions.map(m => (
                <div key={m.mention_id} className="flex items-start gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-gray-600">
                      <span className="font-semibold text-gray-500">{m.author_initials}:</span> {m.snippet}
                    </p>
                  </div>
                  {m.link_path && (
                    <button onClick={() => navigate(m.link_path)}
                      className="shrink-0 text-[11px] text-blue-600 hover:underline">Open</button>
                  )}
                  <button onClick={() => handleUnreadMention(m)}
                    className="shrink-0 text-[11px] text-gray-400 hover:text-gray-700">Mark unread</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
