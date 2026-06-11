import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import SearchSelect from '../components/SearchSelect'
import ActionTypeBadge from '../components/ActionTypeBadge'
import PhoneLink from '../components/PhoneLink'

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function isUnfilled(entry) {
  return !entry.instructor_id && !entry.instructor_info?.trim()
}

// ── Notes Thread ──────────────────────────────────────────────────────────────

// entryClientId / entryInstructorId: auto-populated from the entry when adding a task
function NotesThread({ entryId, notes, onNotesChanged, clients, instructors, actionTypes,
                       entryClientId, entryClientName, entryInstructorId, entryInstructorName,
                       defaultAddTask = false }) {
  const { user } = useAuth()
  const textRef = useRef(null)

  const [mode,           setMode]           = useState(defaultAddTask ? 'task' : null) // null | 'task' | 'note'
  const [text,           setText]           = useState('')
  const [assignedTo,     setAssignedTo]     = useState('')
  const [taskClientId,   setTaskClientId]   = useState(String(entryClientId || ''))
  const [taskInstructor, setTaskInstructor] = useState(String(entryInstructorId || ''))
  const [taskActionType, setTaskActionType] = useState('')
  const [delegates,      setDelegates]      = useState([])
  const [saving,         setSaving]         = useState(false)

  useEffect(() => {
    api.getDelegates().then(setDelegates).catch(() => {})
  }, [])

  useEffect(() => {
    if (mode && textRef.current) textRef.current.focus()
  }, [mode])

  function openTask() {
    setMode('task')
    setTaskClientId(String(entryClientId || ''))
    setTaskInstructor(String(entryInstructorId || ''))
  }

  function cancel() {
    setMode(null); setText(''); setAssignedTo('')
    setTaskClientId(String(entryClientId || ''))
    setTaskInstructor(String(entryInstructorId || ''))
    setTaskActionType('')
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSaving(true)
    const isTask = mode === 'task'
    try {
      const note = await api.addRecruitingNote(entryId, {
        text,
        is_task:        isTask ? 1 : 0,
        assigned_to:    isTask ? (assignedTo || null) : null,
        client_id:      isTask ? (taskClientId || null) : null,
        instructor_id:  isTask ? (taskInstructor || null) : null,
        action_type_id: isTask ? (taskActionType || null) : null,
      })
      onNotesChanged([...notes, note])
      cancel()
    } finally { setSaving(false) }
  }

  async function handleToggleDone(note) {
    const updated = await api.toggleRecruitingNoteDone(entryId, note.id)
    onNotesChanged(notes.map(n => n.id === note.id ? { ...n, is_done: updated.is_done } : n))
  }

  async function handleDelete(noteId) {
    await api.deleteRecruitingNote(entryId, noteId)
    onNotesChanged(notes.filter(n => n.id !== noteId))
  }

  const tasks      = notes.filter(n => n.is_task)
  const plainNotes = notes.filter(n => !n.is_task)

  return (
    <div className="space-y-4">
      {/* ── Tasks ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Tasks</p>
          {mode !== 'task' && (
            <button onClick={openTask}
              className="text-xs px-2.5 py-1 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600">
              + Add Task
            </button>
          )}
        </div>

        <div className="space-y-2 mb-2">
          {tasks.length === 0 && mode !== 'task' && (
            <p className="text-xs text-gray-400 italic">No tasks yet.</p>
          )}
          {tasks.map(n => (
            <div key={n.id} className="flex gap-2 group items-start">
              <button onClick={() => handleToggleDone(n)}
                className={`mt-1 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                  n.is_done ? 'bg-teal-500 border-teal-500 text-white' : 'border-gray-400 hover:border-teal-500 bg-white'
                }`}>
                {n.is_done && <span className="text-[9px] font-bold leading-none">✓</span>}
              </button>
              <div className={`flex-1 rounded-lg px-3 py-2 text-sm border ${
                n.is_done ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-amber-50 border-amber-100'
              }`}>
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold text-gray-500">{n.author_initials} — {fmt(n.created_at)}</span>
                    {n.assigned_to && (
                      <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full font-semibold">→ {n.assigned_to}</span>
                    )}
                    {n.is_done && <span className="text-[10px] text-teal-600 font-semibold">Done</span>}
                  </div>
                  <button onClick={() => handleDelete(n.id)}
                    className="text-[10px] text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                </div>
                <p className={`text-gray-800 whitespace-pre-wrap ${n.is_done ? 'line-through text-gray-400' : ''}`}>{n.text}</p>
              </div>
            </div>
          ))}
        </div>

        {mode === 'task' && (
          <form onSubmit={handleAdd} className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
            <p className="text-xs font-semibold text-amber-800">New Task</p>
            <textarea ref={textRef} value={text} onChange={e => setText(e.target.value)} rows={2}
              placeholder={`Describe the task… (as ${user?.initials})`}
              className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd(e) }} />
            <div className="flex flex-wrap gap-2">
              <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                <option value="">Assign to…</option>
                {delegates.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
              <select value={taskClientId} onChange={e => setTaskClientId(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                <option value="">Client…</option>
                {clients?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={taskInstructor} onChange={e => setTaskInstructor(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                <option value="">Instructor…</option>
                {instructors?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <select value={taskActionType} onChange={e => setTaskActionType(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                <option value="">Action type…</option>
                {actionTypes?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {(taskClientId || taskInstructor) && (
              <p className="text-[10px] text-amber-700">
                Will link to:
                {taskClientId && clients && <span className="font-semibold"> {clients.find(c => String(c.id) === String(taskClientId))?.name}</span>}
                {taskInstructor && instructors && <span className="font-semibold"> · {instructors.find(i => String(i.id) === String(taskInstructor))?.name}</span>}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving || !text.trim()}
                className="px-3 py-1.5 bg-amber-500 text-white text-xs font-medium rounded-lg disabled:opacity-40 hover:bg-amber-600">
                {saving ? 'Saving…' : 'Add Task'}
              </button>
              <button type="button" onClick={cancel}
                className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── Notes ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Notes</p>
          {mode !== 'note' && (
            <button onClick={() => setMode('note')}
              className="text-xs px-2.5 py-1 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
              + Add Note
            </button>
          )}
        </div>

        <div className="space-y-2 mb-2">
          {plainNotes.length === 0 && mode !== 'note' && (
            <p className="text-xs text-gray-400 italic">No notes yet.</p>
          )}
          {plainNotes.map(n => (
            <div key={n.id} className="flex gap-2 group">
              <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-[10px] font-semibold text-gray-500">{n.author_initials} — {fmt(n.created_at)}</span>
                  <button onClick={() => handleDelete(n.id)}
                    className="text-[10px] text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                </div>
                <p className="text-gray-800 whitespace-pre-wrap">{n.text}</p>
              </div>
            </div>
          ))}
        </div>

        {mode === 'note' && (
          <form onSubmit={handleAdd} className="space-y-2">
            <div className="flex gap-2">
              <textarea ref={textRef} value={text} onChange={e => setText(e.target.value)} rows={2}
                placeholder={`Add a note… (as ${user?.initials})`}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd(e) }} />
              <div className="flex flex-col gap-1 self-end">
                <button type="submit" disabled={saving || !text.trim()}
                  className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-40">
                  {saving ? '…' : 'Add'}
                </button>
                <button type="button" onClick={cancel}
                  className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Entry Form ────────────────────────────────────────────────────────────────

function EntryForm({ day, entry, clients, instructors, actionTypes, users, onSave, onCancel }) {
  const { user } = useAuth()

  const [form, setForm] = useState(() => ({
    day_of_week:         entry?.day_of_week         || day,
    time_slot:           entry?.time_slot           || '',
    neighborhood:        entry?.neighborhood        || '',
    style:               entry?.style               || '',
    participants:        entry?.participants        || '',
    client_name:         entry?.client_name         || '',
    client_id:           entry?.client_id           || null,
    address:             entry?.address             || '',
    phone:               entry?.phone               || '',
    waiver_signed:       entry?.waiver_signed       ? true : false,
    instructor_info:     entry?.instructor_info     || '',
    instructor_id:       entry?.instructor_id       || null,
    client_rate:         entry?.client_rate         || '',
    action_type_id:      entry?.action_type_id      || '',
    assigned_to_user_id: entry?.assigned_to_user_id || '',
  }))

  const [clientObj,     setClientObj]     = useState(
    entry?.client_id ? clients.find(c => c.id === entry.client_id) || null : null
  )
  const [instructorObj, setInstructorObj] = useState(
    entry?.instructor_id ? instructors.find(i => i.id === entry.instructor_id) || null : null
  )
  const [newClientName,  setNewClientName]  = useState('')
  const [newClientPhone, setNewClientPhone] = useState('')
  const [showNewClient,  setShowNewClient]  = useState(false)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function setField(key, val) { setForm(f => ({ ...f, [key]: val })) }

  function handleClientSelect(c) {
    if (c) {
      setClientObj(c)
      setField('client_name', c.name)
      setField('client_id', c.id)
      setShowNewClient(false)
    } else {
      setClientObj(null)
      setField('client_name', '')
      setField('client_id', null)
    }
  }

  function handleInstructorSelect(i) {
    if (i) {
      setInstructorObj(i)
      setField('instructor_id', i.id)
    } else {
      setInstructorObj(null)
      setField('instructor_id', null)
    }
  }

  async function handleQuickAddClient(e) {
    e.preventDefault()
    if (!newClientName.trim()) return
    setSaving(true)
    try {
      const created = await api.createClient({ name: newClientName.trim(), phone: newClientPhone.trim() || null })
      setClientObj(created)
      setField('client_name', created.name)
      setField('client_id', created.id)
      setShowNewClient(false)
      setNewClientName('')
      setNewClientPhone('')
    } catch (err) {
      setError(err.message)
    } finally { setSaving(false) }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        client_id:           form.client_id           || null,
        instructor_id:       form.instructor_id       || null,
        action_type_id:      form.action_type_id      ? Number(form.action_type_id)      : null,
        assigned_to_user_id: form.assigned_to_user_id ? Number(form.assigned_to_user_id) : null,
      }
      const saved = entry
        ? await api.updateRecruitingEntry(entry.id, payload)
        : await api.createRecruitingEntry(payload)
      onSave(saved)
    } catch (err) {
      setError(err.message)
    } finally { setSaving(false) }
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'
  const selectCls = `${inputCls} bg-white`

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {!entry && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Day *</label>
          <select value={form.day_of_week} onChange={e => setField('day_of_week', e.target.value)} className={selectCls}>
            {DAYS.map(d => <option key={d}>{d}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
          <input value={form.time_slot} onChange={e => setField('time_slot', e.target.value)}
            placeholder="e.g. 10:00–11:00 AM" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Neighborhood</label>
          <input value={form.neighborhood} onChange={e => setField('neighborhood', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Style</label>
          <input value={form.style} onChange={e => setField('style', e.target.value)} className={inputCls} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Participants & Ages</label>
          <input value={form.participants} onChange={e => setField('participants', e.target.value)}
            placeholder="e.g. 10–15 Seniors" className={inputCls} />
        </div>

        {/* Client */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
          {showNewClient ? (
            <div className="border border-blue-200 bg-blue-50 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-blue-700">Quick-add new client</p>
              <input value={newClientName} onChange={e => setNewClientName(e.target.value)}
                placeholder="Name *" className={inputCls} />
              <input value={newClientPhone} onChange={e => setNewClientPhone(e.target.value)}
                placeholder="Phone (optional)" className={inputCls} />
              <div className="flex gap-2">
                <button type="button" onClick={handleQuickAddClient}
                  disabled={saving || !newClientName.trim()}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg disabled:opacity-40">
                  Create & Link
                </button>
                <button type="button" onClick={() => setShowNewClient(false)}
                  className="px-3 py-1.5 border border-gray-300 text-xs rounded-lg">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="flex-1">
                <SearchSelect options={clients} value={clientObj} onChange={handleClientSelect}
                  placeholder="Search existing clients…" />
              </div>
              <button type="button" onClick={() => setShowNewClient(true)}
                className="px-3 py-1.5 border border-dashed border-gray-400 text-gray-500 text-xs rounded-lg hover:bg-gray-50 whitespace-nowrap">
                + New Client
              </button>
            </div>
          )}
          {!clientObj && (
            <input value={form.client_name}
              onChange={e => { setField('client_name', e.target.value); setField('client_id', null) }}
              placeholder="Or type client name manually"
              className={`${inputCls} mt-2`} />
          )}
        </div>

        {/* Instructor */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Instructor</label>
          <SearchSelect options={instructors} value={instructorObj} onChange={handleInstructorSelect}
            placeholder="Search instructors…" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Instructor Notes</label>
          <input value={form.instructor_info} onChange={e => setField('instructor_info', e.target.value)}
            placeholder="Rate, availability details, etc." className={inputCls} />
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
          <textarea value={form.address} onChange={e => setField('address', e.target.value)}
            rows={2} className={`${inputCls} resize-none`} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
          <input value={form.phone} onChange={e => setField('phone', e.target.value)} className={inputCls} />
        </div>
        <div className="flex items-center gap-3 pt-4">
          <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.waiver_signed}
              onChange={e => setField('waiver_signed', e.target.checked)}
              className="rounded" />
            Waiver Signed
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Client Rate / Payment</label>
          <input value={form.client_rate} onChange={e => setField('client_rate', e.target.value)}
            placeholder="e.g. $125" className={inputCls} />
        </div>

        {/* Action Type */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Action Type</label>
          <select value={form.action_type_id} onChange={e => setField('action_type_id', e.target.value)}
            className={selectCls}>
            <option value="">None</option>
            {actionTypes.map(at => <option key={at.id} value={at.id}>{at.name}</option>)}
          </select>
        </div>

        {/* Assigned To */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Assigned To</label>
          <select value={form.assigned_to_user_id} onChange={e => setField('assigned_to_user_id', e.target.value)}
            className={selectCls}>
            <option value="">Unassigned</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : entry ? 'Save Changes' : 'Add Entry'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Entry Card ────────────────────────────────────────────────────────────────

function EntryCard({ entry, clients, instructors, actionTypes, users, onUpdated, onDeleted }) {
  const [expanded,     setExpanded]     = useState(false)
  const [editing,      setEditing]      = useState(false)
  const [notes,        setNotes]        = useState(entry.notes || [])
  const [quickAddTask, setQuickAddTask] = useState(false)

  function handleUpdated(updated) {
    setEditing(false)
    setNotes(updated.notes || notes)
    onUpdated(updated)
  }

  async function handleDelete() {
    if (!confirm('Delete this entry?')) return
    await api.deleteRecruitingEntry(entry.id)
    onDeleted(entry.id)
  }

  function handleQuickTask(e) {
    e.stopPropagation()
    setExpanded(true)
    setQuickAddTask(true)
  }

  const openTaskCount = notes.filter(n => n.is_task && !n.is_done).length

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Summary row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => !editing && setExpanded(e => !e)}
      >
        <button
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          className="text-gray-400 flex-shrink-0 w-4 text-center text-sm"
        >
          {expanded ? '▾' : '▸'}
        </button>

        {/* Primary info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {entry.time_slot && (
              <span className="text-sm font-semibold text-gray-900 truncate">{entry.time_slot}</span>
            )}
            {(entry.neighborhood || entry.style) && (
              <span className="text-xs text-gray-500 truncate">
                {[entry.neighborhood, entry.style].filter(Boolean).join(' · ')}
              </span>
            )}
            {entry.participants && (
              <span className="text-xs text-gray-400 truncate">{entry.participants}</span>
            )}
          </div>
        </div>

        {/* Badges + quick actions */}
        <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0">
          {entry.client_id ? (
            <Link to={`/clients/${entry.client_id}`} onClick={e => e.stopPropagation()}
              className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full hover:bg-blue-200 font-medium whitespace-nowrap">
              {entry.client_name || 'Client'}
            </Link>
          ) : entry.client_name ? (
            <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
              {entry.client_name}
            </span>
          ) : null}

          {entry.instructor_id ? (
            <Link to={`/instructors/${entry.instructor_id}`} onClick={e => e.stopPropagation()}
              className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full hover:bg-purple-200 font-medium whitespace-nowrap">
              {entry.instructor_name}
            </Link>
          ) : entry.instructor_info ? (
            <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full whitespace-nowrap">
              {entry.instructor_info}
            </span>
          ) : (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              Needs instructor
            </span>
          )}

          {entry.action_type_id && (
            <ActionTypeBadge name={entry.action_type_name} color={entry.action_type_color} size="xs" />
          )}

          {entry.assigned_to_user_id && (
            <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
              {entry.assigned_to_user_initials || entry.assigned_to_user_name}
            </span>
          )}

          {entry.waiver_signed ? (
            <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ Waiver</span>
          ) : null}

          {openTaskCount > 0 && (
            <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full">
              {openTaskCount} task{openTaskCount > 1 ? 's' : ''}
            </span>
          )}

          {/* Quick task button — always visible */}
          <button
            onClick={handleQuickTask}
            title="Add a task for this entry"
            className="text-[10px] px-2 py-0.5 bg-amber-500 text-white rounded-full font-medium hover:bg-amber-600 whitespace-nowrap"
          >
            + Task
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-5">
          {editing ? (
            <EntryForm
              day={entry.day_of_week}
              entry={entry}
              clients={clients}
              instructors={instructors}
              actionTypes={actionTypes}
              users={users}
              onSave={handleUpdated}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              {/* Tasks + Notes — shown first, most actionable */}
              <NotesThread
                entryId={entry.id}
                notes={notes}
                onNotesChanged={n => { setNotes(n); setQuickAddTask(false) }}
                clients={clients}
                instructors={instructors}
                actionTypes={actionTypes}
                entryClientId={entry.client_id}
                entryClientName={entry.client_name}
                entryInstructorId={entry.instructor_id}
                entryInstructorName={entry.instructor_name}
                defaultAddTask={quickAddTask}
              />

              {/* Entry details — below tasks/notes */}
              <div className="pt-3 border-t border-gray-100">
                <div className="flex justify-end gap-2 mb-3">
                  <span className="text-[10px] text-gray-400 self-center mr-auto">Added by {entry.created_by}</span>
                  <button onClick={() => setEditing(true)}
                    className="text-xs px-3 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                    Edit
                  </button>
                  <button onClick={handleDelete}
                    className="text-xs px-3 py-1 border border-red-200 rounded-lg text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Time</p>
                    <p className="text-sm text-gray-800">{entry.time_slot || <span className="text-gray-300">—</span>}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Neighborhood</p>
                    <p className="text-sm text-gray-800">{entry.neighborhood || <span className="text-gray-300">—</span>}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Style</p>
                    <p className="text-sm text-gray-800">{entry.style || <span className="text-gray-300">—</span>}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Participants</p>
                    <p className="text-sm text-gray-800">{entry.participants || <span className="text-gray-300">—</span>}</p>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Client</p>
                    {entry.client_id ? (
                      <Link to={`/clients/${entry.client_id}`} className="text-sm font-medium text-blue-600 hover:underline">
                        {entry.client_name || '—'}
                      </Link>
                    ) : (
                      <p className="text-sm text-gray-800">{entry.client_name || <span className="text-gray-300">—</span>}</p>
                    )}
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Instructor</p>
                    {entry.instructor_id ? (
                      <Link to={`/instructors/${entry.instructor_id}`} className="text-sm font-medium text-purple-600 hover:underline">
                        {entry.instructor_name}
                      </Link>
                    ) : (
                      <p className="text-sm text-gray-800">{entry.instructor_info || <span className="text-gray-300">—</span>}</p>
                    )}
                  </div>

                  {entry.instructor_info && entry.instructor_id && (
                    <div className="col-span-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Instructor Notes</p>
                      <p className="text-sm text-gray-800">{entry.instructor_info}</p>
                    </div>
                  )}

                  <div className="col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Address</p>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{entry.address || <span className="text-gray-300">—</span>}</p>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Phone</p>
                    {entry.phone ? <PhoneLink phone={entry.phone} /> : <span className="text-gray-300">—</span>}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Waiver</p>
                    <p className={`text-sm font-medium ${entry.waiver_signed ? 'text-green-700' : 'text-gray-400'}`}>
                      {entry.waiver_signed ? '✓ Yes' : 'No'}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Client Rate</p>
                    <p className="text-sm text-gray-800">{entry.client_rate || <span className="text-gray-300">—</span>}</p>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Action Type</p>
                    {entry.action_type_id
                      ? <ActionTypeBadge name={entry.action_type_name} color={entry.action_type_color} />
                      : <span className="text-gray-300 text-sm">—</span>}
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Assigned To</p>
                    <p className="text-sm text-gray-800">
                      {entry.assigned_to_user_name || <span className="text-gray-300">—</span>}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Day Section ───────────────────────────────────────────────────────────────

function DaySection({ day, entries, clients, instructors, actionTypes, users, onUpdated, onDeleted, onCreated, defaultOpen }) {
  const [open,      setOpen]      = useState(defaultOpen)
  const [addingNew, setAddingNew] = useState(false)

  const unfilledInDay = entries.filter(isUnfilled).length

  return (
    <section>
      <div
        className="flex items-center justify-between cursor-pointer select-none py-2 px-1 group"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-sm w-4 text-center">{open ? '▾' : '▸'}</span>
          <h2 className="text-base font-bold text-gray-800">{day}</h2>
          <span className="text-xs font-semibold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
            {entries.length}
          </span>
          {unfilledInDay > 0 && (
            <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              {unfilledInDay} unfilled
            </span>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); setOpen(true); setAddingNew(true) }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-3 py-1 bg-gray-900 text-white rounded-lg hover:bg-gray-700"
        >
          + Add Entry
        </button>
      </div>

      {open && (
        <div className="space-y-2 mt-2 pl-4 border-l-2 border-gray-200">
          {entries.map(entry => (
            <EntryCard
              key={entry.id}
              entry={entry}
              clients={clients}
              instructors={instructors}
              actionTypes={actionTypes}
              users={users}
              onUpdated={onUpdated}
              onDeleted={onDeleted}
            />
          ))}

          {addingNew ? (
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-sm font-semibold text-gray-800 mb-3">New {day} Entry</p>
              <EntryForm
                day={day}
                clients={clients}
                instructors={instructors}
                actionTypes={actionTypes}
                users={users}
                onSave={entry => { onCreated(entry); setAddingNew(false) }}
                onCancel={() => setAddingNew(false)}
              />
            </div>
          ) : (
            <button
              onClick={() => setAddingNew(true)}
              className="w-full text-xs text-gray-400 hover:text-gray-700 border border-dashed border-gray-300 rounded-xl py-3 hover:bg-gray-50 transition-colors"
            >
              + Add {day} entry
            </button>
          )}
        </div>
      )}
    </section>
  )
}

// ── Openings Panel (shown in availability tab when toggled on) ────────────────

function OpeningsPanel({ grouped, availability }) {
  const unfilledByDay = {}
  DAYS.forEach(day => {
    const unfilled = (grouped[day] || []).filter(isUnfilled)
    if (unfilled.length) unfilledByDay[day] = unfilled
  })

  const availByDay = {}
  for (const slot of availability) {
    if (!availByDay[slot.day_of_week]) availByDay[slot.day_of_week] = []
    availByDay[slot.day_of_week].push(slot)
  }

  if (!Object.keys(unfilledByDay).length) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-6 text-center">
        <p className="text-xl mb-1">✓</p>
        <p className="text-sm font-medium text-green-800">All classes have instructors!</p>
      </div>
    )
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold uppercase tracking-widest text-amber-700">Current Openings</p>
      {DAYS.filter(d => unfilledByDay[d]).map(day => (
        <div key={day}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{day}</p>
          <div className="space-y-1.5">
            {unfilledByDay[day].map(entry => {
              const matches = availByDay[day] || []
              return (
                <div key={entry.id} className="bg-white border border-amber-200 rounded-lg px-3 py-2">
                  <div className="flex flex-wrap gap-2 text-xs text-gray-600 mb-1">
                    {entry.time_slot && <span className="font-semibold text-gray-800">{entry.time_slot}</span>}
                    {entry.client_name && (
                      entry.client_id
                        ? <Link to={`/clients/${entry.client_id}`} className="text-blue-600 hover:underline">{entry.client_name}</Link>
                        : <span>{entry.client_name}</span>
                    )}
                    {entry.style && <span className="text-gray-400">· {entry.style}</span>}
                    {entry.neighborhood && <span className="text-gray-400">· {entry.neighborhood}</span>}
                  </div>
                  {matches.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[11px] text-gray-400">Available:</span>
                      {matches.map(m => (
                        <Link key={m.id} to={`/instructors/${m.instructor_id}`}
                          className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 font-medium hover:bg-blue-100">
                          {m.instructor_name}{m.time_slot ? ` · ${m.time_slot}` : ''}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-300 italic">No instructors available {day}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Instructor Availability Tab ───────────────────────────────────────────────

function InstructorAvailabilityTab({ availability, instructors, grouped, onChanged }) {
  const [form,         setForm]         = useState({ instructor_id: '', day_of_week: '', time_slot: '' })
  const [saving,       setSaving]       = useState(false)
  const [showOpenings, setShowOpenings] = useState(false)

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.instructor_id || !form.day_of_week) return
    setSaving(true)
    try {
      const row = await api.addInstructorAvailability({
        instructor_id: Number(form.instructor_id),
        day_of_week:   form.day_of_week,
        time_slot:     form.time_slot || null,
      })
      onChanged([...availability, row])
      setForm({ instructor_id: '', day_of_week: '', time_slot: '' })
    } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    await api.deleteInstructorAvailability(id)
    onChanged(availability.filter(a => a.id !== id))
  }

  const grouped2 = {}
  for (const slot of availability) {
    if (!grouped2[slot.instructor_name]) grouped2[slot.instructor_name] = []
    grouped2[slot.instructor_name].push(slot)
  }
  const instructorNames = Object.keys(grouped2).sort()

  const totalUnfilled = DAYS.reduce((n, d) => n + (grouped[d] || []).filter(isUnfilled).length, 0)

  return (
    <div className="space-y-6">
      {/* Toggle */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {availability.length} availability slot{availability.length !== 1 ? 's' : ''} recorded
        </p>
        <button
          onClick={() => setShowOpenings(s => !s)}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            showOpenings
              ? 'bg-amber-100 border-amber-300 text-amber-800'
              : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {showOpenings ? '▾' : '▸'}
          {showOpenings ? 'Hide' : 'Show'} current openings
          {!showOpenings && totalUnfilled > 0 && (
            <span className="bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
              {totalUnfilled}
            </span>
          )}
        </button>
      </div>

      {/* Openings panel */}
      {showOpenings && <OpeningsPanel grouped={grouped} availability={availability} />}

      {/* Add form */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Add Availability</p>
        <form onSubmit={handleAdd} className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-1">Instructor</label>
            <select value={form.instructor_id} onChange={e => setForm(f => ({ ...f, instructor_id: e.target.value }))}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm min-w-[160px] bg-white">
              <option value="">Select instructor…</option>
              {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-1">Day</label>
            <select value={form.day_of_week} onChange={e => setForm(f => ({ ...f, day_of_week: e.target.value }))}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
              <option value="">Select day…</option>
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-1">Time (optional)</label>
            <input value={form.time_slot} onChange={e => setForm(f => ({ ...f, time_slot: e.target.value }))}
              placeholder="e.g. 10am–noon"
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-36" />
          </div>
          <button type="submit" disabled={saving || !form.instructor_id || !form.day_of_week}
            className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-40 hover:bg-gray-700">
            {saving ? 'Adding…' : '+ Add'}
          </button>
        </form>
      </div>

      {/* Availability list */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">All Availability</p>
        {instructorNames.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No availability recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {instructorNames.map(name => {
              const slots = grouped2[name]
              const instrId = slots[0].instructor_id
              return (
                <div key={name} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <Link to={`/instructors/${instrId}`}
                    className="text-sm font-semibold text-gray-800 hover:text-purple-700 hover:underline mb-2 inline-block">
                    {name}
                  </Link>
                  <div className="flex flex-wrap gap-1.5">
                    {slots.map(slot => (
                      <span key={slot.id}
                        className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">
                        <span className="font-medium">{slot.day_of_week}</span>
                        {slot.time_slot && <span className="text-gray-500">· {slot.time_slot}</span>}
                        <button onClick={() => handleDelete(slot.id)}
                          className="text-gray-300 hover:text-red-500 leading-none ml-0.5">✕</button>
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RecruitingPage() {
  const [tab,          setTab]          = useState('entries')
  const [grouped,      setGrouped]      = useState({})
  const [clients,      setClients]      = useState([])
  const [instructors,  setInstructors]  = useState([])
  const [actionTypes,  setActionTypes]  = useState([])
  const [users,        setUsers]        = useState([])
  const [availability, setAvailability] = useState([])
  const [query,        setQuery]        = useState('')
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const searchTimer = useRef(null)

  const load = useCallback((q = '') => {
    setLoading(true)
    Promise.all([
      api.getRecruiting(q || undefined),
      api.getClients(),
      api.getInstructors(),
      api.getInstructorAvailability(),
      api.getActionTypes(),
      api.getUsers(),
    ])
      .then(([data, cls, insts, avail, ats, usrs]) => {
        setGrouped(data.grouped)
        setClients(cls)
        setInstructors(insts)
        setAvailability(avail)
        setActionTypes(ats)
        setUsers(usrs)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function handleSearchChange(q) {
    setQuery(q)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(q), 250)
  }

  function handleEntryUpdated(updated) {
    setGrouped(prev => {
      const day = updated.day_of_week
      const newDay = (prev[day] || []).map(e =>
        e.id === updated.id ? { ...updated, notes: e.notes } : e
      )
      return { ...prev, [day]: newDay }
    })
  }

  function handleEntryDeleted(id) {
    setGrouped(prev => {
      const next = {}
      DAYS.forEach(d => { next[d] = (prev[d] || []).filter(e => e.id !== id) })
      return next
    })
  }

  function handleEntryCreated(entry) {
    setGrouped(prev => ({
      ...prev,
      [entry.day_of_week]: [...(prev[entry.day_of_week] || []), entry],
    }))
  }

  if (error) return <p className="text-red-600 text-sm">{error}</p>

  const totalEntries  = DAYS.reduce((n, d) => n + (grouped[d]?.length || 0), 0)
  const unfilledCount = DAYS.reduce((n, d) => n + (grouped[d] || []).filter(isUnfilled).length, 0)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Recruiting</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {totalEntries} entr{totalEntries === 1 ? 'y' : 'ies'}
            {unfilledCount > 0 && (
              <span className="ml-2 text-amber-600 font-medium">{unfilledCount} need{unfilledCount === 1 ? 's' : ''} instructor</span>
            )}
          </p>
        </div>
        {tab === 'entries' && (
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={query}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search entries…"
              className="border border-gray-300 rounded-lg pl-8 pr-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 w-52"
            />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setTab('entries')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'entries'
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Entries
        </button>
        <button
          onClick={() => setTab('availability')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'availability'
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Instructor Availability
          {unfilledCount > 0 && (
            <span className="ml-2 text-xs font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
              {unfilledCount}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
      ) : tab === 'entries' ? (
        <div className="space-y-4">
          {DAYS.map(day => (
            <DaySection
              key={day}
              day={day}
              entries={grouped[day] || []}
              clients={clients}
              instructors={instructors}
              actionTypes={actionTypes}
              users={users}
              onUpdated={handleEntryUpdated}
              onDeleted={handleEntryDeleted}
              onCreated={handleEntryCreated}
              defaultOpen={day === 'Sunday'}
            />
          ))}
        </div>
      ) : (
        <InstructorAvailabilityTab
          availability={availability}
          instructors={instructors}
          grouped={grouped}
          onChanged={setAvailability}
        />
      )}
    </div>
  )
}
