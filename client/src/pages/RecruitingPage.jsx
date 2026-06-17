import { useEffect, useRef, useState, useCallback } from 'react'
import { Link, useSearchParams, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import SearchSelect from '../components/SearchSelect'
import ActionTypeBadge from '../components/ActionTypeBadge'
import PhoneLink from '../components/PhoneLink'

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const CLASS_TYPE_LABELS = {
  ala_carte:      'A la carte',
  ongoing_weekly: 'Ongoing weekly',
  semester:       'Semester',
}

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function fmtShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isUnfilled(entry) {
  return !entry.instructor_id && !entry.instructor_info?.trim()
}

// ── Task note card (with inline edit) ────────────────────────────────────────

function TaskNoteCard({ note: n, currentUserInitials, delegates, onToggleDone, onDelete, onEdit, onReply }) {
  const [editing,     setEditing]     = useState(false)
  const [editText,    setEditText]    = useState(n.text)
  const [editAssign,  setEditAssign]  = useState(n.assigned_to || '')
  const [saving,      setSaving]      = useState(false)
  const isAuthor = n.author_initials === currentUserInitials

  async function handleSave(e) {
    e.preventDefault()
    if (!editText.trim()) return
    setSaving(true)
    try {
      await onEdit(editText.trim(), editAssign)
      setEditing(false)
    } finally { setSaving(false) }
  }

  function handleCancel() {
    setEditText(n.text)
    setEditAssign(n.assigned_to || '')
    setEditing(false)
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 space-y-2">
        <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2} autoFocus
          className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white" />
        <div className="flex items-center gap-2 flex-wrap">
          <select value={editAssign} onChange={e => setEditAssign(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
            <option value="">Assign to…</option>
            {delegates.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
          <button type="submit" disabled={saving || !editText.trim()}
            className="px-3 py-1 bg-amber-500 text-white text-xs font-medium rounded-lg disabled:opacity-40 hover:bg-amber-600">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={handleCancel}
            className="px-3 py-1 border border-gray-300 text-gray-600 text-xs rounded-lg">
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${
      n.is_done ? 'border-gray-100 bg-gray-50 opacity-70' : 'border-amber-200 bg-amber-50'
    }`}>
      <div className="px-3 pt-2.5 pb-1">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-semibold text-gray-500">{n.author_initials} — {fmt(n.created_at)}</span>
            {n.assigned_to && (
              <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full font-semibold">→ {n.assigned_to}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {isAuthor && !n.is_done && (
              <button onClick={() => setEditing(true)}
                className="text-[10px] text-gray-400 hover:text-gray-700">✎</button>
            )}
            <button onClick={onDelete}
              className="text-[10px] text-gray-300 hover:text-red-500">✕</button>
          </div>
        </div>
        <p className={`text-sm text-gray-800 whitespace-pre-wrap ${n.is_done ? 'line-through text-gray-400' : ''}`}>{n.text}</p>
      </div>
      <div className="flex gap-1.5 px-3 pb-2.5 pt-1">
        <button onClick={onToggleDone}
          className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
            n.is_done
              ? 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-white'
              : 'bg-white border-teal-300 text-teal-700 hover:bg-teal-50'
          }`}>
          {n.is_done ? '✓ Done — Reopen' : '✓ Mark Done'}
        </button>
        {!n.is_done && (
          <button onClick={onReply}
            className="px-2.5 py-1 text-xs font-medium border border-gray-200 text-gray-500 rounded-lg hover:bg-white">
            ↩ Reply
          </button>
        )}
      </div>
    </div>
  )
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

  function openReplyNote(taskText) {
    setMode('note')
    setText(`Re: "${taskText}"\n`)
    setTimeout(() => textRef.current?.focus(), 50)
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

  async function handleEditTask(noteId, text, assignedTo) {
    const updated = await api.updateRecruitingNote(entryId, noteId, { text, assigned_to: assignedTo || null })
    onNotesChanged(notes.map(n => n.id === noteId ? updated : n))
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
            <TaskNoteCard
              key={n.id}
              note={n}
              currentUserInitials={user?.initials}
              delegates={delegates}
              onToggleDone={() => handleToggleDone(n)}
              onDelete={() => handleDelete(n.id)}
              onEdit={(text, assignedTo) => handleEditTask(n.id, text, assignedTo)}
              onReply={() => openReplyNote(n.text)}
            />
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
            <div key={n.id} className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[10px] font-semibold text-gray-500">{n.author_initials} — {fmt(n.created_at)}</span>
                <button onClick={() => handleDelete(n.id)}
                  className="text-[10px] text-gray-300 hover:text-red-500">✕</button>
              </div>
              <p className="text-gray-800 whitespace-pre-wrap">{n.text}</p>
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
    class_type:          entry?.class_type          || '',
    time_slot:           entry?.time_slot           || '',
    class_dates:         entry?.class_dates         || '',
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
        client_id:     form.client_id     || null,
        instructor_id: form.instructor_id || null,
        class_type:    form.class_type    || null,
        class_dates:   form.class_dates   || null,
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
          <label className="block text-xs font-medium text-gray-600 mb-1">Class Type</label>
          <select value={form.class_type} onChange={e => { setField('class_type', e.target.value); if (e.target.value === 'ongoing_weekly') setField('class_dates', '') }} className={selectCls}>
            <option value="">Not specified</option>
            <option value="ala_carte">A la carte</option>
            <option value="ongoing_weekly">Ongoing weekly</option>
            <option value="semester">Semester</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
          <input value={form.time_slot} onChange={e => setField('time_slot', e.target.value)}
            placeholder="e.g. 9:30–10:30 AM" className={inputCls} />
        </div>

        {(form.class_type === 'ala_carte' || form.class_type === 'semester') && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {form.class_type === 'ala_carte' ? 'Specific Dates' : 'Date Range'}
            </label>
            <input value={form.class_dates} onChange={e => setField('class_dates', e.target.value)}
              placeholder={form.class_type === 'ala_carte' ? 'e.g. May 24, June 21, July 5' : 'e.g. Sep 8 – Dec 15'}
              className={inputCls} />
          </div>
        )}
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

function EntryCard({ entry, clients, instructors, actionTypes, users, onUpdated, onDeleted, onArchived, targetEntryId }) {
  const isTarget = targetEntryId != null && entry.id === targetEntryId
  const [expanded,     setExpanded]     = useState(isTarget)
  const [editing,      setEditing]      = useState(false)
  const [notes,        setNotes]        = useState(entry.notes || [])
  const [quickAddTask, setQuickAddTask] = useState(false)
  const cardRef = useRef(null)

  const latestNote = notes.length > 0
    ? [...notes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    : null

  useEffect(() => {
    if (isTarget && cardRef.current) {
      setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400)
    }
  }, [isTarget])

  function handleUpdated(updated) {
    setEditing(false)
    setNotes(updated.notes || notes)
    onUpdated(updated)
  }

  async function handleDelete() {
    if (!confirm('Permanently delete this entry? This cannot be undone.')) return
    await api.deleteRecruitingEntry(entry.id)
    onDeleted(entry.id)
  }

  async function handleArchive() {
    const updated = await api.archiveRecruitingEntry(entry.id)
    onArchived(updated)
  }

  function handleQuickTask(e) {
    e.stopPropagation()
    setExpanded(true)
    setQuickAddTask(true)
  }

  const openTaskCount = notes.filter(n => n.is_task && !n.is_done).length

  return (
    <div ref={cardRef}
      className={`bg-white rounded-xl shadow-sm overflow-hidden transition-shadow ${
        isTarget ? 'border-2 border-amber-400 ring-2 ring-amber-100' : 'border border-gray-200'
      } ${entry.archived ? 'opacity-60' : ''}`}>
      {/* Summary row */}
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => !editing && setExpanded(e => !e)}
      >
        <button
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          className="text-gray-400 flex-shrink-0 w-4 text-center text-sm mt-1"
        >
          {expanded ? '▾' : '▸'}
        </button>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Client name — headline */}
          <div className="font-bold text-gray-900 text-[15px] leading-snug">
            {entry.client_id ? (
              <Link to={`/clients/${entry.client_id}`} onClick={e => e.stopPropagation()}
                className="hover:text-blue-700 hover:underline">
                {entry.client_name || 'Client'}
              </Link>
            ) : entry.client_name ? (
              entry.client_name
            ) : (
              <span className="text-gray-300 font-normal italic text-sm">No client</span>
            )}
          </div>

          {/* Location · style · participants */}
          {(entry.neighborhood || entry.style || entry.participants) && (
            <div className="text-xs text-gray-500 mt-0.5">
              {[entry.neighborhood, entry.style, entry.participants].filter(Boolean).join(' · ')}
            </div>
          )}

          {/* Class type · dates · time */}
          {(entry.class_type || entry.time_slot || entry.class_dates) && (
            <div className="flex flex-wrap items-center gap-x-1.5 mt-1">
              {entry.class_type && (
                <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">
                  {CLASS_TYPE_LABELS[entry.class_type]}
                </span>
              )}
              {entry.class_dates && (
                <span className="text-xs text-gray-600">{entry.class_dates}</span>
              )}
              {entry.class_dates && entry.time_slot && (
                <span className="text-xs text-gray-300">·</span>
              )}
              {entry.time_slot && (
                <span className="text-xs font-medium text-gray-700">{entry.time_slot}</span>
              )}
            </div>
          )}

          {/* Latest note preview */}
          {latestNote && (
            <div className="mt-1.5 flex items-baseline gap-1.5 min-w-0">
              <span className="text-[11px] font-semibold text-gray-500 flex-shrink-0">{latestNote.author_initials}</span>
              <span className="text-[11px] text-gray-400 truncate">
                {latestNote.is_task ? '↳ ' : ''}{latestNote.text}
              </span>
              <span className="text-[11px] text-gray-300 flex-shrink-0">{fmtShort(latestNote.created_at)}</span>
            </div>
          )}
        </div>

        {/* Right column: instructor status + secondary badges */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0 mt-0.5">
          {entry.instructor_id ? (
            <Link to={`/instructors/${entry.instructor_id}`} onClick={e => e.stopPropagation()}
              className="text-xs font-semibold text-purple-700 hover:underline whitespace-nowrap">
              {entry.instructor_name}
            </Link>
          ) : (
            <span className="text-xs font-semibold text-amber-600 whitespace-nowrap">Needs instructor</span>
          )}

          <div className="flex items-center gap-1 flex-wrap justify-end">
            {!!entry.archived && (
              <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">Archived</span>
            )}
            {!!entry.waiver_signed && (
              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">✓ Waiver</span>
            )}
            {openTaskCount > 0 && (
              <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">
                {openTaskCount} task{openTaskCount > 1 ? 's' : ''}
              </span>
            )}
            {!entry.archived ? (
              <button
                onClick={handleQuickTask}
                title="Add a task for this entry"
                className="text-[10px] px-1.5 py-0.5 bg-amber-500 text-white rounded-full font-medium hover:bg-amber-600 whitespace-nowrap"
              >
                + Task
              </button>
            ) : null}
          </div>
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
              {/* Entry details — client info + what's needed */}
              <div className="pb-4 border-b border-gray-100">
                <div className="flex justify-end gap-2 mb-3">
                  <span className="text-[10px] text-gray-400 self-center mr-auto">
                    Added by {entry.created_by}{entry.created_at ? ` · ${fmtShort(entry.created_at)}` : ''}
                  </span>
                  {!entry.archived && (
                    <button onClick={() => setEditing(true)}
                      className="text-xs px-3 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                      Edit
                    </button>
                  )}
                  <button onClick={handleArchive}
                    className="text-xs px-3 py-1 border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50">
                    {entry.archived ? 'Unarchive' : 'Archive'}
                  </button>
                  <button onClick={handleDelete}
                    className="text-xs px-3 py-1 border border-red-200 rounded-lg text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
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
                      <p className="text-sm text-gray-800">{entry.instructor_info || <span className="text-gray-300 italic">Needs instructor</span>}</p>
                    )}
                  </div>

                  {entry.instructor_info && entry.instructor_id && (
                    <div className="col-span-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Instructor Notes</p>
                      <p className="text-sm text-gray-800">{entry.instructor_info}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Class Type</p>
                    <p className="text-sm text-gray-800">{entry.class_type ? CLASS_TYPE_LABELS[entry.class_type] : <span className="text-gray-300">—</span>}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Time</p>
                    <p className="text-sm text-gray-800">{entry.time_slot || <span className="text-gray-300">—</span>}</p>
                  </div>
                  {entry.class_dates && (
                    <div className="col-span-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        {entry.class_type === 'semester' ? 'Date Range' : 'Dates'}
                      </p>
                      <p className="text-sm text-gray-800">{entry.class_dates}</p>
                    </div>
                  )}
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

              {/* Tasks + Notes — below entry details */}
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
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Day Section ───────────────────────────────────────────────────────────────

function DaySection({ day, entries, clients, instructors, actionTypes, users, onUpdated, onDeleted, onArchived, onCreated, defaultOpen, targetEntryId, forceOpen }) {
  const hasTarget = targetEntryId != null && entries.some(e => e.id === targetEntryId)
  const [open,      setOpen]      = useState(defaultOpen || hasTarget)

  useEffect(() => { if (forceOpen) setOpen(true) }, [forceOpen])
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
              onArchived={onArchived}
              targetEntryId={targetEntryId}
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
  const [form,          setForm]         = useState({ instructor_id: '', day_of_week: '', time_slot: '' })
  const [saving,        setSaving]       = useState(false)
  const [showOpenings,  setShowOpenings] = useState(false)
  const [editingSlotId, setEditingSlotId] = useState(null)
  const [editSlot,      setEditSlot]     = useState({ day_of_week: '', time_slot: '' })

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

  function startEdit(slot) {
    setEditingSlotId(slot.id)
    setEditSlot({ day_of_week: slot.day_of_week, time_slot: slot.time_slot || '' })
  }

  async function handleSaveEdit(slotId) {
    if (!editSlot.day_of_week) return
    const updated = await api.updateInstructorAvailability(slotId, editSlot)
    onChanged(availability.map(a => a.id === slotId ? updated : a))
    setEditingSlotId(null)
  }

  // Group by day (in DAYS order), then by time slot within each day
  const byDay = {}
  for (const slot of availability) {
    if (!byDay[slot.day_of_week]) byDay[slot.day_of_week] = {}
    const key = slot.time_slot || '__none__'
    if (!byDay[slot.day_of_week][key]) byDay[slot.day_of_week][key] = []
    byDay[slot.day_of_week][key].push(slot)
  }

  const totalUnfilled = DAYS.reduce((n, d) => n + (grouped[d] || []).filter(isUnfilled).length, 0)
  const daysWithSlots = DAYS.filter(d => byDay[d])

  return (
    <div className="space-y-6">
      {/* Openings toggle */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {availability.length} slot{availability.length !== 1 ? 's' : ''} across {daysWithSlots.length} day{daysWithSlots.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => setShowOpenings(s => !s)}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            showOpenings ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {showOpenings ? '▾' : '▸'}
          {showOpenings ? 'Hide' : 'Show'} current openings
          {!showOpenings && totalUnfilled > 0 && (
            <span className="bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full text-[10px] font-bold">{totalUnfilled}</span>
          )}
        </button>
      </div>

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

      {/* By-day availability grid */}
      {daysWithSlots.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No availability recorded yet.</p>
      ) : (
        <div className="space-y-5">
          {daysWithSlots.map(day => {
            const timeGroups = byDay[day]
            const parseTime = s => {
              const meridiem = (s.match(/(am|pm)/i) || [''])[0].toLowerCase()
              const m = s.match(/(\d+)(?::(\d+))?/)
              if (!m) return 9999
              let h = parseInt(m[1], 10)
              const min = parseInt(m[2] || '0', 10)
              if (meridiem === 'pm' && h !== 12) h += 12
              if (meridiem === 'am' && h === 12) h = 0
              return h * 60 + min
            }
            const timeKeys = Object.keys(timeGroups).sort((a, b) => {
              if (a === '__none__') return 1
              if (b === '__none__') return -1
              return parseTime(a) - parseTime(b)
            })
            return (
              <section key={day}>
                <h3 className="text-sm font-bold text-gray-800 border-l-4 border-purple-400 pl-2 mb-2">{day}</h3>
                <div className="space-y-2 pl-1">
                  {timeKeys.map(timeKey => {
                    const slots = timeGroups[timeKey]
                    return (
                      <div key={timeKey}>
                        {timeKey !== '__none__' && (
                          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">{timeKey}</p>
                        )}
                        <div className="space-y-1.5">
                          {slots.map(slot => {
                            const styles = [slot.instructor_style, slot.instructor_specialties].filter(Boolean).join(' · ')
                            if (editingSlotId === slot.id) {
                              return (
                                <div key={slot.id} className="bg-white border border-purple-300 rounded-xl px-3 py-2 flex flex-wrap gap-2 items-center">
                                  <select value={editSlot.day_of_week} onChange={e => setEditSlot(s => ({ ...s, day_of_week: e.target.value }))}
                                    className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                                    {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                                  </select>
                                  <input value={editSlot.time_slot} onChange={e => setEditSlot(s => ({ ...s, time_slot: e.target.value }))}
                                    placeholder="e.g. 10am–noon" className="border border-gray-300 rounded-lg px-2 py-1 text-xs w-28" />
                                  <button onClick={() => handleSaveEdit(slot.id)}
                                    className="px-3 py-1 bg-gray-900 text-white text-xs rounded-lg">Save</button>
                                  <button onClick={() => setEditingSlotId(null)}
                                    className="px-3 py-1 border border-gray-300 text-gray-500 text-xs rounded-lg">Cancel</button>
                                </div>
                              )
                            }
                            return (
                              <div key={slot.id} className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2 group">
                                <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                                  <Link to={`/instructors/${slot.instructor_id}`}
                                    className="text-sm font-semibold text-gray-800 hover:text-purple-700 hover:underline whitespace-nowrap">
                                    {slot.instructor_name}
                                  </Link>
                                  {slot.instructor_neighborhood && (
                                    <span className="text-xs text-gray-500 whitespace-nowrap">📍 {slot.instructor_neighborhood}</span>
                                  )}
                                  {styles && (
                                    <span className="text-xs text-gray-400 italic truncate">{styles}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => startEdit(slot)}
                                    className="text-gray-400 hover:text-purple-600 text-xs leading-none" title="Edit">✎</button>
                                  <button onClick={() => handleDelete(slot.id)}
                                    className="text-gray-300 hover:text-red-500 text-xs leading-none" title="Delete">✕</button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RecruitingPage() {
  const [searchParams] = useSearchParams()
  const location       = useLocation()
  const targetEntryId  = searchParams.get('entry') ? Number(searchParams.get('entry')) : null

  const [tab,           setTab]           = useState(location.state?.tab || 'entries')
  const [grouped,       setGrouped]       = useState({})
  const [clients,       setClients]       = useState([])
  const [instructors,   setInstructors]   = useState([])
  const [actionTypes,   setActionTypes]   = useState([])
  const [users,         setUsers]         = useState([])
  const [availability,  setAvailability]  = useState([])
  const [query,         setQuery]         = useState('')
  const [showArchived,  setShowArchived]  = useState(false)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')
  const searchTimer = useRef(null)

  const load = useCallback((q = '', archived = false) => {
    setLoading(true)
    Promise.all([
      api.getRecruiting(q || undefined, { archived }),
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

  useEffect(() => { load('', showArchived) }, [load, showArchived])

  function handleSearchChange(q) {
    setQuery(q)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(q, showArchived), 250)
  }

  function toggleArchived() {
    setQuery('')
    setShowArchived(v => !v)
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

  function handleEntryArchived(updated) {
    // Remove from current view (archived/unarchived toggle causes it to disappear)
    setGrouped(prev => {
      const next = {}
      DAYS.forEach(d => { next[d] = (prev[d] || []).filter(e => e.id !== updated.id) })
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
          <div className="flex items-center gap-2">
            <button
              onClick={toggleArchived}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                showArchived
                  ? 'bg-gray-200 border-gray-300 text-gray-700 font-medium'
                  : 'border-gray-300 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {showArchived ? 'Showing archived' : 'Show archived'}
            </button>
            {!showArchived && (
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  value={query}
                  onChange={e => handleSearchChange(e.target.value)}
                  placeholder="Search client, style, neighborhood…"
                  className="border border-gray-300 rounded-lg pl-8 pr-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 w-64"
                />
              </div>
            )}
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
          {showArchived && (
            <p className="text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2">
              Showing archived entries. <button onClick={toggleArchived} className="underline hover:text-gray-800">Back to active entries</button>
            </p>
          )}
          {DAYS.filter(day => !query || (grouped[day]?.length > 0)).map(day => (
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
              onArchived={handleEntryArchived}
              onCreated={handleEntryCreated}
              defaultOpen={day === 'Sunday'}
              targetEntryId={targetEntryId}
              forceOpen={!!query}
            />
          ))}
          {query && totalEntries === 0 && (
            <p className="text-sm text-gray-400 italic px-2">No entries match "{query}".</p>
          )}
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
