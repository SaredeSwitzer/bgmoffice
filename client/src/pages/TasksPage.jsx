import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

const DELEGATES = ['Sarede', 'Lyra', 'Maria', 'Claire', 'Anyone']

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
    title: '', description: '', assigned_to: '', due_date: '', priority: 'normal', notes: '',
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
          <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base" />
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
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const isDone = task.status === 'done'
  const isUrgent = task.priority === 'urgent'
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

  if (editing) return (
    <TaskForm initial={{ title: task.title, description: task.description || '', assigned_to: task.assigned_to || '',
      due_date: task.due_date || '', priority: task.priority, notes: task.notes || '' }}
      onSave={handleEdit} onCancel={() => setEditing(false)} saving={saving} />
  )

  return (
    <div className={`bg-white border rounded-xl px-4 py-3 transition-colors ${
      isDone ? 'border-gray-100 opacity-60' :
      task.starred ? 'border-yellow-300 bg-yellow-50/40' :
      isUrgent ? 'border-red-200 bg-red-50/30' :
      'border-gray-200'
    }`}>
      <div className="flex items-start gap-3">
        {/* checkbox */}
        <button onClick={toggle} disabled={saving}
          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            isDone ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-gray-500'
          }`}>
          {isDone && <span className="text-white text-xs font-bold">✓</span>}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-sm font-semibold ${isDone ? 'line-through text-gray-400' : 'text-gray-900'}`}>
              {isUrgent && !isDone && <span className="text-red-500 mr-1">🔴</span>}
              {task.title}
            </p>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={toggleStar}
                className={`text-base leading-none ${task.starred ? 'text-yellow-400' : 'text-gray-200 hover:text-yellow-300'}`}
                title={task.starred ? 'Unstar' : 'Star'}>★</button>
              <button onClick={() => setEditing(true)}
                className="text-xs text-gray-400 hover:text-gray-700 px-1">✎</button>
              <button onClick={() => onDelete(task.id)}
                className="text-xs text-gray-300 hover:text-red-500 px-1">✕</button>
            </div>
          </div>

          {task.description && (
            <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-400">
            {task.assigned_to && (
              <span className="font-medium text-gray-600">→ {task.assigned_to}</span>
            )}
            {task.due_date && (
              <span className={isOverdue ? 'text-amber-600 font-semibold' : ''}>
                {isOverdue ? '⚠️ ' : ''}Due {fmtDate(task.due_date)}
              </span>
            )}
            {task.notes && <span className="italic">{task.notes}</span>}
            <span>by {task.created_by} · {fmtTs(task.created_at)}</span>
          </div>

          {isDone && task.completed_at && (
            <p className="text-[10px] text-green-600 mt-0.5">Completed {fmtTs(task.completed_at)}</p>
          )}
        </div>
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
