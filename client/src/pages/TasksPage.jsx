import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import DateInput from '../components/DateInput'

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
function TaskForm({ initial, onSave, onCancel, saving }) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState(initial || {
    title: '', description: '', assigned_to: '', due_date: '', priority: 'normal', notes: '', task_type: 'task',
  })
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
          <input required value={form.title} onChange={e => set('title', e.target.value)}
            placeholder="What needs to be done?" autoFocus
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)}
            rows={2} placeholder="Optional additional details"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Assigned To</label>
          <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="">Unassigned</option>
            {DELEGATES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Due Date</label>
          <DateInput value={form.due_date} onChange={v => set('due_date', v)} className="w-full" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
          <select value={form.priority} onChange={e => set('priority', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="normal">Normal</option>
            <option value="urgent">🔴 Urgent</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
          <select value={form.task_type || 'task'} onChange={e => set('task_type', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="task">Task</option>
            <option value="reference">Reference</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <input value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Optional notes"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
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
function TaskCard({ task, onUpdate, onDelete }) {
  const { user } = useAuth()
  const [editing,    setEditing]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [showReply,  setShowReply]  = useState(false)
  const [replyText,  setReplyText]  = useState('')
  const [replies,    setReplies]    = useState(() => {
    try { return task.replies ? JSON.parse(task.replies) : [] } catch { return [] }
  })
  const replyRef = useRef(null)

  const isDone    = task.status === 'done'
  const isUrgent  = task.priority === 'urgent'
  const isOverdue = task.due_date && !isDone && task.due_date < new Date().toISOString().slice(0, 10)

  async function toggle() {
    setSaving(true)
    try {
      const updated = await api.updateTask(task.id, { ...task, status: isDone ? 'open' : 'done' })
      onUpdate(updated)
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
      const reply = await api.addTaskReply(task.id, replyText.trim())
      setReplies(prev => [...prev, reply])
      setReplyText('')
      setShowReply(false)
    } finally { setSaving(false) }
  }

  async function handleDeleteReply(replyId) {
    await api.deleteTaskReply(task.id, replyId)
    setReplies(prev => prev.filter(r => r.id !== replyId))
  }

  if (editing) return (
    <TaskForm initial={{ title: task.title, description: task.description || '', assigned_to: task.assigned_to || '',
      due_date: task.due_date || '', priority: task.priority, notes: task.notes || '', task_type: task.task_type || 'task' }}
      onSave={handleEdit} onCancel={() => setEditing(false)} saving={saving} />
  )

  return (
    <div className={`bg-white border rounded-xl px-4 py-3 transition-colors ${
      isDone ? 'border-gray-100 opacity-70' :
      task.starred ? 'border-yellow-300 bg-yellow-50/40' :
      isUrgent ? 'border-red-200 bg-red-50/30' :
      'border-gray-200'
    }`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className={`text-sm font-semibold flex-1 ${isDone ? 'line-through text-gray-400' : 'text-gray-900'}`}>
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

      {task.description && <p className="text-xs text-gray-500 mb-2">{task.description}</p>}

      {/* Metadata */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-3 text-xs text-gray-400">
        {task.task_type === 'reference' && (
          <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">Reference</span>
        )}
        {task.assigned_to && <span className="font-medium text-gray-600">→ {task.assigned_to}</span>}
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
            <div key={r.id} className="flex gap-2 text-xs items-start group">
              <span className="font-semibold text-gray-500 flex-shrink-0 mt-0.5">{r.author}</span>
              <span className="text-gray-700 flex-1">{r.text}</span>
              <span className="text-gray-300 flex-shrink-0">{fmtTs(r.created_at)}</span>
              <button onClick={() => handleDeleteReply(r.id)}
                className="text-gray-300 hover:text-red-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Reply form */}
      {showReply && (
        <form onSubmit={handleReply} className="border-t border-gray-100 pt-2 mb-2 flex gap-2">
          <input ref={replyRef} value={replyText} onChange={e => setReplyText(e.target.value)}
            placeholder={`Reply as ${user?.initials}…`} autoFocus
            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <button type="submit" disabled={saving || !replyText.trim()}
            className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg disabled:opacity-40">
            Send
          </button>
          <button type="button" onClick={() => { setShowReply(false); setReplyText('') }}
            className="px-2 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg">
            ✕
          </button>
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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TasksPage() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [filterAssignee, setFilterAssignee] = useState('')

  useEffect(() => {
    api.getTasks().then(setTasks).finally(() => setLoading(false))
  }, [])

  async function handleCreate(form) {
    setSaving(true)
    try {
      const t = await api.createTask(form)
      setTasks(prev => [t, ...prev])
      setShowNew(false)
    } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this task?')) return
    await api.deleteTask(id)
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  function handleUpdate(updated) {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Tasks</h1>
        <div className="flex items-center gap-2">
          {assignees.length > 0 && (
            <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
              <option value="">All assignees</option>
              {DELEGATES.filter(d => assignees.includes(d) || assignees.includes(d)).map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
          <button onClick={() => setShowNew(v => !v)}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors">
            + New Task
          </button>
        </div>
      </div>

      {showNew && (
        <TaskForm onSave={handleCreate} onCancel={() => setShowNew(false)} saving={saving} />
      )}

      {/* Open tasks */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 pl-1 border-l-4 border-gray-300">
          Open ({open.length})
        </h2>
        {filtered(open).length === 0 ? (
          <p className="text-sm text-gray-400 italic px-2">No open tasks.</p>
        ) : (
          <div className="space-y-2">
            {filtered(open)
              .sort((a, b) => (b.starred - a.starred) || (b.priority === 'urgent' ? 1 : -1))
              .map(t => (
                <TaskCard key={t.id} task={t} onUpdate={handleUpdate} onDelete={handleDelete} />
              ))}
          </div>
        )}
      </section>

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
                <TaskCard key={t.id} task={t} onUpdate={handleUpdate} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
