import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useSeenTasks } from '../hooks/useSeenTasks'
import ActionTypeBadge from '../components/ActionTypeBadge'
import DashboardFilterBar from '../components/DashboardFilterBar'
import SearchSelect from '../components/SearchSelect'
import MentionTextarea from '../components/MentionTextarea'
import { renderWithMentions } from '../utils/mentions'
import { useHashHighlight } from '../utils/hashHighlight'
import { today } from '../utils/dates'

const DELEGATES = ['Sarede', 'Maria', 'Claire', 'Anyone']

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTs(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Task form (inline create or edit) ────────────────────────────────────────
export function TaskForm({ initial, onSave, onCancel, saving, clients = [], instructors = [] }) {
  const today = today()
  const [form, setForm] = useState(initial || {
    title: '', description: '', assigned_to: '', due_date: '', priority: 'normal', notes: '', task_type: 'task',
    client: null, instructor: null,
  })
  const [mentionableUsers, setMentionableUsers] = useState([])
  useEffect(() => { api.getMentionableUsers().then(setMentionableUsers).catch(() => {}) }, [])
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    onSave({
      ...form,
      client_id: form.client?.id || null,
      instructor_id: form.instructor?.id || null,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
          <input required value={form.title} onChange={e => set('title', e.target.value)}
            placeholder="What needs to be done?" autoFocus
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
          <MentionTextarea value={form.description} onChange={v => set('description', v)} users={mentionableUsers}
            rows={2} placeholder="Optional additional details — type @ to tag someone"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-none" />
        </div>
        <SearchSelect label="Related Client (optional)" options={clients} value={form.client}
          onChange={v => set('client', v)} placeholder="Search clients…" />
        <SearchSelect label="Related Instructor (optional)" options={instructors} value={form.instructor}
          onChange={v => set('instructor', v)} placeholder="Search instructors…" />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Assigned To</label>
          <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300">
            <option value="">Unassigned</option>
            {DELEGATES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Due Date</label>
          <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
          <select value={form.priority} onChange={e => set('priority', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300">
            <option value="normal">Normal</option>
            <option value="urgent">🔴 Urgent</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
          <select value={form.task_type || 'task'} onChange={e => set('task_type', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300">
            <option value="task">Task</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <input value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Optional notes"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50 hover:bg-gray-700">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Task card ─────────────────────────────────────────────────────────────────
function TaskCard({ task, onUpdate, onDelete, onDone, isNew, actionTypes, clients = [], instructors = [], mentionableUsers = [] }) {
  const { user } = useAuth()
  const [editing,         setEditing]         = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [showReply,       setShowReply]       = useState(false)
  const [replyText,       setReplyText]       = useState('')
  const [replyAssign,     setReplyAssign]     = useState('')
  const [replyActionType, setReplyActionType] = useState('')
  const [replies,         setReplies]         = useState(() => {
    try { return task.replies ? JSON.parse(task.replies) : [] } catch { return [] }
  })
  const replyRef = useRef(null)

  const isDone    = task.status === 'done'
  const isUrgent  = task.priority === 'urgent'
  const isOverdue = task.due_date && !isDone && task.due_date < today()

  async function toggle() {
    setSaving(true)
    try {
      const updated = await api.updateTask(task.id, { ...task, status: isDone ? 'open' : 'done' })
      onUpdate(updated)
      // Finishing a task shouldn't leave you staring at the thing you just finished.
      // The page decides where to go next; reopening one never moves you.
      if (!isDone) onDone?.(task)
    } finally { setSaving(false) }
  }

  async function toggleStar() {
    const updated = await api.updateTask(task.id, { ...task, starred: task.starred ? 0 : 1 })
    onUpdate(updated)
  }

  async function handleEdit(form) {
    setSaving(true)
    try {
      const updated = await api.updateTask(task.id, { ...task, ...form })
      onUpdate(updated)
      setEditing(false)
    } finally { setSaving(false) }
  }

  async function handleReply(e) {
    e.preventDefault()
    if (!replyText.trim()) return
    setSaving(true)
    try {
      const opts = {}
      if (replyAssign)     opts.assigned_to    = replyAssign
      if (replyActionType) opts.action_type_id = Number(replyActionType)
      const result = await api.addTaskReply(task.id, replyText.trim(), opts)
      const reply = result.reply ?? result
      setReplies(prev => [...prev, reply])
      if (result.assigned_to !== undefined) {
        onUpdate({ ...task, assigned_to: result.assigned_to })
      }
      setReplyText('')
      setReplyAssign('')
      setReplyActionType('')
      setShowReply(false)
    } finally { setSaving(false) }
  }

  async function handleDeleteReply(replyId) {
    await api.deleteTaskReply(task.id, replyId)
    setReplies(prev => prev.filter(r => r.id !== replyId))
  }

  if (editing) return (
    <TaskForm initial={{ title: task.title, description: task.description || '', assigned_to: task.assigned_to || '',
      due_date: task.due_date || '', priority: task.priority, notes: task.notes || '', task_type: task.task_type || 'task',
      client: task.client_id ? { id: task.client_id, name: task.client_name } : null,
      instructor: task.instructor_id ? { id: task.instructor_id, name: task.instructor_name } : null }}
      onSave={handleEdit} onCancel={() => setEditing(false)} saving={saving} clients={clients} instructors={instructors} />
  )

  return (
    <div id={`note-standalone_tasks-${task.id}`} className={`bg-white border rounded-xl px-4 py-3 transition-colors ${
      isDone ? 'border-gray-100 opacity-70' :
      task.starred ? 'border-yellow-300 bg-yellow-50/40' :
      isUrgent ? 'border-red-200 bg-red-50/30' :
      isNew ? 'border-blue-300 bg-blue-50/30' :
      'border-gray-200'
    }`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className={`text-sm flex-1 ${isDone ? 'line-through text-gray-400 font-normal' : isNew ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'}`}>
          {isNew && !isDone && <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1.5 mb-0.5 align-middle" />}
          {isUrgent && !isDone && <span className="text-red-500 mr-1">🔴</span>}
          {task.title}
        </p>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={toggleStar}
            className={`text-base leading-none ${task.starred ? 'text-yellow-400' : 'text-gray-200 hover:text-yellow-300'}`}>★</button>
          <button onClick={() => setEditing(true)} className="text-xs text-gray-400 hover:text-gray-700 px-1">✎</button>
          <button onClick={() => onDelete(task.id)} className="text-xs text-gray-300 hover:text-red-500 px-1">✕</button>
        </div>
      </div>

      {task.description && <p className="text-xs text-gray-500 mb-2">{renderWithMentions(task.description, mentionableUsers)}</p>}

      {/* Metadata */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-3 text-xs text-gray-400">
        {task.assigned_to && <span className="font-medium text-gray-600">→ {task.assigned_to}</span>}
        {task.client_name && (
          <Link to={`/clients/${task.client_id}`} onClick={e => e.stopPropagation()}
            className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded-full font-medium hover:bg-gray-200">
            👤 {task.client_name}
          </Link>
        )}
        {task.instructor_name && (
          <Link to={`/instructors/${task.instructor_id}`} onClick={e => e.stopPropagation()}
            className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded-full font-medium hover:bg-gray-200">
            🏃 {task.instructor_name}
          </Link>
        )}
        {task.due_date && (
          <span className={isOverdue ? 'text-amber-600 font-semibold' : ''}>
            {isOverdue ? '⚠️ ' : ''}Due {fmtDate(task.due_date)}
          </span>
        )}
        {task.recruiting_note_id && (
          <Link to="/recruiting"
            className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium hover:bg-amber-200">
            ↗ From Recruiting{task.notes ? `: ${task.notes}` : ''}
          </Link>
        )}
        {task.notes && !task.recruiting_note_id && <span className="italic">{task.notes}</span>}
        <span>by {task.created_by} · {fmtTs(task.created_at)}</span>
        {isDone && task.completed_at && (
          <span className="text-green-600">✓ Completed {fmtTs(task.completed_at)}</span>
        )}
      </div>

      {/* Reply thread */}
      {replies.length > 0 && (
        <div className="border-t border-gray-100 pt-2 mb-2 space-y-1.5">
          {replies.map(r => (
            <div key={r.id} id={`note-task_replies-${r.id}`} className="flex gap-2 text-xs items-start group">
              <span className="font-semibold text-gray-500 flex-shrink-0 mt-0.5">{r.author}</span>
              <div className="flex-1 min-w-0">
                {(r.action_type_name || r.assigned_to) && (
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    {r.action_type_name && (
                      <ActionTypeBadge name={r.action_type_name} color={r.action_type_color} size="xs" />
                    )}
                    {r.assigned_to && (
                      <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-semibold">
                        → {r.assigned_to}
                      </span>
                    )}
                  </div>
                )}
                <span className="text-gray-700">{renderWithMentions(r.text, mentionableUsers)}</span>
              </div>
              <span className="text-gray-300 flex-shrink-0">{fmtTs(r.created_at)}</span>
              <button onClick={() => handleDeleteReply(r.id)}
                className="text-gray-300 hover:text-red-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Reply form */}
      {showReply && (
        <form onSubmit={handleReply} className="border-t border-gray-100 pt-2 mb-2 space-y-1.5">
          <div className="flex gap-2">
            <MentionTextarea ref={replyRef} value={replyText} onChange={setReplyText} users={mentionableUsers}
              placeholder={`Reply as ${user?.initials}… (type @ to tag someone)`} rows={1} autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(e) } }}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none" />
            <button type="submit" disabled={saving || !replyText.trim()}
              className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors">
              Send
            </button>
            <button type="button" onClick={() => { setShowReply(false); setReplyText(''); setReplyAssign(''); setReplyActionType('') }}
              className="px-2 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg">
              ✕
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <select value={replyAssign} onChange={e => setReplyAssign(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white text-gray-600">
              <option value="">Assign to…</option>
              {DELEGATES.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            {actionTypes?.length > 0 && (
              <select value={replyActionType} onChange={e => setReplyActionType(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white text-gray-600">
                <option value="">Action type…</option>
                {actionTypes.map(at => <option key={at.id} value={at.id}>{at.name}</option>)}
              </select>
            )}
          </div>
        </form>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <button onClick={toggle} disabled={saving}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
            isDone
              ? 'bg-green-50 border-green-200 text-green-700 hover:bg-white hover:text-gray-600'
              : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-700'
          }`}>
          {saving ? '…' : isDone ? '✓ Done — click to reopen' : '✓ Mark as Done'}
        </button>
        {!isDone && (
          <button onClick={() => { setShowReply(v => !v) }}
            className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50">
            ↩ Reply
          </button>
        )}
      </div>
    </div>
  )
}

// ── Task section (by type) ────────────────────────────────────────────────────
function TaskSection({ label, borderColor, tasks, onUpdate, onDelete, defaultType, isNewFn, actionTypes, clients, instructors, mentionableUsers }) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleCreate(form) {
    setSaving(true)
    try {
      const t = await api.createTask({ ...form, task_type: defaultType })
      onUpdate(t, 'add')
      setShowForm(false)
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-2">
      <div className={`flex items-center justify-between pl-1 border-l-4 ${borderColor}`}>
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">
          {label} ({tasks.length})
        </h2>
        <button onClick={() => setShowForm(v => !v)}
          className="text-xs text-gray-400 hover:text-gray-700 font-medium px-2 py-0.5 rounded hover:bg-gray-100">
          + Add
        </button>
      </div>
      {showForm && (
        <TaskForm
          initial={{ title: '', description: '', assigned_to: '', due_date: '', priority: 'normal', notes: '', task_type: defaultType, client: null, instructor: null }}
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
          saving={saving}
          clients={clients}
          instructors={instructors}
        />
      )}
      {tasks.length === 0 && !showForm ? (
        <p className="text-sm text-gray-400 italic px-2">None yet.</p>
      ) : (
        <div className="space-y-2">
          {tasks
            .sort((a, b) => (b.starred - a.starred) || (b.priority === 'urgent' ? 1 : -1))
            .map(t => (
              <TaskCard key={t.id} task={t} onUpdate={t => onUpdate(t, 'update')} onDelete={onDelete} isNew={isNewFn?.(t)} actionTypes={actionTypes} clients={clients} instructors={instructors} mentionableUsers={mentionableUsers} />
            ))}
        </div>
      )}
    </div>
  )
}

const TYPE_META = {
  other: { label: 'Other', borderColor: 'border-blue-300', defaultType: 'other' },
  task:  { label: 'Tasks', borderColor: 'border-gray-300', defaultType: 'task'  },
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TasksPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Kept as a string — task ids come back from Postgres as bigint strings, and
  // converting to Number() here made the lookup below (String(t.id) === focusId)
  // fail silently for every task, since '64' !== 64. That's what made a task
  // opened via /tasks?id=… show "Task not found" unless it happened to already be
  // in the currently-rendered section.
  const focusId = searchParams.get('id') || null
  const { user } = useAuth()
  const { seen, markSeen } = useSeenTasks(user?.initials)

  const [tasks, setTasks] = useState([])
  const [actionTypes, setActionTypes] = useState([])
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [mentionableUsers, setMentionableUsers] = useState([])
  const [loading, setLoading] = useState(true)
  // /tasks?done=1 lands with the Completed list already open — that's the link on
  // My Tasks for "what did I finish?", and it shouldn't need a second click.
  const [showDone, setShowDone] = useState(searchParams.get('done') === '1')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [theirMentions, setTheirMentions] = useState([])

  const myFirstName = user?.name?.split(' ')[0] || ''
  function isNew(task) {
    if (task.status === 'done') return false
    if (task.created_by === user?.initials) return false
    const assignedToMe = task.assigned_to &&
      task.assigned_to.toLowerCase() === myFirstName.toLowerCase()
    return assignedToMe && !seen.has(task.id)
  }

  useEffect(() => {
    Promise.all([api.getTasks(), api.getActionTypes(), api.getClients(), api.getInstructors(), api.getMentionableUsers()])
      .then(([t, at, c, i, mu]) => { setTasks(t); setActionTypes(at); setClients(c); setInstructors(i); setMentionableUsers(mu) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (focusId) markSeen(focusId)
  }, [focusId])

  // Mentions live on the tagged person's own My Tasks, so tagging someone used to be a
  // one-way street — no way to see whether it landed. Picking a name here shows theirs.
  useEffect(() => {
    if (!filterAssignee) { setTheirMentions([]); return }
    let cancelled = false
    api.getOpenMentionsFor(filterAssignee)
      .then(rows => { if (!cancelled) setTheirMentions(rows) })
      .catch(() => { if (!cancelled) setTheirMentions([]) })
    return () => { cancelled = true }
  }, [filterAssignee])

  useHashHighlight([focusId, tasks])

  function handleSectionUpdate(t, action) {
    if (action === 'add') setTasks(prev => [t, ...prev])
    else setTasks(prev => prev.map(x => x.id === t.id ? t : x))
  }

  async function handleDelete(id) {
    if (!confirm('Delete this task?')) return
    await api.deleteTask(id)
    setTasks(prev => prev.filter(t => t.id !== id))
    if (focusId === String(id)) navigate('/tasks')
  }

  const open = tasks.filter(t => t.status === 'open')
  const done = tasks.filter(t => t.status === 'done')

  function filtered(list) {
    if (!filterAssignee) return list
    return list.filter(t => (t.assigned_to || '') === filterAssignee)
  }

  const assignees = [...new Set(tasks.map(t => t.assigned_to).filter(Boolean))]

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  // A task with no type at all (task_type null/empty — e.g. an older row from
  // before the type field existed) reads as "no category" to whoever's looking at
  // it, so it belongs in Other, not silently in the generic Tasks bucket.
  const openTasks = filtered(open.filter(t => t.task_type === 'task'))
  const openOther = filtered(open.filter(t => t.task_type === 'other' || !t.task_type))

  // ── Focused single-task view ──────────────────────────────────────────────
  if (focusId) {
    const focusedTask = tasks.find(t => String(t.id) === focusId)
    const typeKey = focusedTask?.task_type || 'task'
    const meta = TYPE_META[typeKey] || TYPE_META.task

    // The queue you're working through, in the order the list shows it: yours first,
    // then the up-for-grabs pile. Marking one done walks to the next one in here rather
    // than dumping you back on the list to find your place again.
    const mine = t => {
      const who = (t.assigned_to || '').trim().toLowerCase()
      return !who || who === 'anyone' || who === myFirstName.toLowerCase()
    }
    const queue = open
      .filter(mine)
      .sort((a, b) => (b.starred - a.starred)
                   || (a.due_date || '9999').localeCompare(b.due_date || '9999')
                   || String(a.id).localeCompare(String(b.id)))

    // Where to go after finishing this one. Falls forward to the next task in the
    // queue, wrapping to the start if this was the last, and back to My Tasks when
    // the queue is empty — never a dead end.
    function goToNext(justDone) {
      const rest = queue.filter(t => String(t.id) !== String(justDone.id))
      if (!rest.length) { navigate('/my-tasks'); return }
      const at = queue.findIndex(t => String(t.id) === String(justDone.id))
      const next = rest.find((_, i) => i >= at) || rest[0]
      navigate(`/tasks?id=${next.id}`)
    }

    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <button onClick={() => navigate('/tasks')}
              className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50">
              See all {meta.label} tasks
            </button>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2">Open Tasks</p>
            <DashboardFilterBar />
          </div>
        </div>

        {focusedTask ? (
          <TaskCard
            task={focusedTask}
            onUpdate={t => handleSectionUpdate(t, 'update')}
            onDelete={handleDelete}
            onDone={goToNext}
            actionTypes={actionTypes}
            clients={clients}
            instructors={instructors}
            mentionableUsers={mentionableUsers}
          />
        ) : (
          <p className="text-sm text-gray-400 italic">Task not found.</p>
        )}
      </div>
    )
  }

  // ── Full list view ────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Tasks</h1>
        {assignees.length > 0 && (
          <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300">
            <option value="">All assignees</option>
            {DELEGATES.filter(d => assignees.includes(d)).map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
      </div>

      {filterAssignee && theirMentions.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-blue-400">
            @Mentions waiting on {filterAssignee}
            <span className="ml-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
              {theirMentions.length}
            </span>
          </p>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {theirMentions.map(m => (
              <button key={m.mention_id} type="button"
                onClick={() => m.link_path && navigate(m.link_path)}
                className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-gray-50">
                <span className="shrink-0 text-[11px] font-semibold text-gray-400">{m.author_initials}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-gray-700">{m.snippet}</span>
                {m.link_path && <span className="shrink-0 text-[11px] text-blue-600">Open →</span>}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            These are unread for {filterAssignee} — they clear when {filterAssignee} opens them.
          </p>
        </div>
      )}

      <TaskSection label="Tasks" borderColor="border-gray-300" tasks={openTasks}
        onUpdate={handleSectionUpdate} onDelete={handleDelete} defaultType="task" isNewFn={isNew} actionTypes={actionTypes} clients={clients} instructors={instructors} mentionableUsers={mentionableUsers} />

      <TaskSection label="Other" borderColor="border-blue-300" tasks={openOther}
        onUpdate={handleSectionUpdate} onDelete={handleDelete} defaultType="other" isNewFn={isNew} actionTypes={actionTypes} clients={clients} instructors={instructors} mentionableUsers={mentionableUsers} />

      {/* Completed tasks (collapsible) */}
      {done.length > 0 && (
        <section>
          <button
            onClick={() => setShowDone(v => !v)}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-gray-600 mb-3 pl-1 border-l-4 border-gray-200"
          >
            <span>{showDone ? '▾' : '▸'}</span>
            Completed ({done.length})
          </button>
          {showDone && (
            <div className="space-y-2">
              {filtered(done).map(t => (
                <TaskCard key={t.id} task={t} onUpdate={t => handleSectionUpdate(t, 'update')} onDelete={handleDelete} actionTypes={actionTypes} clients={clients} instructors={instructors} mentionableUsers={mentionableUsers} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
