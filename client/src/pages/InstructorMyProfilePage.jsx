import { useEffect, useRef, useState } from 'react'
import { api, uploadsUrl } from '../api/client'
import { useAuth } from '../context/AuthContext'
import SignupOptionPicker from '../components/SignupOptionPicker'

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Own-profile photo upload — same idea as the staff-facing PhotoAvatar in
// InstructorProfilePage.jsx, kept separate since this page has its own scoped API access.
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
        {uploading ? <span className="text-white text-xs">…</span> : <span className="text-white text-lg">📷</span>}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  )
}

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
          Documents (resume, etc.)
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
        <p className="text-sm text-gray-400 italic">No documents uploaded yet.</p>
      ) : (
        <div className="space-y-2">
          {documents.map(doc => (
            <div key={doc.id} className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xl">📄</span>
                <div className="min-w-0">
                  <a href={uploadsUrl(doc.filename)} target="_blank" rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-600 hover:underline truncate block">
                    {doc.original_name}
                  </a>
                  <p className="text-[10px] text-gray-400 mt-0.5">{fmt(doc.uploaded_at)}</p>
                </div>
              </div>
              <button onClick={() => handleDelete(doc.id)} className="text-xs text-gray-400 hover:text-red-600 flex-shrink-0">✕</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Self-service availability — same instructor_availability rows staff see/edit from
// /recruiting, but scoped to just this instructor via GET/POST/PUT/DELETE
// /instructors/:id/availability (server/routes/instructors.js), so this is the first
// place an instructor can see or change what they've told the office they're free for.
function MyAvailabilitySection({ instructorId }) {
  const [slots, setSlots] = useState(null)
  const [addForm, setAddForm] = useState({ day_of_week: '', time_slot: '' })
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editSlot, setEditSlot] = useState({ day_of_week: '', time_slot: '' })

  useEffect(() => {
    api.getMyAvailability(instructorId).then(setSlots).catch(() => setSlots([]))
  }, [instructorId])

  async function handleAdd(e) {
    e.preventDefault()
    if (!addForm.day_of_week) return
    setSaving(true)
    try {
      const row = await api.addMyAvailability(instructorId, addForm)
      setSlots(s => [...s, row])
      setAddForm({ day_of_week: '', time_slot: '' })
    } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    await api.deleteMyAvailability(instructorId, id)
    setSlots(s => s.filter(x => x.id !== id))
  }

  function startEdit(slot) {
    setEditingId(slot.id)
    setEditSlot({ day_of_week: slot.day_of_week, time_slot: slot.time_slot || '' })
  }

  async function handleSaveEdit(id) {
    if (!editSlot.day_of_week) return
    const updated = await api.updateMyAvailability(instructorId, id, editSlot)
    setSlots(s => s.map(x => x.id === id ? updated : x))
    setEditingId(null)
  }

  if (slots === null) return null

  const byDay = {}
  for (const s of slots) {
    if (!byDay[s.day_of_week]) byDay[s.day_of_week] = []
    byDay[s.day_of_week].push(s)
  }
  const daysWithSlots = DAYS.filter(d => byDay[d])

  return (
    <section id="availability" className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 scroll-mt-4">
      <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-gray-300 mb-1">
        My Availability
      </h2>
      <p className="text-xs text-gray-500 -mt-1">
        This is what the office sees when they're scheduling — keep it up to date if your free times change.
      </p>

      {daysWithSlots.length === 0 ? (
        <p className="text-sm text-gray-400 italic">Nothing on file yet — add the days/times you're generally free below.</p>
      ) : (
        <div className="space-y-3">
          {daysWithSlots.map(day => (
            <div key={day}>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 border-l-2 border-gray-300 pl-2">{day}</p>
              <div className="space-y-1.5 pl-1">
                {byDay[day].map(slot => (
                  editingId === slot.id ? (
                    <div key={slot.id} className="flex flex-wrap gap-2 items-center bg-gray-50 border border-gray-300 rounded-xl px-3 py-2">
                      <select value={editSlot.day_of_week} onChange={e => setEditSlot(s => ({ ...s, day_of_week: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-300">
                        {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <input value={editSlot.time_slot} onChange={e => setEditSlot(s => ({ ...s, time_slot: e.target.value }))}
                        placeholder="e.g. 10am–noon" className="border border-gray-300 rounded-lg px-2 py-1 text-xs w-28 focus:outline-none focus:ring-2 focus:ring-gray-300" />
                      <button type="button" onClick={() => handleSaveEdit(slot.id)}
                        className="px-3 py-1 bg-gray-900 text-white text-xs rounded-lg hover:bg-gray-700 transition-colors">Save</button>
                      <button type="button" onClick={() => setEditingId(null)}
                        className="px-3 py-1 border border-gray-300 text-gray-500 text-xs rounded-lg">Cancel</button>
                    </div>
                  ) : (
                    <div key={slot.id} className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 group">
                      <span className="text-sm text-gray-700">
                        {slot.time_slot || <span className="text-gray-400 italic">No time set</span>}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button type="button" onClick={() => startEdit(slot)}
                          className="text-gray-400 hover:text-gray-700 text-xs" title="Edit">✎</button>
                        <button type="button" onClick={() => handleDelete(slot.id)}
                          className="text-gray-300 hover:text-red-500 text-xs" title="Delete">✕</button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 items-end pt-1">
        <div>
          <label className="block text-[10px] font-medium text-gray-500 mb-1">Day</label>
          <select value={addForm.day_of_week} onChange={e => setAddForm(f => ({ ...f, day_of_week: e.target.value }))}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-300">
            <option value="">Choose a day…</option>
            {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-medium text-gray-500 mb-1">Time (optional)</label>
          <input value={addForm.time_slot} onChange={e => setAddForm(f => ({ ...f, time_slot: e.target.value }))}
            placeholder="e.g. 10am–noon" className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs w-32 focus:outline-none focus:ring-2 focus:ring-gray-300" />
        </div>
        <button type="submit" disabled={saving || !addForm.day_of_week}
          className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors">
          {saving ? 'Adding…' : '+ Add'}
        </button>
      </form>
    </section>
  )
}

export default function InstructorMyProfilePage() {
  const { user } = useAuth()
  const [instructor, setInstructor] = useState(null)
  const [form, setForm] = useState(null)
  const [classStyles, setClassStyles] = useState([])
  const [neighborhoods, setNeighborhoods] = useState([])
  const [regions, setRegions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getSignupClassStyles().then(setClassStyles).catch(() => {})
    api.getSignupNeighborhoods()
      .then(d => { setNeighborhoods(d.neighborhoods || []); setRegions(d.regions || []) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!user?.instructor_id) return
    api.getInstructor(user.instructor_id)
      .then(inst => {
        setInstructor(inst)
        setForm({
          phone: inst.phone || '', email: inst.email || '',
          mailing_address: inst.mailing_address || '', city: inst.city || '', state: inst.state || '', neighborhood: inst.neighborhood || '',
          styles_taught: inst.styles_taught || '', specialties: inst.specialties || '',
          payout_method: inst.payout_method || '', payout_handle: inst.payout_handle || '',
        })
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [user?.instructor_id])

  // Same NY-only rule as the public sign-up page: the canonical neighborhood list is
  // NY-area, so only offer the multi-picker to instructors actually based there.
  const isNY = ['ny', 'new york'].includes((form?.state || '').trim().toLowerCase())

  async function handleAddNeighborhood(name, region) {
    const row = await api.addSignupNeighborhood(name, region)
    setNeighborhoods(prev => prev.some(n => n.id === row.id) ? prev : [...prev, row])
    return row
  }

  async function handleAddClassStyle(name) {
    const row = await api.addSignupClassStyle(name)
    setClassStyles(prev => prev.some(s => s.id === row.id) ? prev : [...prev, row])
    return row
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError(''); setSaved(false)
    try {
      const updated = await api.updateInstructor(instructor.id, { ...instructor, ...form })
      setInstructor(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
  if (!instructor) return <div className="text-center py-12 text-gray-400 text-sm">Could not load your profile.</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <PhotoAvatar instructor={instructor} onPhotoChange={url => setInstructor(prev => ({ ...prev, photo_url: url }))} />
        <div>
          <h1 className="text-xl font-bold text-gray-900">{instructor.name}</h1>
          <p className="text-sm text-gray-500">{instructor.styles_taught || instructor.specialties || 'My Profile'}</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-gray-300 mb-1">
          Contact Info
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Mailing Address</label>
            <input value={form.mailing_address} onChange={e => setForm(f => ({ ...f, mailing_address: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
            <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
            <input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
              placeholder="NY" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div className={isNY ? 'sm:col-span-2' : undefined}>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {isNY ? 'Neighborhoods You Can Teach In' : 'Neighborhood'}
            </label>
            {isNY ? (
              <>
                <p className="text-[11px] text-gray-400 mb-1.5">
                  Tap all the ones you'd travel to. Not listed? Use “+ Other”.
                </p>
                <SignupOptionPicker
                  options={neighborhoods}
                  regions={regions}
                  value={form.neighborhood}
                  onChange={v => setForm(f => ({ ...f, neighborhood: v }))}
                  onAdd={handleAddNeighborhood}
                  addLabel="neighborhood"
                />
              </>
            ) : (
              <input value={form.neighborhood} onChange={e => setForm(f => ({ ...f, neighborhood: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Classes You Can Teach</label>
            <p className="text-[11px] text-gray-400 mb-1.5">
              Tap everything you teach. Teach something we don’t list? Use “+ Other”.
            </p>
            <SignupOptionPicker
              options={classStyles}
              value={form.styles_taught}
              onChange={v => setForm(f => ({ ...f, styles_taught: v }))}
              onAdd={handleAddClassStyle}
              addLabel="class style"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Specialties / Notes</label>
            <input value={form.specialties} onChange={e => setForm(f => ({ ...f, specialties: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={saving}
            className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          {saved && <span className="text-xs text-green-600">Saved ✓</span>}
        </div>
        <p className="text-[11px] text-gray-400 pt-1">
          Your name, pay rate, and contract info are managed by BGM Office staff — reach out if anything there needs updating.
        </p>
      </form>

      <MyAvailabilitySection instructorId={instructor.id} />

      <DocumentsSection
        instructorId={instructor.id}
        documents={instructor.documents || []}
        onDocAdded={doc => setInstructor(prev => ({ ...prev, documents: [...(prev.documents || []), doc] }))}
        onDocDeleted={docId => setInstructor(prev => ({ ...prev, documents: (prev.documents || []).filter(d => d.id !== docId) }))}
      />
    </div>
  )
}
