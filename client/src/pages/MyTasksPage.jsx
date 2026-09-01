import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import ActionTypeBadge from '../components/ActionTypeBadge'
import { useSeenTasks } from '../hooks/useSeenTasks'
import { ClientLink, InstructorLink } from '../components/NameLink'
import CollapsibleSection from '../components/CollapsibleSection'
import NeedsApproval from '../components/NeedsApproval'
import MentionThread from '../components/MentionThread'
import InlineWorkPanel from '../components/InlineWorkPanel'
import Modal from '../components/Modal'
import WaitingSheet from '../components/WaitingSheet'
import { LatestHandoff, WriteHandoff } from '../components/ShiftHandoff'

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

// Ids are only unique within their own table, so a row is identified by both.
function rowKey(item) {
  return `${item.source}-${item.id}`
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
            @Mentioned
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
  // Which row is expanded inline. One at a time — this is a queue you work through,
  // not a set of windows to keep open. Keyed by source+id because a task and a
  // reminder can both be id 12.
  const [openMentionId, setOpenMentionId] = useState(null)
  const [openItemKey, setOpenItemKey] = useState(null)
  // My Tasks is now two views: the shift queue, and the waiting-on working sheet.
  // Remembered so somebody mid-shift doesn't land back on the wrong one every visit.
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('bgm_mytasks_view') || 'queue' } catch { return 'queue' }
  })
  useEffect(() => {
    try { localStorage.setItem('bgm_mytasks_view', view) } catch { /* private mode */ }
  }, [view])
  const [mentionableUsers, setMentionableUsers] = useState([])
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

  // Needed so @names inside a note render as names rather than raw "@Sarede" text.
  useEffect(() => {
    api.getMentionableUsers().then(setMentionableUsers).catch(() => setMentionableUsers([]))
  }, [])


  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  function handleClick(item) {
    markSeen(item.id)
    if (item.source === 'mention') {
      // Opens in place rather than navigating away. Reading it no longer marks it
      // read on your behalf either — you say when you're done with it, so a mention
      // you opened but haven't dealt with is still there when you come back.
      setOpenMentionId(prev => (prev === item.id ? null : item.id))
    } else {
      // Everything else opens in place too. The full screen is still one click away
      // from inside the panel, for the times you need the rest of the record.
      setOpenItemKey(prev => (prev === rowKey(item) ? null : rowKey(item)))
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

  // Each pile gets its own section. Splitting them is the whole point — an unassigned item
  // that sat in a mixed list was nobody's job and quietly aged, and an @mention is somebody
  // pulling you into a conversation, not a job that was delegated to you.
  const reminderTasks = tasks.filter(t => t.source === 'reminder')
  // Reminders now cover the whole team, so they split again inside their own section:
  // mine first, everyone else's underneath, so the list stays useful without hiding
  // anything that's due.
  const myReminders    = reminderTasks.filter(t => t.is_mine)
  const otherReminders = reminderTasks.filter(t => !t.is_mine)
  const mentionTasks  = tasks.filter(t => t.source === 'mention')
  const openMention   = mentionTasks.find(t => t.id === openMentionId) || null
  const openItem      = tasks.find(t => rowKey(t) === openItemKey) || null
  const other         = t => t.source !== 'reminder' && t.source !== 'mention'
  const myTasks       = tasks.filter(t => !t.is_anyone && other(t))
  const anyoneTasks   = tasks.filter(t => t.is_anyone && other(t))

  // Finishing something from the panel drops it off the list, same as the row's own
  // tick would, and closes the panel.
  function handleInlineFinish(item) {
    setOpenItemKey(null)
    setTasks(prev => prev.filter(t => rowKey(t) !== rowKey(item)))
  }

  // Opening a row used to expand a panel underneath its table, which meant scrolling to
  // find the thing you just clicked — on a long list it looked like nothing happened.
  // It's a dialog now, rendered once at the bottom of the page.
  function listWithPanel(items) {
    return (
      <TaskTable
        items={items} onClick={handleClick}
        onResolveMention={handleResolveMention} onResolveReminder={handleResolveReminder}
        isNew={isNew}
      />
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
        <h1 className="text-xl font-bold text-gray-900">My Tasks</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {delegateName
            ? `Open action items assigned to ${delegateName}, plus anything you're @mentioned in and every reminder that's due`
            : `No delegate match found for ${user?.name?.split(' ')[0]} — showing anything you're @mentioned in and every reminder that's due`}
        </p>
        </div>
        {/* Finished work files itself away; this is the way back to it. Deliberately
            small and off to the side — it's a lookup, not part of the queue. */}
        <button
          type="button"
          onClick={() => navigate('/tasks?done=1')}
          className="shrink-0 text-xs text-gray-400 hover:text-gray-700 hover:underline whitespace-nowrap mt-1"
        >
          Completed tasks →
        </button>
      </div>

      {/* Two views. The queue is the shift, worked in order; the sheet is the running
          list of who owes us a reply, kept alongside it all shift. */}
      <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm w-fit print:hidden">
        {[['queue', 'My shift'], ['sheet', 'Waiting On']].map(([key, text]) => (
          <button key={key} onClick={() => setView(key)}
            className={`px-3 py-1.5 font-medium ${view === key ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            {text}
          </button>
        ))}
      </div>

      {view === 'sheet' ? (
        <>
          <WaitingSheet />
          <div className="print:hidden pt-2">
            <WriteHandoff />
          </div>
        </>
      ) : (
      <>

      {/* Step 1 of the shift: read what the last person left. */}
      <LatestHandoff />

      <CollapsibleSection id="mytasks_mine" title="Assigned to me" count={myTasks.length} defaultOpen={false}>
        {myTasks.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-12 text-center">
            <p className="text-2xl mb-2">✓</p>
            <p className="text-sm font-medium text-gray-700">All caught up!</p>
            <p className="text-xs text-gray-400 mt-1">Nothing assigned to you right now.</p>
          </div>
        ) : listWithPanel(myTasks)}
      </CollapsibleSection>

      {/* Its own pile rather than mixed into "Assigned to me": a mention is someone pulling
          you into a conversation, which reads and clears differently from a delegated task.
          The read-@mentions list lives here too, since that's the only thing it undoes. */}
      <CollapsibleSection
        id="mytasks_mentions" accent="purple" title="💬 @Mentions"
        count={mentionTasks.length} defaultOpen={false}
      >
        {mentionTasks.length === 0 ? (
          <p className="text-sm text-gray-400 italic px-2">Nobody's tagged you in anything.</p>
        ) : (
          <TaskTable
            items={mentionTasks} onClick={handleClick}
            onResolveMention={handleResolveMention} onResolveReminder={handleResolveReminder}
            isNew={isNew}
          />
        )}

        {readMentions.length > 0 && (
          <div className="mt-3">
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
      </CollapsibleSection>

      <CollapsibleSection
        id="mytasks_reminders" accent="blue" title="Overdue Reminders"
        count={reminderTasks.length} defaultOpen={false}
      >
        {reminderTasks.length === 0 ? (
          <p className="text-sm text-gray-400 italic px-2">Nothing overdue.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 px-1">
                Delegated to me{delegateName ? ` (${delegateName})` : ''} · {myReminders.length}
              </p>
              {myReminders.length === 0 ? (
                <p className="text-sm text-gray-400 italic px-2">Nothing due for you.</p>
              ) : (
                listWithPanel(myReminders)
              )}
            </div>

            {otherReminders.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 px-1">
                  Everyone else &amp; unassigned · {otherReminders.length}
                </p>
                {listWithPanel(otherReminders)}
              </div>
            )}
          </div>
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
            {listWithPanel(anyoneTasks)}
          </>
        )}
      </CollapsibleSection>


      <NeedsApproval />

      </>
      )}

      {/* One dialog for whatever's open — a task, a reminder, or an @mention. Rendered
          once here rather than per-list so it always appears in the middle of the
          screen instead of somewhere below the table you clicked. */}
      {openItem && (
        <Modal onClose={() => setOpenItemKey(null)} labelledBy="inline-work-title">
          <InlineWorkPanel
            item={openItem}
            mentionableUsers={mentionableUsers}
            openPath={getItemUrl(openItem)}
            onFinish={handleInlineFinish}
            onClose={() => setOpenItemKey(null)}
          />
        </Modal>
      )}

      {openMention && (
        <Modal onClose={() => setOpenMentionId(null)} labelledBy="mention-thread-title">
          <MentionThread
            mention={openMention}
            mentionableUsers={mentionableUsers}
            onResolve={m => { setOpenMentionId(null); handleResolveMention(m) }}
            onClose={() => setOpenMentionId(null)}
          />
        </Modal>
      )}



    </div>
  )
}
