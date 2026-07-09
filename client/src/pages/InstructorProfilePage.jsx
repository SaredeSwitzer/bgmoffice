import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api, uploadsUrl } from '../api/client'
import ContactInfo from '../components/ContactInfo'
import CaseHistoryList from '../components/CaseHistoryList'
import NewCaseModal from '../components/NewCaseModal'
import DashboardFilterBar from '../components/DashboardFilterBar'

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date} ${time}`
}

function fmtDate(str) {
  if (!str) return ''
  // str is YYYY-MM-DD from date input
  const [y, m, d] = str.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m,10)-1]} ${parseInt(d,10)}, ${y}`
}

// ── Photo Avatar ──────────────────────────────────────────────────────────────
function PhotoAvatar({ instructor, onPhotoChange }) {
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const result = await api.uploadInstructorPhoto(instructor.id, file)
      onPhotoChange(result.photo_url)
    } catch (err) {
      alert(err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const src = uploadsUrl(instructor.photo_url)
  const initials = instructor.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="relative group flex-shrink-0">
      <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center border-2 border-white shadow">
        {src ? (
          <img src={src} alt={instructor.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xl font-bold text-gray-500">{initials}</span>
        )}
      </div>
      <button
        onClick={() => fileRef.current.click()}
        disabled={uploading}
        className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        title="Upload photo"
      >
        {uploading
          ? <span className="text-white text-xs">…</span>
          : <span className="text-white text-lg">📷</span>
        }
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  )
}

// ── SSN Field ─────────────────────────────────────────────────────────────────
function SSNField({ value }) {
  const [revealed, setRevealed] = useState(false)
  if (!value) return <span className="text-gray-400 italic text-sm">Not on file</span>
  return (
    <span className="font-mono text-sm flex items-center gap-2">
      {revealed ? value : '•••-••-' + value.slice(-4)}
      <button
        onClick={() => setRevealed(r => !r)}
        className="text-xs text-blue-600 hover:underline"
      >
        {revealed ? 'Hide' : 'Reveal'}
      </button>
    </span>
  )
}

// ── Documents Section ─────────────────────────────────────────────────────────
function DocumentsSection({ instructorId, documents, onDocAdded, onDocDeleted }) {
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const doc = await api.uploadInstructorDocument(instructorId, file)
      onDocAdded(doc)
    } catch (err) {
      alert(err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleDelete(docId) {
    if (!confirm('Delete this document?')) return
    await api.deleteInstructorDocument(instructorId, docId)
    onDocDeleted(docId)
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-gray-300">
          Documents
        </h2>
        <button
          onClick={() => fileRef.current.click()}
          disabled={uploading}
          className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : '+ Upload'}
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No documents uploaded.</p>
      ) : (
        <div className="space-y-2">
          {documents.map(doc => (
            <div key={doc.id} className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xl">📄</span>
                <div className="min-w-0">
                  <a
                    href={uploadsUrl(doc.filename)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-600 hover:underline truncate block"
                  >
                    {doc.original_name}
                  </a>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {fmt(doc.uploaded_at)} — {doc.uploaded_by}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleDelete(doc.id)}
                className="text-xs text-gray-400 hover:text-red-600 flex-shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Availability Section ──────────────────────────────────────────────────────
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function InstructorAvailabilitySection({ instructorId }) {
  const [slots,   setSlots]   = useState([])
  const [addForm, setAddForm] = useState({ day_of_week: '', time_slot: '' })
  const [saving,  setSaving]  = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editSlot,  setEditSlot]  = useState({ day_of_week: '', time_slot: '' })

  useEffect(() => {
    api.getInstructorAvailability()
      .then(all => setSlots(all.filter(s => s.instructor_id === Number(instructorId))))
      .catch(() => {})
  }, [instructorId])

  async function handleAdd(e) {
    e.preventDefault()
    if (!addForm.day_of_week) return
    setSaving(true)
    try {
      const row = await api.addInstructorAvailability({
        instructor_id: Number(instructorId),
        day_of_week:   addForm.day_of_week,
        time_slot:     addForm.time_slot || null,
      })
      setSlots(s => [...s, row])
      setAddForm({ day_of_week: '', time_slot: '' })
    } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    await api.deleteInstructorAvailability(id)
    setSlots(s => s.filter(x => x.id !== id))
  }

  function startEdit(slot) {
    setEditingId(slot.id)
    setEditSlot({ day_of_week: slot.day_of_week, time_slot: slot.time_slot || '' })
  }

  async function handleSaveEdit(id) {
    if (!editSlot.day_of_week) return
    const updated = await api.updateInstructorAvailability(id, editSlot)
    setSlots(s => s.map(x => x.id === id ? { ...x, ...updated } : x))
    setEditingId(null)
  }

  const byDay = {}
  for (const s of slots) {
    if (!byDay[s.day_of_week]) byDay[s.day_of_week] = []
    byDay[s.day_of_week].push(s)
  }
  const daysWithSlots = DAYS.filter(d => byDay[d])

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-purple-400">
          Availability
          {slots.length > 0 && (
            <span className="ml-2 text-xs font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">
              {slots.length}
            </span>
          )}
        </h2>
        <Link to="/recruiting" state={{ tab: 'availability' }}
          className="text-xs text-purple-600 hover:underline">
          View all →
        </Link>
      </div>

      {daysWithSlots.length === 0 ? (
        <p className="text-sm text-gray-400 italic mb-3">No availability recorded yet.</p>
      ) : (
        <div className="space-y-3 mb-4">
          {daysWithSlots.map(day => (
            <div key={day}>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 border-l-2 border-purple-300 pl-2">{day}</p>
              <div className="space-y-1.5 pl-1">
                {byDay[day].map(slot => {
                  if (editingId === slot.id) {
                    return (
                      <div key={slot.id} className="flex flex-wrap gap-2 items-center bg-white border border-purple-300 rounded-xl px-3 py-2">
                        <select value={editSlot.day_of_week} onChange={e => setEditSlot(s => ({ ...s, day_of_week: e.target.value }))}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                          {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <input value={editSlot.time_slot} onChange={e => setEditSlot(s => ({ ...s, time_slot: e.target.value }))}
                          placeholder="e.g. 10am–noon" className="border border-gray-300 rounded-lg px-2 py-1 text-xs w-28" />
                        <button onClick={() => handleSaveEdit(slot.id)}
                          className="px-3 py-1 bg-gray-900 text-white text-xs rounded-lg">Save</button>
                        <button onClick={() => setEditingId(null)}
                          className="px-3 py-1 border border-gray-300 text-gray-500 text-xs rounded-lg">Cancel</button>
                      </div>
                    )
                  }
                  return (
                    <div key={slot.id} className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2 group">
                      <span className="text-sm text-gray-700">
                        {slot.time_slot || <span className="text-gray-400 italic">No time set</span>}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(slot)}
                          className="text-gray-400 hover:text-purple-600 text-xs" title="Edit">✎</button>
                        <button onClick={() => handleDelete(slot.id)}
                          className="text-gray-300 hover:text-red-500 text-xs" title="Delete">✕</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-[10px] font-medium text-gray-500 mb-1">Day</label>
          <select value={addForm.day_of_week} onChange={e => setAddForm(f => ({ ...f, day_of_week: e.target.value }))}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
            <option value="">Select day…</option>
            {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-medium text-gray-500 mb-1">Time (optional)</label>
          <input value={addForm.time_slot} onChange={e => setAddForm(f => ({ ...f, time_slot: e.target.value }))}
            placeholder="e.g. 10am–noon" className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-36" />
        </div>
        <button type="submit" disabled={saving || !addForm.day_of_week}
          className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-40 hover:bg-gray-700">
          {saving ? 'Adding…' : '+ Add'}
        </button>
      </form>
    </section>
  )
}

// ── Feedback Notes ────────────────────────────────────────────────────────────

function fmtNoteDate(iso) {
  if (!iso) return ''
  const d = new Date(iso + (iso.includes('T') ? '' : 'Z'))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function FeedbackNotesSection({ instructorId, initialNotes }) {
  const [notes, setNotes] = useState(initialNotes || [])
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSaving(true)
    try {
      const note = await api.addInstructorNote(instructorId, text.trim())
      setNotes(n => [note, ...n])
      setText('')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(noteId) {
    if (!confirm('Delete this note?')) return
    await api.deleteInstructorNote(instructorId, noteId)
    setNotes(n => n.filter(x => x.id !== noteId))
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-amber-400">
          Feedback Notes
          {notes.length > 0 && (
            <span className="ml-2 text-xs font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
              {notes.length}
            </span>
          )}
        </h2>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5 space-y-4">
        <form onSubmit={handleAdd} className="flex gap-2 items-start">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd(e) }}
            rows={2}
            placeholder="Add a note… (Ctrl+Enter to save)"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
          <button type="submit" disabled={saving || !text.trim()}
            className="px-3 py-2 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-40 hover:bg-gray-700 whitespace-nowrap">
            {saving ? 'Saving…' : '+ Add'}
          </button>
        </form>

        {notes.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No feedback notes yet.</p>
        ) : (
          <div className="space-y-3">
            {notes.map(n => (
              <div key={n.id} className="group flex gap-3 items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-400 mb-0.5">
                    {fmtNoteDate(n.created_at)}{n.author && ` — ${n.author}`}
                  </p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.text}</p>
                </div>
                <button
                  onClick={() => handleDelete(n.id)}
                  className="text-gray-200 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-4"
                  title="Delete note"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function InstructorProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [instructor, setInstructor] = useState(null)
  const [feedbackNotes, setFeedbackNotes] = useState([])
  const [cases, setCases] = useState([])
  const [recruitingEntries, setRecruitingEntries] = useState([])
  const [reminders, setReminders] = useState([])
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [showNewCase, setShowNewCase] = useState(false)
  const [error, setError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [classStyles, setClassStyles] = useState([])

  useEffect(() => {
    Promise.all([
      api.getInstructor(id),
      api.getCases({ instructor_id: id }),
      api.me(),
      api.getClassStyles(),
      api.getRecruitingByInstructor(id),
      api.getRemindersByInstructor(id),
    ])
      .then(([inst, cs, me, styles, recr, rems]) => {
        setInstructor(inst)
        setFeedbackNotes(inst.feedback_notes || [])
        setIsAdmin(me.role === 'admin')
        setClassStyles(styles || [])
        setEditForm({
          name: inst.name,
          phone: inst.phone || '',
          email: inst.email || '',
          notes: inst.notes || '',
          pay_rate: inst.pay_rate || '',
          mailing_address: inst.mailing_address || '',
          neighborhood: inst.neighborhood || '',
          ssn: inst.ssn || '',
          contract_signed: inst.contract_signed ? true : false,
          contract_signed_date: inst.contract_signed_date || '',
          styles_taught: inst.styles_taught || '',
        })
        setCases(cs)
        setRecruitingEntries(recr)
        setReminders([...(rems.overdue || []), ...(rems.upcoming || [])])
      })
      .catch(e => setError(e.message))
  }, [id])

  async function handleSaveEdit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await api.updateInstructor(id, {
        ...editForm,
        contract_signed: editForm.contract_signed ? 1 : 0,
        styles_taught: editForm.styles_taught,
      })
      setInstructor(prev => ({ ...prev, ...updated }))
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${instructor.name}? This cannot be undone.`)) return
    await api.deleteInstructor(id)
    navigate('/instructors')
  }

  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (!instructor) return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>

  const docs = instructor.documents || []

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="space-y-3">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2">Open Tasks</p>
          <DashboardFilterBar />
        </div>
      </div>

      {/* Profile card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
        {editing ? (
          <form onSubmit={handleSaveEdit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                <input required value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-2">Styles They Teach</label>
                <div className="flex flex-wrap gap-2">
                  {classStyles.map(s => {
                    const taught = (editForm.styles_taught || '').split(',').map(x => x.trim()).filter(Boolean)
                    const checked = taught.includes(s.name)
                    return (
                      <label key={s.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border cursor-pointer text-xs font-medium transition-colors ${
                        checked ? 'bg-purple-100 border-purple-400 text-purple-800' : 'bg-gray-50 border-gray-300 text-gray-600 hover:border-gray-400'
                      }`}>
                        <input type="checkbox" className="sr-only" checked={checked}
                          onChange={e => {
                            const cur = (editForm.styles_taught || '').split(',').map(x => x.trim()).filter(Boolean)
                            const next = e.target.checked ? [...cur, s.name] : cur.filter(x => x !== s.name)
                            setEditForm(f => ({ ...f, styles_taught: next.join(', ') }))
                          }} />
                        {s.name}
                      </label>
                    )
                  })}
                </div>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Pay Rate</label>
                <input value={editForm.pay_rate} onChange={e => setEditForm(f => ({ ...f, pay_rate: e.target.value }))}
                  placeholder="e.g. $60/class" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Neighborhood</label>
                <input value={editForm.neighborhood} onChange={e => setEditForm(f => ({ ...f, neighborhood: e.target.value }))}
                  placeholder="e.g. Park Slope" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Mailing Address</label>
                <textarea value={editForm.mailing_address} onChange={e => setEditForm(f => ({ ...f, mailing_address: e.target.value }))}
                  rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">SSN</label>
                <input value={editForm.ssn} onChange={e => setEditForm(f => ({ ...f, ssn: e.target.value }))}
                  placeholder="XXX-XX-XXXX" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono" />
              </div>
              <div className={isAdmin ? '' : 'col-span-2'}>
                <label className="block text-xs font-medium text-gray-600 mb-1">Contract</label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={editForm.contract_signed}
                      onChange={e => setEditForm(f => ({ ...f, contract_signed: e.target.checked }))}
                      className="rounded" />
                    Signed
                  </label>
                  {editForm.contract_signed && (
                    <input type="date" value={editForm.contract_signed_date}
                      onChange={e => setEditForm(f => ({ ...f, contract_signed_date: e.target.value }))}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving}
                className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditing(false)}
                className="px-4 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Header row: photo + name + actions */}
            <div className="flex items-start gap-4 mb-4">
              <PhotoAvatar
                instructor={instructor}
                onPhotoChange={url => setInstructor(prev => ({ ...prev, photo_url: url }))}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-xl font-bold text-gray-900">{instructor.name}</h1>
                    {instructor.pay_rate && (
                      <p className="text-sm font-semibold text-emerald-700 mt-1">💰 {instructor.pay_rate}</p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => setEditing(true)}
                      className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">
                      Edit
                    </button>
                    <button onClick={handleDelete}
                      className="px-3 py-1.5 border border-red-200 text-red-600 text-xs rounded-lg hover:bg-red-50">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <ContactInfo phone={instructor.phone} email={instructor.email} />

            {/* Styles + notes — shown right after contact info */}
            {(instructor.styles_taught || instructor.notes) && (
              <div className="mt-3 space-y-2">
                {instructor.styles_taught && (
                  <div className="flex flex-wrap gap-1">
                    {instructor.styles_taught.split(',').map(s => s.trim()).filter(Boolean).map(s => (
                      <span key={s} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5 font-medium">{s}</span>
                    ))}
                  </div>
                )}
                {instructor.notes && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 text-gray-600 text-sm">
                    {instructor.notes}
                  </div>
                )}
              </div>
            )}

            {/* Detail rows */}
            <div className="mt-4 space-y-2 text-sm">
              {instructor.neighborhood && (
                <div className="flex gap-2">
                  <span className="text-gray-400 w-28 flex-shrink-0 text-xs pt-0.5">Neighborhood</span>
                  <span className="text-gray-700">{instructor.neighborhood}</span>
                </div>
              )}
              {instructor.mailing_address && (
                <div className="flex gap-2">
                  <span className="text-gray-400 w-28 flex-shrink-0 text-xs pt-0.5">Mailing Address</span>
                  <span className="text-gray-700 whitespace-pre-wrap">{instructor.mailing_address}</span>
                </div>
              )}
              <div className="flex gap-2 items-center">
                <span className="text-gray-400 w-28 flex-shrink-0 text-xs">Contract</span>
                {instructor.contract_signed ? (
                  <span className="text-green-700 font-medium text-xs flex items-center gap-1">
                    ✓ Signed
                    {instructor.contract_signed_date && (
                      <span className="text-gray-500 font-normal">— {fmtDate(instructor.contract_signed_date)}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-gray-400 italic text-xs">Not signed</span>
                )}
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-gray-400 w-28 flex-shrink-0 text-xs">SSN</span>
                <SSNField value={instructor.ssn} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Documents */}
      <DocumentsSection
        instructorId={id}
        documents={docs}
        onDocAdded={doc => setInstructor(prev => ({ ...prev, documents: [...(prev.documents || []), doc] }))}
        onDocDeleted={docId => setInstructor(prev => ({ ...prev, documents: (prev.documents || []).filter(d => d.id !== docId) }))}
      />

      {/* Feedback Notes */}
      <FeedbackNotesSection
        instructorId={id}
        initialNotes={feedbackNotes}
      />

      {/* Availability */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
        <InstructorAvailabilitySection instructorId={id} />
      </div>

      {/* Recruiting */}
      {recruitingEntries.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-3 pl-1 border-l-4 border-indigo-400">
            Recruiting
            <span className="ml-2 text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
              {recruitingEntries.length}
            </span>
          </h2>
          <div className="space-y-2">
            {recruitingEntries.map(entry => (
              <div key={entry.id} className={`bg-white border rounded-xl px-4 py-3 ${entry.archived ? 'border-gray-100 opacity-60' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                      <span className="font-semibold text-gray-700">{entry.day_of_week}</span>
                      {entry.time_slot && <span>{entry.time_slot}</span>}
                      {entry.client_name && <span>· {entry.client_name}</span>}
                      {entry.neighborhood && <span>· {entry.neighborhood}</span>}
                      {entry.style && <span>· {entry.style}</span>}
                      {entry.archived && <span className="text-gray-400 italic">archived</span>}
                    </div>
                    {entry.address && <p className="text-xs text-gray-400 mt-0.5">{entry.address}</p>}
                    {entry.action_type_name && (
                      <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ background: entry.action_type_color + '22', color: entry.action_type_color }}>
                        {entry.action_type_name}
                      </span>
                    )}
                  </div>
                  <Link
                    to={`/recruiting?entry=${entry.id}`}
                    className="text-xs text-indigo-600 hover:underline flex-shrink-0"
                  >
                    View →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Reminders */}
      {reminders.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-3 pl-1 border-l-4 border-yellow-400">
            Reminders
            <span className="ml-2 text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
              {reminders.length}
            </span>
          </h2>
          <div className="space-y-2">
            {reminders.map(rem => {
              const isOverdue = rem.remind_on < new Date().toISOString().slice(0, 10)
              return (
                <div key={rem.id} className={`bg-white border rounded-xl px-4 py-3 ${isOverdue ? 'border-red-200' : 'border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{rem.title}</p>
                      {rem.notes && <p className="text-xs text-gray-500 mt-0.5">{rem.notes}</p>}
                      <p className={`text-[10px] mt-1 font-semibold ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                        {isOverdue ? 'Overdue · ' : ''}
                        {new Date(rem.remind_on + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {rem.created_by ? ` — ${rem.created_by}` : ''}
                      </p>
                    </div>
                    <Link to="/reminders" className="text-xs text-yellow-600 hover:underline flex-shrink-0">
                      View →
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Case history */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-gray-300">
            Case History
            <span className="ml-2 text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
              {cases.length}
            </span>
          </h2>
          <button
            onClick={() => setShowNewCase(true)}
            className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            + Open Case
          </button>
        </div>
        <CaseHistoryList cases={cases} />
      </section>

      {showNewCase && (
        <NewCaseModal instructorId={Number(id)} instructorName={instructor.name} onClose={() => setShowNewCase(false)} />
      )}
    </div>
  )
}
