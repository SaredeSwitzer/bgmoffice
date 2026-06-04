import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../api/client'
import ContactInfo from '../components/ContactInfo'
import CaseHistoryList from '../components/CaseHistoryList'
import NewCaseModal from '../components/NewCaseModal'

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date} ${time}`
}

function PrefCard({ pref, onDelete }) {
  const isLiked = pref.preference === 'liked'
  return (
    <div className={`flex items-start justify-between gap-3 px-4 py-3 rounded-xl border ${
      isLiked ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-xs font-bold uppercase tracking-wide ${isLiked ? 'text-green-700' : 'text-red-700'}`}>
            {isLiked ? '👍 Liked' : '👎 Disliked'}
          </span>
          <span className="text-sm font-semibold text-gray-900">{pref.instructor_name}</span>
        </div>
        {pref.reason && (
          <p className="text-xs text-gray-600 italic whitespace-pre-wrap">"{pref.reason}"</p>
        )}
        {pref.created_at && (
          <p className="text-[10px] text-gray-400 mt-0.5">
            {fmt(pref.created_at)}{pref.created_by ? ` — ${pref.created_by}` : ''}
          </p>
        )}
      </div>
      <button onClick={() => onDelete(pref.id)} className="text-xs text-gray-400 hover:text-red-600 flex-shrink-0">
        ✕
      </button>
    </div>
  )
}

function AddPrefForm({ clientId, instructors, onAdded }) {
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ instructor_id: '', preference: 'liked', reason: '' })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const pref = await api.addPref(clientId, {
        instructor_id: Number(form.instructor_id),
        preference: form.preference,
        reason: form.reason || null,
      })
      onAdded(pref)
      setForm({ instructor_id: '', preference: 'liked', reason: '' })
      setShow(false)
    } finally {
      setSaving(false)
    }
  }

  if (!show) return (
    <button onClick={() => setShow(true)}
      className="text-xs text-gray-500 hover:text-gray-800 border border-dashed border-gray-300 rounded-lg px-3 py-2 w-full hover:bg-gray-50 transition-colors">
      + Add instructor preference
    </button>
  )

  return (
    <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-4 bg-white space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Instructor</label>
          <select required value={form.instructor_id} onChange={e => setForm(f => ({ ...f, instructor_id: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="">Select…</option>
            {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Preference</label>
          <select value={form.preference} onChange={e => setForm(f => ({ ...f, preference: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="liked">Liked</option>
            <option value="disliked">Disliked</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Reason (optional)</label>
          <textarea
            value={form.reason}
            onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
            rows={3}
            placeholder="e.g. Too intense, felt rushed…"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-y"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : 'Add'}
        </button>
        <button type="button" onClick={() => setShow(false)}
          className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Packages Section ─────────────────────────────────────────────────────────
function PackagesSection({ clientId, instructors }) {
  const [packages, setPackages] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ total_classes: '', instructor_id: '', start_date: '', notes: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [expanded, setExpanded] = useState({}) // packageId -> bool
  const [logging, setLogging] = useState({})   // packageId -> bool
  const [logForm, setLogForm] = useState({})   // packageId -> { session_date, notes }
  const [logSaving, setLogSaving] = useState({})
  const [justCompleted, setJustCompleted] = useState(null)

  useEffect(() => {
    api.getClientPackages(clientId)
      .then(setPackages)
      .finally(() => setLoading(false))
  }, [clientId])

  async function handleAddPackage(e) {
    e.preventDefault()
    setAddSaving(true)
    try {
      const pkg = await api.createPackage({
        client_id: Number(clientId),
        instructor_id: addForm.instructor_id ? Number(addForm.instructor_id) : null,
        total_classes: Number(addForm.total_classes),
        start_date: addForm.start_date || null,
        notes: addForm.notes || null,
      })
      setPackages(prev => [pkg, ...prev])
      setAddForm({ total_classes: '', instructor_id: '', start_date: '', notes: '' })
      setShowAdd(false)
    } finally {
      setAddSaving(false)
    }
  }

  async function handleDeletePackage(pkgId) {
    if (!confirm('Delete this package and all its sessions?')) return
    await api.deletePackage(pkgId)
    setPackages(prev => prev.filter(p => p.id !== pkgId))
  }

  function startLog(pkgId) {
    setLogging(prev => ({ ...prev, [pkgId]: true }))
    setLogForm(prev => ({ ...prev, [pkgId]: { session_date: new Date().toISOString().slice(0, 10), notes: '' } }))
  }

  async function handleLogSession(pkgId) {
    const form = logForm[pkgId] || {}
    if (!form.session_date) return
    setLogSaving(prev => ({ ...prev, [pkgId]: true }))
    try {
      const updated = await api.logSession(pkgId, { session_date: form.session_date, notes: form.notes || null })
      setPackages(prev => prev.map(p => p.id === updated.id ? updated : p))
      setLogging(prev => ({ ...prev, [pkgId]: false }))
      if (updated.status === 'completed') setJustCompleted(updated)
    } finally {
      setLogSaving(prev => ({ ...prev, [pkgId]: false }))
    }
  }

  async function handleDeleteSession(pkgId, sessionId) {
    const updated = await api.deleteSession(pkgId, sessionId)
    setPackages(prev => prev.map(p => p.id === updated.id ? updated : p))
  }

  const active = packages.filter(p => p.status === 'active')
  const completed = packages.filter(p => p.status === 'completed')
  const cancelled = packages.filter(p => p.status === 'cancelled')

  function PackageCard({ pkg }) {
    const pct = pkg.total_classes > 0 ? Math.round((pkg.classes_used / pkg.total_classes) * 100) : 0
    const remaining = pkg.total_classes - pkg.classes_used
    const isExpanded = expanded[pkg.id]
    const isLogging = logging[pkg.id]
    const isSaving = logSaving[pkg.id]
    const form = logForm[pkg.id] || { session_date: '', notes: '' }

    const statusColor = pkg.status === 'completed' ? 'bg-green-50 border-green-200'
      : pkg.status === 'cancelled' ? 'bg-gray-50 border-gray-200'
      : 'bg-white border-gray-200'

    const barColor = pkg.status === 'completed' ? 'bg-green-500'
      : pct >= 80 ? 'bg-orange-400'
      : 'bg-blue-500'

    return (
      <div className={`rounded-xl border px-4 py-3 ${statusColor}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-800">
                {pkg.total_classes}-class package
              </span>
              {pkg.instructor_name && (
                <span className="text-xs text-gray-500">w/ {pkg.instructor_name}</span>
              )}
              {pkg.status === 'completed' && (
                <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">Completed</span>
              )}
              {pkg.status === 'cancelled' && (
                <span className="text-xs bg-gray-200 text-gray-500 font-semibold px-2 py-0.5 rounded-full">Cancelled</span>
              )}
            </div>
            {pkg.start_date && (
              <p className="text-xs text-gray-400 mt-0.5">
                Started {new Date(pkg.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
            {pkg.notes && <p className="text-xs text-gray-500 italic mt-0.5">{pkg.notes}</p>}

            {/* Progress bar */}
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>{pkg.classes_used} of {pkg.total_classes} used</span>
                {pkg.status === 'active' && <span className="font-semibold text-blue-600">{remaining} left</span>}
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {pkg.status === 'active' && (
              <button onClick={() => startLog(pkg.id)}
                className="px-2.5 py-1 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700">
                + Log
              </button>
            )}
            <button onClick={() => setExpanded(prev => ({ ...prev, [pkg.id]: !prev[pkg.id] }))}
              className="px-2.5 py-1 border border-gray-200 text-gray-500 text-xs rounded-lg hover:bg-gray-50">
              {isExpanded ? 'Hide' : `Sessions (${pkg.classes_used})`}
            </button>
            <button onClick={() => handleDeletePackage(pkg.id)}
              className="px-2 py-1 text-gray-300 hover:text-red-500 text-xs rounded-lg">
              ✕
            </button>
          </div>
        </div>

        {/* Log session inline form */}
        {isLogging && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-600 mb-2">Log Session</p>
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input type="date" value={form.session_date}
                  onChange={e => setLogForm(prev => ({ ...prev, [pkg.id]: { ...prev[pkg.id], session_date: e.target.value } }))}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div className="flex-1 min-w-32">
                <label className="block text-xs text-gray-500 mb-1">Notes (opt.)</label>
                <input value={form.notes}
                  onChange={e => setLogForm(prev => ({ ...prev, [pkg.id]: { ...prev[pkg.id], notes: e.target.value } }))}
                  placeholder="e.g. Great session"
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <button onClick={() => handleLogSession(pkg.id)} disabled={isSaving}
                className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
                {isSaving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setLogging(prev => ({ ...prev, [pkg.id]: false }))}
                className="px-3 py-1.5 border border-gray-200 text-gray-600 text-xs rounded-lg">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Sessions list */}
        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
            {(pkg.sessions || []).length === 0 ? (
              <p className="text-xs text-gray-400 italic">No sessions logged yet.</p>
            ) : (
              [...(pkg.sessions || [])].reverse().map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                  <span className="font-medium">{new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  {s.notes && <span className="text-gray-400 italic flex-1 truncate">{s.notes}</span>}
                  <span className="text-gray-300">{s.created_by}</span>
                  <button onClick={() => handleDeleteSession(pkg.id, s.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors">✕</button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <section>
      {justCompleted && (
        <div className="mb-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-green-800">🎉 Package completed!</p>
            <p className="text-xs text-green-700">
              {justCompleted.total_classes} classes used. Consider creating an invoice or a new package.
            </p>
          </div>
          <button onClick={() => setJustCompleted(null)} className="text-green-500 hover:text-green-700 text-sm">✕</button>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-purple-400">
          Class Packages
          {packages.length > 0 && (
            <span className="ml-2 text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
              {active.length} active
            </span>
          )}
        </h2>
        <button onClick={() => setShowAdd(v => !v)}
          className="px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 transition-colors">
          + New Package
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAddPackage} className="mb-3 bg-purple-50 border border-purple-200 rounded-xl px-4 py-4 space-y-3">
          <p className="text-xs font-semibold text-purple-800">New Package</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Total Classes *</label>
              <input required type="number" min="1" value={addForm.total_classes}
                onChange={e => setAddForm(f => ({ ...f, total_classes: e.target.value }))}
                placeholder="10" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Instructor</label>
              <select value={addForm.instructor_id} onChange={e => setAddForm(f => ({ ...f, instructor_id: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                <option value="">None / TBD</option>
                {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
              <input type="date" value={addForm.start_date} onChange={e => setAddForm(f => ({ ...f, start_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <input value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Yoga 2x/week" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={addSaving}
              className="px-4 py-1.5 bg-purple-700 text-white text-xs font-medium rounded-lg disabled:opacity-50">
              {addSaving ? 'Creating…' : 'Create Package'}
            </button>
            <button type="button" onClick={() => setShowAdd(false)}
              className="px-4 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-xs text-gray-400 italic">Loading…</p>
      ) : packages.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No packages yet.</p>
      ) : (
        <div className="space-y-2">
          {active.map(pkg => <PackageCard key={pkg.id} pkg={pkg} />)}
          {completed.map(pkg => <PackageCard key={pkg.id} pkg={pkg} />)}
          {cancelled.map(pkg => <PackageCard key={pkg.id} pkg={pkg} />)}
        </div>
      )}
    </section>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ClientProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState(null)
  const [cases, setCases] = useState([])
  const [instructors, setInstructors] = useState([])
  const [recruitingEntries, setRecruitingEntries] = useState([])
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [showNewCase, setShowNewCase] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api.getClient(id),
      api.getCases({ client_id: id }),
      api.getInstructors(),
      api.getRecruitingByClient(id),
    ])
      .then(([c, cs, instr, recr]) => {
        setClient(c)
        setEditForm({
        name: c.name, phone: c.phone || '', email: c.email || '',
        preferred_contact: c.preferred_contact || '', notes: c.notes || '',
        rate_per_class: c.rate_per_class || '',
        contact_person_name: c.contact_person_name || '',
        contact_person_phone: c.contact_person_phone || '',
        contact_person_email: c.contact_person_email || '',
        contact_person_role: c.contact_person_role || '',
        waiver_signed: c.waiver_signed ? true : false,
        waiver_signed_date: c.waiver_signed_date || '',
      })
        setCases(cs)
        setInstructors(instr)
        setRecruitingEntries(recr)
      })
      .catch(e => setError(e.message))
  }, [id])

  async function handleSaveEdit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await api.updateClient(id, editForm)
      setClient(prev => ({ ...prev, ...updated }))
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${client.name}? This cannot be undone.`)) return
    await api.deleteClient(id)
    navigate('/clients')
  }

  function handlePrefAdded(pref) {
    const instructor = instructors.find(i => i.id === pref.instructor_id)
    setClient(prev => ({
      ...prev,
      prefs: [...(prev.prefs || []), { ...pref, instructor_name: instructor?.name }],
    }))
  }

  async function handlePrefDelete(prefId) {
    await api.deletePref(id, prefId)
    setClient(prev => ({ ...prev, prefs: prev.prefs.filter(p => p.id !== prefId) }))
  }

  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (!client) return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>

  const likedPrefs = (client.prefs || []).filter(p => p.preference === 'liked')
  const dislikedPrefs = (client.prefs || []).filter(p => p.preference === 'disliked')

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => navigate('/clients')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        All Clients
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Preferred Contact</label>
                <select value={editForm.preferred_contact} onChange={e => setEditForm(f => ({ ...f, preferred_contact: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                  <option value="">—</option>
                  <option value="text">Text</option>
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="call">Call</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rate Per Class</label>
                <input value={editForm.rate_per_class} onChange={e => setEditForm(f => ({ ...f, rate_per_class: e.target.value }))}
                  placeholder="e.g. $75" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-none" />
              </div>
              {/* Waiver */}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Client Waiver</label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={editForm.waiver_signed}
                      onChange={e => setEditForm(f => ({
                        ...f,
                        waiver_signed: e.target.checked,
                        waiver_signed_date: e.target.checked && !f.waiver_signed_date
                          ? new Date().toISOString().slice(0, 10) : f.waiver_signed_date,
                      }))}
                      className="rounded" />
                    Signed
                  </label>
                  {editForm.waiver_signed && (
                    <input type="date" value={editForm.waiver_signed_date}
                      onChange={e => setEditForm(f => ({ ...f, waiver_signed_date: e.target.value }))}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
                  )}
                </div>
              </div>
              {/* Contact Person */}
              <div className="col-span-2 pt-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Contact Person (optional)</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input value={editForm.contact_person_name} onChange={e => setEditForm(f => ({ ...f, contact_person_name: e.target.value }))}
                  placeholder="e.g. Jane Smith" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role / Relationship</label>
                <input value={editForm.contact_person_role} onChange={e => setEditForm(f => ({ ...f, contact_person_role: e.target.value }))}
                  placeholder="e.g. Office Manager" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input value={editForm.contact_person_phone} onChange={e => setEditForm(f => ({ ...f, contact_person_phone: e.target.value }))}
                  placeholder="718-555-0000" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input value={editForm.contact_person_email} onChange={e => setEditForm(f => ({ ...f, contact_person_email: e.target.value }))}
                  placeholder="contact@example.com" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
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
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{client.name}</h1>
                {client.rate_per_class && (
                  <p className="text-sm font-semibold text-emerald-700 mt-1">
                    💰 {client.rate_per_class} / class
                  </p>
                )}
                {client.notes && <p className="text-sm text-gray-600 mt-1">{client.notes}</p>}
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
            <ContactInfo phone={client.phone} email={client.email} preferred_contact={client.preferred_contact} />

            {/* Waiver status */}
            <div className="mt-3 flex items-center gap-2">
              {client.waiver_signed ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-800 text-xs font-semibold">
                  ✅ Waiver Signed
                  {client.waiver_signed_date && (
                    <span className="font-normal text-green-700">
                      — {new Date(client.waiver_signed_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold">
                  ⚠️ Waiver Not Signed
                </span>
              )}
            </div>

            {/* Contact person */}
            {client.contact_person_name && (
              <div className="mt-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Contact Person</p>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold text-gray-800">{client.contact_person_name}</span>
                  {client.contact_person_role && (
                    <span className="text-xs text-gray-500 italic">{client.contact_person_role}</span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-gray-600">
                  {client.contact_person_phone && (
                    <a href={`tel:${client.contact_person_phone.replace(/\D/g,'').length === 10 ? '+1' : '+'}${client.contact_person_phone.replace(/\D/g,'')}`}
                      className="flex items-center gap-1 text-green-700 hover:underline">
                      📞 {client.contact_person_phone}
                    </a>
                  )}
                  {client.contact_person_email && (
                    <a href={`mailto:${client.contact_person_email}`}
                      className="flex items-center gap-1 text-blue-600 hover:underline">
                      ✉️ {client.contact_person_email}
                    </a>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Instructor preferences */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-3 pl-1 border-l-4 border-gray-300">
          Instructor Preferences
        </h2>
        <div className="space-y-2">
          {[...likedPrefs, ...dislikedPrefs].map(pref => (
            <PrefCard key={pref.id} pref={pref} onDelete={handlePrefDelete} />
          ))}
          <AddPrefForm clientId={id} instructors={instructors} onAdded={handlePrefAdded} />
        </div>
      </section>

      {/* Recruiting History */}
      {recruitingEntries.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-3 pl-1 border-l-4 border-gray-300">
            Recruiting History
            <span className="ml-2 text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
              {recruitingEntries.length}
            </span>
          </h2>
          <div className="space-y-2">
            {recruitingEntries.map(entry => (
              <div key={entry.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                      <span className="font-semibold text-gray-700">{entry.day_of_week}</span>
                      {entry.time_slot && <span>{entry.time_slot}</span>}
                      {entry.neighborhood && <span>· {entry.neighborhood}</span>}
                      {entry.style && <span>· {entry.style}</span>}
                      {entry.participants && <span>· {entry.participants}</span>}
                    </div>
                    {entry.address && <p className="text-xs text-gray-400 mt-0.5">{entry.address}</p>}
                  </div>
                  <Link
                    to="/recruiting"
                    className="text-xs text-blue-600 hover:underline flex-shrink-0"
                  >
                    View →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Class Packages */}
      <PackagesSection clientId={id} instructors={instructors} />

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
        <NewCaseModal clientId={Number(id)} clientName={client.name} onClose={() => setShowNewCase(false)} />
      )}
    </div>
  )
}
