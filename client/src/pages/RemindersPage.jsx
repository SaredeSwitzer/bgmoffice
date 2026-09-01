import { useEffect, useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { navClick } from '../utils/nav'
import { useAuth } from '../context/AuthContext'
import { useRemindersContext } from '../context/RemindersContext'
import { ClientLink, InstructorLink } from '../components/NameLink'
import AddReminderModal from '../components/AddReminderModal'
import FirstClassReminderModal from '../components/FirstClassReminderModal'
import ResumingClassesModal from '../components/ResumingClassesModal'
import InstructorCheckInModal from '../components/InstructorCheckInModal'
import WaiverContractReminderModal from '../components/WaiverContractReminderModal'
import SearchSelect from '../components/SearchSelect'
import MentionTextarea from '../components/MentionTextarea'
import { renderWithMentions } from '../utils/mentions'
import { useHashHighlight } from '../utils/hashHighlight'
import { ymd, noteTime } from '../utils/dates'

// Local date, not UTC — see utils/dates.js.
const today = ymd

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date} ${time}`
}

function fmtShort(iso) {
  if (!iso) return ''
  return fmt(iso)
}

// ── Follow-up modal ───────────────────────────────────────────────────────────

function FollowUpModal({ reminder, onClose, onAddReminder, navigate }) {
  const [selected, setSelected] = useState('')

  const clientId     = reminder.client_id
  const clientName   = reminder.case_client_name || reminder.client_name
  const instructorId = reminder.instructor_id
  const instructorName = reminder.case_instructor_name || reminder.instructor_name

  const options = [
    ...(reminder.case_id
      ? [{ value: `case:${reminder.case_id}`, label: `Go to Case →${clientName ? ` (${clientName})` : ''}` }]
      : []),
    ...(clientId
      ? [{ value: `client:${clientId}`, label: `Go to Client Profile →${clientName ? ` (${clientName})` : ''}` }]
      : []),
    ...(instructorId
      ? [{ value: `instructor:${instructorId}`, label: `Go to Instructor Profile →${instructorName ? ` (${instructorName})` : ''}` }]
      : []),
    { value: 'add-reminder', label: 'Add a New Reminder' },
    { value: 'tasks',        label: 'Go to Tasks →' },
    { value: 'invoices',     label: 'Go to Invoices →' },
    { value: 'clients',      label: 'Go to Clients →' },
    { value: 'recruiting',   label: 'Go to Recruiting →' },
  ]

  function handleGo() {
    if (!selected) return
    if (selected === 'add-reminder') {
      onAddReminder()
      return
    }
    const [type, id] = selected.split(':')
    if (type === 'case')       navigate(`/cases/${id}`)
    else if (type === 'client')      navigate(`/clients/${id}`)
    else if (type === 'instructor')  navigate(`/instructors/${id}`)
    else navigate(`/${selected}`)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        <div className="text-center mb-5">
          <div className="text-3xl mb-2">✅</div>
          <h2 className="text-base font-bold text-gray-900">Marked as done!</h2>
          <p className="text-sm text-gray-500 mt-1">Would you like to assign a follow-up?</p>
        </div>
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-white"
        >
          <option value="">Select a follow-up action…</option>
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button
            onClick={handleGo}
            disabled={!selected}
            className="flex-1 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors"
          >
            Go
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
          >
            No Thanks
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Note thread (once a reminder is due) ───────────────────────────────────────
// Lazily loaded on expand — most reminders never get a note, so there's no reason to
// fetch a thread for every row on page load. "Send" tags whoever's mentioned the same
// way replies do everywhere else in the app (task replies, action item follow-ups).

function ReminderNoteThread({ reminderId, initialCount, mentionableUsers, autoOpen }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(!!autoOpen)
  const [loading, setLoading] = useState(false)
  const [notes, setNotes] = useState(null)
  const [count, setCount] = useState(initialCount || 0)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  useHashHighlight([notes])

  useEffect(() => {
    // A mention notification links straight to the reminder + note ("?id=<id>#note-<id>")
    // — open this thread automatically so useHashHighlight can find and scroll to it.
    if (autoOpen && notes === null) {
      setLoading(true)
      api.getReminderNotes(reminderId).then(setNotes).finally(() => setLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen])

  function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (notes === null) {
      setLoading(true)
      api.getReminderNotes(reminderId).then(setNotes).finally(() => setLoading(false))
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    try {
      const note = await api.addReminderNote(reminderId, text.trim())
      setNotes(prev => [...(prev || []), note])
      setCount(c => c + 1)
      setText('')
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(noteId) {
    await api.deleteReminderNote(reminderId, noteId)
    setNotes(prev => prev.filter(n => n.id !== noteId))
    setCount(c => Math.max(0, c - 1))
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={toggle} className="text-xs text-gray-400 hover:text-gray-700 font-medium">
        💬 {count > 0 ? `${count} note${count === 1 ? '' : 's'}` : 'Leave a note'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 bg-gray-50 border border-gray-100 rounded-xl p-3">
          {loading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : notes?.length > 0 ? (
            <div className="space-y-2">
              {notes.map(n => (
                <div key={n.id} id={`note-reminder_notes-${n.id}`} className="flex gap-2 items-start group">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600">
                    {n.author_initials}
                  </div>
                  <div className="flex-1 min-w-0 bg-white border border-gray-200 rounded-xl rounded-tl-sm px-2.5 py-1.5">
                    <p className="text-[10px] text-gray-400 mb-0.5">{noteTime(n.created_at)}</p>
                    <p className="text-xs text-gray-800 whitespace-pre-wrap">{renderWithMentions(n.text, mentionableUsers)}</p>
                  </div>
                  <button onClick={() => handleDelete(n.id)}
                    className="text-gray-300 hover:text-red-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs">✕</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No notes yet.</p>
          )}
          <form onSubmit={handleSend} className="flex gap-2 items-start">
            <MentionTextarea value={text} onChange={setText} users={mentionableUsers}
              placeholder={`Note as ${user?.initials}… (type @ to tag someone)`} rows={1}
              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none" />
            <button type="submit" disabled={sending || !text.trim()}
              className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg disabled:opacity-50 flex-shrink-0 hover:bg-gray-700 transition-colors">
              {sending ? '…' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Reminder row with inline edit ─────────────────────────────────────────────

function ReminderRow({ reminder, onDone, onDelete, onUpdated, isOverdue, delegates, clients, instructors, mentionableUsers, targetReminderId }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [form, setForm] = useState({
    title:         reminder.title,
    notes:         reminder.notes || '',
    remind_on:     reminder.remind_on,
    delegate_name: reminder.delegate_name || '',
  })

  // Derive initial client/instructor objects from the reminder's stored IDs + names
  const initClient = useMemo(() =>
    reminder.client_id
      ? { id: reminder.client_id, name: reminder.client_name || reminder.case_client_name || '' }
      : null,
  [reminder.client_id, reminder.client_name, reminder.case_client_name])

  const initInstructor = useMemo(() =>
    reminder.instructor_id
      ? { id: reminder.instructor_id, name: reminder.instructor_name || reminder.case_instructor_name || '' }
      : null,
  [reminder.instructor_id, reminder.instructor_name, reminder.case_instructor_name])

  const [editClient,     setEditClient]     = useState(initClient)
  const [editInstructor, setEditInstructor] = useState(initInstructor)

  const canEdit  = user?.role === 'admin' || user?.initials === reminder.created_by
  const wasEdited = reminder.updated_at

  async function handleDone() {
    setLoading(true)
    await onDone(reminder)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.title.trim() || !form.remind_on) return
    setError('')
    setSaving(true)
    try {
      const updated = await api.updateReminder(reminder.id, {
        title:         form.title.trim(),
        notes:         form.notes.trim() || null,
        remind_on:     form.remind_on,
        delegate_name: form.delegate_name || null,
        client_id:     editClient?.id     || null,
        instructor_id: editInstructor?.id || null,
      })
      onUpdated(updated)
      setEditing(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className={`px-4 py-3 rounded-xl border ${isOverdue ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
        <form onSubmit={handleSave} className="space-y-2.5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
            <input
              required
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-full">
              <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
              <input
                type="date"
                required
                value={form.remind_on}
                onChange={e => setForm(f => ({ ...f, remind_on: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Delegated to</label>
              <select
                value={form.delegate_name}
                onChange={e => setForm(f => ({ ...f, delegate_name: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 bg-white"
              >
                <option value="">Anyone</option>
                {delegates.map(d => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>
          <SearchSelect
            label="Client (optional)"
            options={clients}
            value={editClient}
            onChange={setEditClient}
            placeholder="Search clients…"
          />
          <SearchSelect
            label="Instructor (optional)"
            options={instructors}
            value={editInstructor}
            onChange={setEditInstructor}
            placeholder="Search instructors…"
          />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={3}
              placeholder="Optional details…"
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving || !form.title.trim() || !form.remind_on}
              className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setError('') }}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className={`flex items-start gap-4 px-4 py-3 rounded-xl border ${
      isOverdue ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${isOverdue ? 'text-red-800' : 'text-gray-900'}`}>
            {reminder.title}
          </span>
          {isOverdue && (
            <span className="text-xs font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">Overdue</span>
          )}
          {wasEdited && (
            <span className="text-xs text-gray-400 italic">· edited {fmtShort(reminder.updated_at)}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
          <span className={`text-xs ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
            📅 {fmtDate(reminder.remind_on)}
          </span>
          {reminder.delegate_name && (
            <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium">
              👤 {reminder.delegate_name}
            </span>
          )}
          {/* Client/instructor context — prefer case-derived name for action-item reminders */}
          {(reminder.case_client_name || reminder.client_name) && (
            <span className="text-xs text-gray-500">
              Client: <ClientLink id={reminder.client_id} name={reminder.case_client_name || reminder.client_name} />
            </span>
          )}
          {(reminder.case_instructor_name || reminder.instructor_name) && (
            <span className="text-xs text-gray-500">
              Instructor: <InstructorLink id={reminder.instructor_id} name={reminder.case_instructor_name || reminder.instructor_name} />
            </span>
          )}
          {reminder.action_item_id && (
            <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-medium">
              Action item #{reminder.action_item_id}
            </span>
          )}
          {reminder.case_id && (
            <button
              onClick={e => navClick(e, `/cases/${reminder.case_id}`, navigate)}
              className="text-xs text-blue-600 hover:underline font-medium"
            >
              View Case →
            </button>
          )}
          {reminder.invoice_id && (
            <button
              onClick={e => navClick(e, `/invoices/${reminder.invoice_id}`, navigate)}
              className="text-xs text-emerald-600 hover:underline font-medium"
            >
              View Invoice {reminder.invoice_number} →
            </button>
          )}
        </div>
        {reminder.notes && (
          <p className="text-xs text-gray-500 mt-1.5 italic whitespace-pre-wrap leading-relaxed">{reminder.notes}</p>
        )}
        {reminder.created_at && (
          <p className="text-[10px] text-gray-400 mt-1">
            Added {fmt(reminder.created_at)}{reminder.created_by ? ` — ${reminder.created_by}` : ''}
          </p>
        )}
        {(isOverdue || reminder.remind_on === today()) && (
          <ReminderNoteThread reminderId={reminder.id} initialCount={reminder.note_count} mentionableUsers={mentionableUsers}
            autoOpen={String(reminder.id) === targetReminderId} />
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-gray-400 hover:text-gray-700"
            title="Edit reminder"
          >
            Edit
          </button>
        )}
        <button
          onClick={handleDone}
          disabled={loading}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            isOverdue
              ? 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50'
              : 'bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50'
          }`}
        >
          {loading ? '…' : 'Mark Done'}
        </button>
        <button
          onClick={() => onDelete(reminder.id)}
          className="text-xs text-gray-400 hover:text-red-600"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({ title, accent, items, emptyMsg, onDone, onDelete, onUpdated, isOverdue, delegates, clients, instructors, mentionableUsers, targetReminderId }) {
  const accentClass = accent === 'red' ? 'border-red-400 text-red-700' : 'border-blue-400 text-blue-700'
  return (
    <section>
      <div className={`flex items-center gap-2 mb-3 pl-1 border-l-4 ${accentClass}`}>
        <h2 className="text-sm font-bold uppercase tracking-widest">{title}</h2>
        <span className="text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 italic px-2 py-4">{emptyMsg}</p>
      ) : (
        <div className="space-y-2">
          {items.map(r => (
            <ReminderRow
              key={r.id}
              reminder={r}
              isOverdue={isOverdue}
              onDone={onDone}
              onDelete={onDelete}
              onUpdated={onUpdated}
              delegates={delegates}
              clients={clients}
              instructors={instructors}
              mentionableUsers={mentionableUsers}
              targetReminderId={targetReminderId}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RemindersPage() {
  const { refresh: refreshBadge } = useRemindersContext()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Kept as a string, not Number() — reminder ids come back from Postgres as bigint
  // strings, and comparing against a Number would fail (same pitfall noted for tasks above).
  const targetReminderId = searchParams.get('id') || null
  const [overdue,     setOverdue]     = useState([])
  const [upcoming,    setUpcoming]    = useState([])
  const [delegates,   setDelegates]   = useState([])
  const [clients,     setClients]     = useState([])
  const [instructors, setInstructors] = useState([])
  const [mentionableUsers, setMentionableUsers] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showAdd,        setShowAdd]        = useState(false)
  const [showFirstClass, setShowFirstClass] = useState(false)
  const [showResuming,      setShowResuming]      = useState(false)
  const [showInstructorCheckIn, setShowInstructorCheckIn] = useState(false)
  const [showWaiverContract,    setShowWaiverContract]    = useState(false)
  const [followUpReminder, setFollowUpReminder] = useState(null)

  function load() {
    return api.getReminders().then(({ overdue: o, upcoming: u }) => {
      setOverdue(o)
      setUpcoming(u)
    })
  }

  useEffect(() => {
    Promise.all([
      load(),
      api.getDelegates().then(setDelegates),
      api.getClients().then(setClients),
      api.getInstructors().then(setInstructors),
      api.getMentionableUsers().then(setMentionableUsers),
    ]).finally(() => setLoading(false))
  }, [])

  async function handleDone(reminder) {
    await api.markReminderDone(reminder.id)
    await load()
    refreshBadge()
    setFollowUpReminder(reminder)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this reminder?')) return
    await api.deleteReminder(id)
    await load()
    refreshBadge()
  }

  function handleUpdated(updated) {
    const patch = list => list.map(r => r.id === updated.id ? { ...r, ...updated } : r)
    setOverdue(patch)
    setUpcoming(patch)
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Reminders</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowFirstClass(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors shadow-sm"
          >
            🎓 First Class Follow-Up
          </button>
          <button
            onClick={() => setShowResuming(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors shadow-sm"
          >
            🔄 Check In: Resuming
          </button>
          <button
            onClick={() => setShowInstructorCheckIn(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
          >
            👤 Instructor Check-In
          </button>
          <button
            onClick={() => setShowWaiverContract(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition-colors shadow-sm"
          >
            📝 Sign Waiver / Contract
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            + Add Reminder
          </button>
        </div>
      </div>

      <Section
        title="Overdue"
        accent="red"
        items={overdue}
        emptyMsg="No overdue reminders."
        isOverdue
        onDone={handleDone}
        onDelete={handleDelete}
        onUpdated={handleUpdated}
        delegates={delegates}
        clients={clients}
        instructors={instructors}
        mentionableUsers={mentionableUsers}
        targetReminderId={targetReminderId}
      />
      <Section
        title="Upcoming"
        accent="blue"
        items={upcoming}
        emptyMsg="No upcoming reminders — all clear!"
        isOverdue={false}
        onDone={handleDone}
        onDelete={handleDelete}
        onUpdated={handleUpdated}
        delegates={delegates}
        clients={clients}
        instructors={instructors}
        mentionableUsers={mentionableUsers}
        targetReminderId={targetReminderId}
      />

      {showAdd && (
        <AddReminderModal onClose={() => { setShowAdd(false); load(); refreshBadge() }} />
      )}
      {showFirstClass && (
        <FirstClassReminderModal onClose={() => { setShowFirstClass(false); load(); refreshBadge() }} />
      )}
      {showResuming && (
        <ResumingClassesModal onClose={() => { setShowResuming(false); load(); refreshBadge() }} />
      )}
      {showInstructorCheckIn && (
        <InstructorCheckInModal onClose={() => { setShowInstructorCheckIn(false); load(); refreshBadge() }} />
      )}
      {showWaiverContract && (
        <WaiverContractReminderModal onClose={() => { setShowWaiverContract(false); load(); refreshBadge() }} />
      )}
      {followUpReminder && (
        <FollowUpModal
          reminder={followUpReminder}
          navigate={navigate}
          onClose={() => setFollowUpReminder(null)}
          onAddReminder={() => { setFollowUpReminder(null); setShowAdd(true) }}
        />
      )}
    </div>
  )
}
