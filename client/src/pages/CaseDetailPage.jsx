import { useEffect, useState, useRef } from 'react'
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

// ── Follow-up thread (WhatsApp style) ─────────────────────────────────────────

function NoteThread({ notes }) {
  if (!notes.length) return null
  return (
    <div className="space-y-2 mt-3">
      {notes.map(n => (
        <div key={n.id} className="flex gap-2 items-start">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
            {n.author_initials}
          </div>
          <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2 max-w-lg">
            <p className="text-sm text-gray-800 leading-snug">{n.text}</p>
            <p className="text-[10px] text-gray-400 mt-1">{fmtShort(n.created_at)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Add-note input ─────────────────────────────────────────────────────────────

function AddNoteInput({ actionItemId, onAdded }) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef(null)

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
      setText('')
      ref.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2 mt-3">
      <input
        ref={ref}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Add a follow-up note…"
        className="flex-1 border border-gray-300 rounded-full px-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
      />
      <button
        type="submit"
        disabled={saving || !text.trim()}
        className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded-full font-medium disabled:opacity-40 hover:bg-gray-700 transition-colors"
      >
        Send
      </button>
    </form>
  )
}

// ── Action Item Card ───────────────────────────────────────────────────────────

function ActionItemCard({ item: initItem, actionTypes, delegates, onDeleted }) {
  const [item, setItem] = useState(initItem)
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    action_type_id: item.action_type_id,
    delegate_id: item.delegate_id || '',
    initial_note: item.initial_note || '',
  })
  const [saving, setSaving] = useState(false)

  function handleNoteAdded(note) {
    setItem(prev => ({ ...prev, notes: [...prev.notes, note] }))
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
        action_type_id: Number(editForm.action_type_id),
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

  const isResolved = item.status === 'resolved'

  return (
    <div className={`rounded-xl border transition-colors ${isResolved ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200 bg-white shadow-sm'}`}>
      {/* Card header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        {/* Status toggle — stop propagation so click doesn't collapse card */}
        <button
          onClick={e => { e.stopPropagation(); toggleStatus() }}
          title={isResolved ? 'Reopen' : 'Mark resolved'}
          className={`flex-shrink-0 w-5 h-5 rounded-full border-2 transition-colors ${
            isResolved
              ? 'bg-green-500 border-green-500'
              : 'border-gray-400 hover:border-green-500'
          }`}
        >
          {isResolved && (
            <svg className="w-full h-full text-white" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </button>

        <div className="flex-1 flex flex-wrap items-center gap-2 min-w-0">
          <ActionTypeBadge name={item.action_type_name} color={item.action_type_color} />
          <DelegateBadge name={item.delegate_name} />
          {isResolved && (
            <span className="text-xs text-green-600 font-medium">Resolved {fmtShort(item.resolved_at)}</span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Action Type</label>
                <select
                  value={editForm.action_type_id}
                  onChange={e => setEditForm(f => ({ ...f, action_type_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                >
                  {actionTypes.map(at => (
                    <option key={at.id} value={at.id}>{at.name}</option>
                  ))}
                </select>
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
                <textarea
                  value={editForm.initial_note}
                  onChange={e => setEditForm(f => ({ ...f, initial_note: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving}
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
                <p className="mt-3 text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  {item.initial_note}
                </p>
              )}
              <NoteThread notes={item.notes} />
              {!isResolved && (
                <AddNoteInput actionItemId={item.id} onAdded={handleNoteAdded} />
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
    action_type_id: actionTypes[0]?.id || '',
    delegate_id: '',
    initial_note: '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const item = await api.createActionItem({
        case_id: caseId,
        action_type_id: Number(form.action_type_id),
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
            <label className="block text-xs font-medium text-gray-600 mb-1">Action Type</label>
            <select
              value={form.action_type_id}
              onChange={e => setForm(f => ({ ...f, action_type_id: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              required
            >
              {actionTypes.map(at => (
                <option key={at.id} value={at.id}>{at.name}</option>
              ))}
            </select>
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
            <textarea
              value={form.initial_note}
              onChange={e => setForm(f => ({ ...f, initial_note: e.target.value }))}
              rows={3}
              placeholder="Describe what needs to be done…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
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
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
        <div className="flex items-start justify-between gap-4">
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

          {/* Resolve / Reopen */}
          <div className="flex-shrink-0">
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
