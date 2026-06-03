import { useEffect, useState, useRef, useLayoutEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import ActionTypeBadge from '../components/ActionTypeBadge'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function fmtShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function DelegateBadge({ name }) {
  if (!name) return <span className="text-gray-400 text-xs italic">Anyone</span>
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold">
      {name}
    </span>
  )
}

// ── Auto-expanding textarea ───────────────────────────────────────────────────

function AutoTextarea({ value, onChange, placeholder, className, minRows = 2, onKeyDown }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    ref.current.style.height = 'auto'
    ref.current.style.height = `${ref.current.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      rows={minRows}
      className={`resize-none overflow-hidden ${className}`}
    />
  )
}

// ── Individual note with inline edit ─────────────────────────────────────────

function NoteItem({ note, onEdited }) {
  const { user } = useAuth()
  const [editing, setEditing] = useState(false)
  const [text, setText]       = useState(note.text)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const canEdit = user?.role === 'admin' || user?.initials === note.author_initials
  const wasEdited = note.updated_at && note.updated_at !== note.created_at

  async function handleSave() {
    if (!text.trim()) return
    setError('')
    setSaving(true)
    try {
      const updated = await api.updateNote(note.action_item_id, note.id, { text: text.trim() })
      onEdited(updated)
      setEditing(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { setText(note.text); setEditing(false) }
  }

  return (
    <div className="flex gap-2 items-start group">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
        {note.author_initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2">
          {editing ? (
            <AutoTextarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              minRows={2}
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          ) : (
            <p className="text-sm text-gray-800 leading-snug whitespace-pre-wrap">{note.text}</p>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 px-1">
          <p className="text-[10px] text-gray-400">
            {fmtShort(note.created_at)}
            {wasEdited && <span className="ml-1 italic">· edited</span>}
          </p>
          {editing ? (
            <>
              {error && <span className="text-[10px] text-red-500">{error}</span>}
              <button
                onClick={handleSave}
                disabled={saving || !text.trim()}
                className="text-[10px] font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setText(note.text); setEditing(false); setError('') }}
                className="text-[10px] text-gray-400 hover:text-gray-700"
              >
                Cancel
              </button>
            </>
          ) : (
            canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="text-[10px] text-gray-300 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Edit note"
              >
                ✏︎ edit
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ── Follow-up thread ──────────────────────────────────────────────────────────

function NoteThread({ notes, onNoteEdited }) {
  if (!notes.length) return null
  return (
    <div className="space-y-3 mt-3">
      {notes.map(n => (
        <NoteItem key={n.id} note={n} onEdited={onNoteEdited} />
      ))}
    </div>
  )
}

// ── Add-note input ────────────────────────────────────────────────────────────

function AddNoteInput({ actionItemId, caseId, delegates, onAdded }) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [wantReminder, setWantReminder] = useState(false)
  const [reminderDate, setReminderDate] = useState('')
  const [reminderDelegate, setReminderDelegate] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSaving(true)
    try {
      const note = await api.addNote(actionItemId, {
        text: text.trim(),
        author_initials: user.initials,
      })
      onAdded(note)

      if (wantReminder && reminderDate) {
        await api.createReminder({
          title: text.trim(),
          remind_on: reminderDate,
          delegate_name: reminderDelegate || null,
          action_item_id: actionItemId,
          case_id: caseId || null,
        })
      }

      setText('')
      setWantReminder(false)
      setReminderDate('')
      setReminderDelegate('')
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e) {
    // Ctrl+Enter or Cmd+Enter submits; plain Enter adds a newline
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit(e)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <div className="flex gap-2 items-end">
        <AutoTextarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a follow-up note… (Ctrl+Enter to send)"
          minRows={1}
          className="flex-1 border border-gray-300 rounded-2xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
        <button
          type="submit"
          disabled={saving || !text.trim() || (wantReminder && !reminderDate)}
          className="flex-shrink-0 px-4 py-2 bg-gray-900 text-white text-sm rounded-full font-medium disabled:opacity-40 hover:bg-gray-700 transition-colors"
        >
          Send
        </button>
      </div>

      {/* Optional reminder row */}
      <div className="flex flex-wrap items-center gap-2 pl-1">
        <input
          id={`reminder-check-${actionItemId}`}
          type="checkbox"
          checked={wantReminder}
          onChange={e => setWantReminder(e.target.checked)}
          className="w-3.5 h-3.5 rounded accent-gray-700"
        />
        <label htmlFor={`reminder-check-${actionItemId}`} className="text-xs text-gray-500 cursor-pointer">
          Set reminder for follow-up
        </label>
        {wantReminder && (
          <>
            <input
              type="date"
              value={reminderDate}
              onChange={e => setReminderDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-300"
            />
            <select
              value={reminderDelegate}
              onChange={e => setReminderDelegate(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-300"
            >
              <option value="">Anyone</option>
              {(delegates || []).map(d => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </>
        )}
      </div>
    </form>
  )
}

// ── Action Item Card ───────────────────────────────────────────────────────────

function ActionItemCard({ item: initItem, actionTypes, delegates, onDeleted, caseContext }) {
  const [item, setItem] = useState(initItem)
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [showReminderForm, setShowReminderForm] = useState(false)
  const [reminderForm, setReminderForm] = useState({ title: '', remind_on: '', delegate_name: '' })
  const [reminderSaving, setReminderSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    action_type_ids: (item.action_types || []).map(at => at.id),
    delegate_id: item.delegate_id || '',
    initial_note: item.initial_note || '',
  })
  const [saving, setSaving] = useState(false)

  const defaultReminderTitle = [
    item.action_type_name,
    caseContext?.client_name || caseContext?.instructor_name,
  ].filter(Boolean).join(' — ')

  async function handleSaveReminder(e) {
    e.preventDefault()
    if (!reminderForm.title.trim() || !reminderForm.remind_on) return
    setReminderSaving(true)
    try {
      await api.createReminder({
        title: reminderForm.title.trim(),
        remind_on: reminderForm.remind_on,
        delegate_name: reminderForm.delegate_name || null,
        action_item_id: item.id,
        case_id: caseContext?.id || null,
        client_id: caseContext?.client_id || null,
        instructor_id: caseContext?.instructor_id || null,
      })
      setShowReminderForm(false)
      setReminderForm({ title: '', remind_on: '', delegate_name: '' })
    } finally {
      setReminderSaving(false)
    }
  }

  function handleNoteAdded(note) {
    setItem(prev => ({ ...prev, notes: [...prev.notes, note] }))
  }

  function handleNoteEdited(updatedNote) {
    setItem(prev => ({
      ...prev,
      notes: prev.notes.map(n => n.id === updatedNote.id ? updatedNote : n),
    }))
  }

  async function toggleStatus() {
    const next = item.status === 'open' ? 'resolved' : 'open'
    const updated = await api.setActionItemStatus(item.id, next)
    setItem(prev => ({ ...prev, ...updated }))
  }

  async function saveEdit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await api.updateActionItem(item.id, {
        action_type_ids: editForm.action_type_ids.map(Number),
        delegate_id: editForm.delegate_id ? Number(editForm.delegate_id) : null,
        initial_note: editForm.initial_note,
      })
      setItem(prev => ({ ...prev, ...updated }))
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this action item?')) return
    await api.deleteActionItem(item.id)
    onDeleted(item.id)
  }

  async function handleToggleStar() {
    const newStarred = !item.starred
    setItem(prev => ({ ...prev, starred: newStarred ? 1 : 0 }))
    await api.starActionItem(item.id, newStarred)
  }

  const isResolved = item.status === 'resolved'
  const wasEdited = item.updated_at && item.updated_at !== item.created_at

  return (
    <div className={`rounded-xl border transition-colors ${isResolved ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200 bg-white shadow-sm'}`}>
      {/* Card header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        {/* Status toggle */}
        <button
          onClick={e => { e.stopPropagation(); toggleStatus() }}
          title={isResolved ? 'Reopen' : 'Mark resolved'}
          className={`flex-shrink-0 w-5 h-5 rounded-full border-2 transition-colors ${
            isResolved ? 'bg-green-500 border-green-500' : 'border-gray-400 hover:border-green-500'
          }`}
        >
          {isResolved && (
            <svg className="w-full h-full text-white" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </button>

        <div className="flex-1 flex flex-wrap items-center gap-2 min-w-0">
          {(item.action_types || []).map(at => (
            <ActionTypeBadge key={at.id} name={at.name} color={at.color} />
          ))}
          <DelegateBadge name={item.delegate_name} />
          {isResolved && (
            <span className="text-xs text-green-600 font-medium">Resolved {fmtShort(item.resolved_at)}</span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Star button */}
          <button
            onClick={e => { e.stopPropagation(); handleToggleStar() }}
            title={item.starred ? 'Unstar' : 'Star this item'}
            className={`text-lg leading-none transition-colors ${item.starred ? 'text-yellow-400 hover:text-yellow-500' : 'text-gray-200 hover:text-yellow-300'}`}
          >
            ★
          </button>
          {!isResolved && (
            <button
              onClick={e => { e.stopPropagation(); setShowReminderForm(v => !v); setReminderForm({ title: defaultReminderTitle, remind_on: '' }) }}
              className="text-xs text-gray-400 hover:text-blue-600"
              title="Set a reminder"
            >
              🔔 Remind
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); setEditing(v => !v) }}
            className="text-xs text-gray-400 hover:text-gray-700"
          >
            Edit
          </button>
          <button
            onClick={e => { e.stopPropagation(); handleDelete() }}
            className="text-xs text-gray-400 hover:text-red-600"
          >
            Delete
          </button>
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Expanded body */}
      {open && (
        <div className="px-4 pb-4 border-t border-gray-100">
          {editing ? (
            <form onSubmit={saveEdit} className="mt-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Action Types
                  {editForm.action_type_ids.length === 0 && (
                    <span className="ml-2 text-red-500 font-normal">pick at least one</span>
                  )}
                </label>
                <div className="border border-gray-300 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                  {actionTypes.map(at => (
                    <label key={at.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.action_type_ids.includes(at.id)}
                        onChange={() => setEditForm(f => ({
                          ...f,
                          action_type_ids: f.action_type_ids.includes(at.id)
                            ? f.action_type_ids.filter(id => id !== at.id)
                            : [...f.action_type_ids, at.id],
                        }))}
                        className="w-3.5 h-3.5 accent-gray-700"
                      />
                      <ActionTypeBadge name={at.name} color={at.color} size="xs" />
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Delegate</label>
                <select
                  value={editForm.delegate_id}
                  onChange={e => setEditForm(f => ({ ...f, delegate_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="">Anyone</option>
                  {delegates.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Initial Note</label>
                <AutoTextarea
                  value={editForm.initial_note}
                  onChange={e => setEditForm(f => ({ ...f, initial_note: e.target.value }))}
                  minRows={3}
                  placeholder="Describe what needs to be done…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving || editForm.action_type_ids.length === 0}
                  className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg font-medium disabled:opacity-50">
                  Save
                </button>
                <button type="button" onClick={() => setEditing(false)}
                  className="px-3 py-1.5 text-gray-600 text-xs rounded-lg border border-gray-300">
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              {item.initial_note && (
                <div className="mt-3">
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 whitespace-pre-wrap leading-relaxed">
                    {item.initial_note}
                  </p>
                  {wasEdited && (
                    <p className="text-[10px] text-gray-400 mt-1 px-1 italic">edited {fmtShort(item.updated_at)}</p>
                  )}
                </div>
              )}

              {/* Inline Set Reminder form */}
              {showReminderForm && (
                <form onSubmit={handleSaveReminder} className="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-3 space-y-2">
                  <p className="text-xs font-semibold text-blue-700">🔔 Set Reminder</p>
                  <input
                    required
                    value={reminderForm.title}
                    onChange={e => setReminderForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Reminder title…"
                    className="w-full border border-blue-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      required
                      type="date"
                      value={reminderForm.remind_on}
                      onChange={e => setReminderForm(f => ({ ...f, remind_on: e.target.value }))}
                      className="border border-blue-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    <select
                      value={reminderForm.delegate_name}
                      onChange={e => setReminderForm(f => ({ ...f, delegate_name: e.target.value }))}
                      className="border border-blue-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                    >
                      <option value="">Anyone</option>
                      {delegates.map(d => (
                        <option key={d.id} value={d.name}>{d.name}</option>
                      ))}
                    </select>
                    <button type="submit" disabled={reminderSaving || !reminderForm.title.trim() || !reminderForm.remind_on}
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg disabled:opacity-50 hover:bg-blue-700">
                      {reminderSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setShowReminderForm(false)}
                      className="px-3 py-1.5 border border-blue-200 text-blue-600 text-xs rounded-lg hover:bg-blue-100">
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <NoteThread notes={item.notes} onNoteEdited={handleNoteEdited} />
              {!isResolved && (
                <AddNoteInput actionItemId={item.id} caseId={caseContext?.id} delegates={delegates} onAdded={handleNoteAdded} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Add Action Item modal ──────────────────────────────────────────────────────

function AddActionItemModal({ caseId, actionTypes, delegates, onClose, onAdded }) {
  const [form, setForm] = useState({
    action_type_ids: actionTypes[0] ? [actionTypes[0].id] : [],
    delegate_id: '',
    initial_note: '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.action_type_ids.length) return
    setSaving(true)
    try {
      const item = await api.createActionItem({
        case_id: caseId,
        action_type_ids: form.action_type_ids.map(Number),
        delegate_id: form.delegate_id ? Number(form.delegate_id) : null,
        initial_note: form.initial_note,
      })
      onAdded(item)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h3 className="font-bold text-gray-900 mb-4">Add Action Item</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Action Types
              {form.action_type_ids.length === 0 && (
                <span className="ml-2 text-red-500 font-normal">pick at least one</span>
              )}
            </label>
            <div className="border border-gray-300 rounded-lg divide-y divide-gray-100 max-h-44 overflow-y-auto">
              {actionTypes.map(at => (
                <label key={at.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.action_type_ids.includes(at.id)}
                    onChange={() => setForm(f => ({
                      ...f,
                      action_type_ids: f.action_type_ids.includes(at.id)
                        ? f.action_type_ids.filter(id => id !== at.id)
                        : [...f.action_type_ids, at.id],
                    }))}
                    className="w-3.5 h-3.5 accent-gray-700"
                  />
                  <ActionTypeBadge name={at.name} color={at.color} size="xs" />
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Delegate</label>
            <select
              value={form.delegate_id}
              onChange={e => setForm(f => ({ ...f, delegate_id: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {delegates.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Initial Note</label>
            <AutoTextarea
              value={form.initial_note}
              onChange={e => setForm(f => ({ ...f, initial_note: e.target.value }))}
              minRows={3}
              placeholder="Describe what needs to be done…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving || form.action_type_ids.length === 0}
              className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors"
            >
              {saving ? 'Adding…' : 'Add Action Item'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function CaseDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [caseData, setCaseData] = useState(null)
  const [actionTypes, setActionTypes] = useState([])
  const [delegates, setDelegates] = useState([])
  const [error, setError] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    Promise.all([
      api.getCase(id),
      api.getActionTypes(),
      api.getDelegates(),
    ])
      .then(([c, at, d]) => {
        setCaseData(c)
        setActionTypes(at)
        setDelegates(d)
      })
      .catch(e => setError(e.message))
  }, [id])

  async function handleResolveCase() {
    if (!confirm('Mark this entire case as resolved?')) return
    setResolving(true)
    try {
      const updated = await api.setCaseStatus(id, 'resolved')
      setCaseData(prev => ({ ...prev, status: updated.status, resolved_at: updated.resolved_at }))
    } finally {
      setResolving(false)
    }
  }

  async function handleReopenCase() {
    setResolving(true)
    try {
      const updated = await api.setCaseStatus(id, 'open')
      setCaseData(prev => ({ ...prev, status: updated.status, resolved_at: updated.resolved_at }))
    } finally {
      setResolving(false)
    }
  }

  function handleItemAdded(item) {
    setCaseData(prev => ({
      ...prev,
      action_items: [...prev.action_items, { ...item, notes: item.notes || [] }],
    }))
  }

  function handleItemDeleted(itemId) {
    setCaseData(prev => ({
      ...prev,
      action_items: prev.action_items.filter(i => i.id !== itemId),
    }))
  }

  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (!caseData) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  const openItems = caseData.action_items.filter(i => i.status === 'open')
  const resolvedItems = caseData.action_items.filter(i => i.status === 'resolved')
  const isResolved = caseData.status === 'resolved'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Case header */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Case #{caseData.id}</span>
              {isResolved ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                  Resolved
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                  Open
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">Opened {fmt(caseData.created_at)}</p>
            {isResolved && caseData.resolved_at && (
              <p className="text-xs text-green-600">Resolved {fmt(caseData.resolved_at)}</p>
            )}
          </div>

          <div className="flex-shrink-0 self-start sm:self-auto">
            {isResolved ? (
              <button
                onClick={handleReopenCase}
                disabled={resolving}
                className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Reopen Case
              </button>
            ) : (
              <button
                onClick={handleResolveCase}
                disabled={resolving}
                className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {resolving ? 'Resolving…' : 'Resolve Case'}
              </button>
            )}
          </div>
        </div>

        {/* Linked client + instructor */}
        <div className="mt-4 flex flex-wrap gap-4">
          {caseData.client_id && (
            <div>
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Client</p>
              <Link
                to={`/clients/${caseData.client_id}`}
                className="text-sm font-semibold text-blue-700 hover:underline"
              >
                {caseData.client_name}
              </Link>
            </div>
          )}
          {caseData.instructor_id && (
            <div>
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Instructor</p>
              <Link
                to={`/instructors/${caseData.instructor_id}`}
                className="text-sm font-semibold text-blue-700 hover:underline"
              >
                {caseData.instructor_name}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Action items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500">
            Action Items
            <span className="ml-2 text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
              {openItems.length} open
            </span>
          </h2>
          {!isResolved && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Action Item
            </button>
          )}
        </div>

        <div className="space-y-3">
          {openItems.map(item => (
            <ActionItemCard
              key={item.id}
              item={item}
              actionTypes={actionTypes}
              delegates={delegates}
              onDeleted={handleItemDeleted}
              caseContext={caseData}
            />
          ))}
          {openItems.length === 0 && (
            <p className="text-sm text-gray-400 italic px-2">No open action items.</p>
          )}
        </div>

        {resolvedItems.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Resolved</h3>
            <div className="space-y-3">
              {resolvedItems.map(item => (
                <ActionItemCard
                  key={item.id}
                  item={item}
                  actionTypes={actionTypes}
                  delegates={delegates}
                  onDeleted={handleItemDeleted}
                  caseContext={caseData}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {showAddModal && (
        <AddActionItemModal
          caseId={Number(id)}
          actionTypes={actionTypes}
          delegates={delegates}
          onClose={() => setShowAddModal(false)}
          onAdded={handleItemAdded}
        />
      )}
    </div>
  )
}
