import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../api/client'
import { navClick, auxNavClick } from '../utils/nav'
import ContactInfo from '../components/ContactInfo'
import CaseHistoryList from '../components/CaseHistoryList'
import NewCaseModal from '../components/NewCaseModal'
import { NewInvoiceModal } from './InvoicesPage'
import DashboardFilterBar from '../components/DashboardFilterBar'

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

// ── PackageCard — defined at module level so React never remounts it on parent re-renders ──
function PackageCard({
  pkg,
  isExpanded, onToggleExpand,
  isLogging, onStartLog, onCancelLog,
  logDate, onSetDate,
  isSaving, onSave,
  onDelete, onDeleteSession,
}) {
  // Notes lives in local state so typing never triggers a parent re-render
  const [notes, setNotes] = useState('')

  // Reset notes whenever the log form is opened or closed
  useEffect(() => {
    if (!isLogging) setNotes('')
  }, [isLogging])

  const pct = pkg.total_classes > 0 ? Math.round((pkg.classes_used / pkg.total_classes) * 100) : 0
  const remaining = pkg.total_classes - pkg.classes_used

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
            <button onClick={onStartLog}
              className="px-2.5 py-1 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700">
              + Log
            </button>
          )}
          <button onClick={onToggleExpand}
            className="px-2.5 py-1 border border-gray-200 text-gray-500 text-xs rounded-lg hover:bg-gray-50">
            {isExpanded ? 'Hide' : `Sessions (${pkg.classes_used})`}
          </button>
          <button onClick={onDelete}
            className="px-2 py-1 text-gray-300 hover:text-red-500 text-xs rounded-lg">
            ✕
          </button>
        </div>
      </div>

      {/* Log session inline form */}
      {isLogging && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
          <p className="text-xs font-semibold text-gray-600">Log Session</p>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class Date *</label>
            <input type="date" value={logDate} onChange={e => onSetDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Great session"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
            />
          </div>

          <div className="flex gap-2">
            <button onClick={() => onSave(notes)} disabled={isSaving}
              className="flex-1 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save Session'}
            </button>
            <button onClick={onCancelLog}
              className="px-4 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
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
                <button onClick={() => onDeleteSession(s.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors">✕</button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Packages Section ──────────────────────────────────────────────────────────
function PackagesSection({ clientId, instructors }) {
  const [packages, setPackages] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ total_classes: '', instructor_id: '', start_date: '', notes: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [expanded, setExpanded] = useState({})   // packageId -> bool
  const [logging, setLogging] = useState({})     // packageId -> bool
  const [logDates, setLogDates] = useState({})   // packageId -> session_date string
  const [logSaving, setLogSaving] = useState({}) // packageId -> bool
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
    setLogDates(prev => ({ ...prev, [pkgId]: new Date().toISOString().slice(0, 10) }))
    setLogging(prev => ({ ...prev, [pkgId]: true }))
  }

  // notes is passed in from the card's local state at save time
  async function handleLogSession(pkgId, notes) {
    const sessionDate = logDates[pkgId]
    if (!sessionDate) return
    setLogSaving(prev => ({ ...prev, [pkgId]: true }))
    try {
      const updated = await api.logSession(pkgId, { session_date: sessionDate, notes: notes || null })
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
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
          {[...active, ...completed, ...cancelled].map(pkg => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              isExpanded={!!expanded[pkg.id]}
              onToggleExpand={() => setExpanded(prev => ({ ...prev, [pkg.id]: !prev[pkg.id] }))}
              isLogging={!!logging[pkg.id]}
              onStartLog={() => startLog(pkg.id)}
              onCancelLog={() => setLogging(prev => ({ ...prev, [pkg.id]: false }))}
              logDate={logDates[pkg.id] || ''}
              onSetDate={v => setLogDates(prev => ({ ...prev, [pkg.id]: v }))}
              isSaving={!!logSaving[pkg.id]}
              onSave={notes => handleLogSession(pkg.id, notes)}
              onDelete={() => handleDeletePackage(pkg.id)}
              onDeleteSession={sessionId => handleDeleteSession(pkg.id, sessionId)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

const STATUS_COLORS = {
  draft:   'bg-gray-100 text-gray-600',
  sent:    'bg-blue-100 text-blue-700',
  paid:    'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
}

function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
}

function fmtInvDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function InvoicesSection({ clientId, clientName }) {
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    api.getInvoices({ client_id: clientId })
      .then(setInvoices)
      .finally(() => setLoading(false))
  }, [clientId])

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-emerald-400">
          Invoices
          {invoices.length > 0 && (
            <span className="ml-2 text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
              {invoices.length}
            </span>
          )}
        </h2>
        <button
          onClick={() => setShowNew(true)}
          className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-medium rounded-lg hover:bg-emerald-800 transition-colors"
        >
          + New Invoice
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 italic">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No invoices yet.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Invoice #</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 hidden sm:table-cell">Date</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500">Total</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.map(inv => (
                <tr
                  key={inv.id}
                  onClick={e => navClick(e, `/invoices/${inv.id}`, navigate)}
                  onAuxClick={e => auxNavClick(e, `/invoices/${inv.id}`)}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-gray-700 font-semibold">{inv.invoice_number}</span>
                    {inv.title && <p className="text-xs text-gray-400 mt-0.5">{inv.title}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs hidden sm:table-cell">{fmtInvDate(inv.invoice_date)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900 text-xs">{fmtMoney(inv.total)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[inv.status]}`}>
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewInvoiceModal
          initialClient={{ id: Number(clientId), name: clientName }}
          onClose={() => setShowNew(false)}
          onCreated={inv => {
            setShowNew(false)
            setInvoices(prev => [inv, ...prev])
            navigate(`/invoices/${inv.id}`)
          }}
        />
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
  const [reminders, setReminders] = useState([])
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
      api.getRemindersByClient(id),
    ])
      .then(([c, cs, instr, recr, rems]) => {
        setClient(c)
        setEditForm({
          name: c.name, phone: c.phone || '', email: c.email || '',
          invoice_email: c.invoice_email || '',
          preferred_contact: c.preferred_contact || '', notes: c.notes || '',
          rate_per_class: c.rate_per_class || '',
          contact_person_name: c.contact_person_name || '',
          contact_person_phone: c.contact_person_phone || '',
          contact_person_email: c.contact_person_email || '',
          contact_person_role: c.contact_person_role || '',
          waiver_signed: c.waiver_signed ? true : false,
          waiver_signed_date: c.waiver_signed_date || '',
          street: c.street || '',
          city: c.city || '',
          zip: c.zip || '',
          neighborhood: c.neighborhood || '',
        })
        setCases(cs)
        setInstructors(instr)
        setRecruitingEntries(recr)
        setReminders([...(rems.overdue || []), ...(rems.upcoming || [])])
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
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Invoice Email <span className="text-gray-400 font-normal">(if different)</span></label>
                <input value={editForm.invoice_email} onChange={e => setEditForm(f => ({ ...f, invoice_email: e.target.value }))}
                  placeholder="billing@example.com"
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes / Contact Person</label>
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
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  )}
                </div>
              </div>
              {/* Address */}
              <div className="col-span-2 pt-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Address</p>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Street</label>
                <input value={editForm.street} onChange={e => setEditForm(f => ({ ...f, street: e.target.value }))}
                  placeholder="123 Main St" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
                <input value={editForm.city} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))}
                  placeholder="Brooklyn" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Zip</label>
                <input value={editForm.zip} onChange={e => setEditForm(f => ({ ...f, zip: e.target.value }))}
                  placeholder="11201" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Neighborhood</label>
                <input value={editForm.neighborhood} onChange={e => setEditForm(f => ({ ...f, neighborhood: e.target.value }))}
                  placeholder="Park Slope" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
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
            {client.invoice_email && (
              <p className="text-xs text-gray-500 mt-1">
                Invoice email: <span className="font-medium text-gray-700">{client.invoice_email}</span>
              </p>
            )}

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

            {/* Address */}
            {(client.street || client.city || client.zip || client.neighborhood) && (
              <div className="mt-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Address</p>
                {client.street && <p className="text-sm text-gray-800">{client.street}</p>}
                {(client.city || client.zip) && (
                  <p className="text-sm text-gray-800">
                    {[client.city, client.zip].filter(Boolean).join(', ')}
                  </p>
                )}
                {client.neighborhood && (
                  <p className="text-xs text-gray-500 mt-0.5">{client.neighborhood}</p>
                )}
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
                      {entry.neighborhood && <span>· {entry.neighborhood}</span>}
                      {entry.style && <span>· {entry.style}</span>}
                      {entry.participants && <span>· {entry.participants}</span>}
                      {entry.instructor_name && <span>· {entry.instructor_name}</span>}
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

      {/* Class Packages */}
      <PackagesSection clientId={id} instructors={instructors} />

      {/* Invoices */}
      <InvoicesSection clientId={id} clientName={client.name} />

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
