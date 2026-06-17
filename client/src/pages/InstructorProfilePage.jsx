import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, uploadsUrl } from '../api/client'
import ContactInfo from '../components/ContactInfo'
import CaseHistoryList from '../components/CaseHistoryList'
import NewCaseModal from '../components/NewCaseModal'
import DateInput from '../components/DateInput'

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

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function InstructorProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [instructor, setInstructor] = useState(null)
  const [cases, setCases] = useState([])
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [showNewCase, setShowNewCase] = useState(false)
  const [error, setError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    Promise.all([
      api.getInstructor(id),
      api.getCases({ instructor_id: id }),
      api.me(),
    ])
      .then(([inst, cs, me]) => {
        setInstructor(inst)
        setIsAdmin(me.role === 'admin')
        setEditForm({
          name: inst.name,
          phone: inst.phone || '',
          email: inst.email || '',
          specialties: inst.specialties || '',
          style: inst.style || '',
          notes: inst.notes || '',
          pay_rate: inst.pay_rate || '',
          mailing_address: inst.mailing_address || '',
          ssn: inst.ssn || '',
          contract_signed: inst.contract_signed ? true : false,
          contract_signed_date: inst.contract_signed_date || '',
        })
        setCases(cs)
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
      <button onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

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
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Specialties</label>
                <input value={editForm.specialties} onChange={e => setEditForm(f => ({ ...f, specialties: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Pay Rate</label>
                <input value={editForm.pay_rate} onChange={e => setEditForm(f => ({ ...f, pay_rate: e.target.value }))}
                  placeholder="e.g. $60/class" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Style / Teaching Approach</label>
                <input value={editForm.style} onChange={e => setEditForm(f => ({ ...f, style: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
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
                    <DateInput value={editForm.contract_signed_date}
                      onChange={v => setEditForm(f => ({ ...f, contract_signed_date: v }))} />
                  )}
                </div>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-none" />
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
                    {instructor.specialties && (
                      <p className="text-sm text-gray-500 mt-0.5">{instructor.specialties}</p>
                    )}
                    {instructor.style && (
                      <p className="text-sm text-gray-600 mt-1 italic">"{instructor.style}"</p>
                    )}
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

            {/* Detail rows */}
            <div className="mt-4 space-y-2 text-sm">
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
              {instructor.notes && (
                <div className="mt-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 text-gray-600 text-sm">
                  {instructor.notes}
                </div>
              )}
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
