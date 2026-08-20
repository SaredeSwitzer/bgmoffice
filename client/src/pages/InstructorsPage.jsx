import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import MeetingInviteModal from '../components/MeetingInviteModal'
import ContractInviteModal from '../components/ContractInviteModal'
import ContractSignaturesPanel from '../components/ContractSignaturesPanel'
import StylePicker from '../components/StylePicker'

const BLANK_FORM = { name: '', phone: '', email: '', notes: '', pay_rate: '', neighborhood: '', styles_taught: '' }

const LOGIN_STATUS_LABELS = {
  not_logged_in: 'Not logged in yet',
  active: 'Active',
  no_login: 'No login access',
}

function loginStatusOf(inst) {
  if (!inst.has_login) return 'no_login'
  return inst.last_login_at ? 'active' : 'not_logged_in'
}

export default function InstructorsPage() {
  const [instructors, setInstructors] = useState([])
  const [classStyles, setClassStyles] = useState([])
  const [query, setQuery] = useState('')
  const [styleFilter, setStyleFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [loginFilter, setLoginFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [newInstructor, setNewInstructor] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [contractInviteOpen, setContractInviteOpen] = useState(false)
  const [signaturesRefresh, setSignaturesRefresh] = useState(0)
  const [selected, setSelected] = useState(() => new Set())
  const [emailBlastOpen, setEmailBlastOpen] = useState(false)
  const [welcomeEmailFor, setWelcomeEmailFor] = useState(null) // newly-created instructor, or null

  useEffect(() => {
    api.getClassStyles().then(setClassStyles).catch(() => {})
  }, [])

  // Fetch the whole roster once; the three filters (search + style + location)
  // combine client-side so it stays instant even after the Shiftboard migration
  // grows this to a few hundred instructors.
  useEffect(() => {
    api.getInstructors().then(setInstructors).finally(() => setLoading(false))
  }, [])

  const has = (hay, needle) => (hay || '').toLowerCase().includes(needle.toLowerCase())

  // Location options = the distinct neighborhoods present on instructors.
  const locations = [...new Set(instructors.map(i => (i.neighborhood || '').trim()).filter(Boolean))].sort()
  // Style options = the canonical class styles, plus any styles already typed on
  // instructors that aren't in the canonical list.
  const styleNames = [...new Set([
    ...classStyles.map(s => s.name),
    ...instructors.flatMap(i => (i.styles_taught || '').split(',').map(s => s.trim()).filter(Boolean)),
  ])].sort()

  const filtered = instructors.filter(inst => {
    if (query && !(has(inst.name, query) || has(inst.phone, query) || has(inst.email, query) ||
                   has(inst.specialties, query) || has(inst.styles_taught, query) || has(inst.neighborhood, query))) return false
    if (styleFilter && !has(inst.styles_taught || inst.specialties, styleFilter)) return false
    if (locationFilter && (inst.neighborhood || '').trim() !== locationFilter) return false
    if (loginFilter && loginStatusOf(inst) !== loginFilter) return false
    return true
  })

  function toggleSelected(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAllFiltered() {
    setSelected(new Set(filtered.map(i => i.id)))
  }

  const selectedInstructors = instructors.filter(i => selected.has(i.id))

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const i = await api.createInstructor(form)
      setInstructors(prev => [...prev, i].sort((a, b) => a.name.localeCompare(b.name)))
      setNewInstructor(false)
      setForm(BLANK_FORM)
      setSignaturesRefresh(r => r + 1)
      if (i.email) setWelcomeEmailFor(i)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Instructors</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setInviteOpen(true)}
            className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Invite to Meeting
          </button>
          <button
            onClick={() => setContractInviteOpen(true)}
            className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Send Contract to Sign
          </button>
          <button
            onClick={() => setNewInstructor(v => !v)}
            className="px-3 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            + New Instructor
          </button>
        </div>
      </div>

      {inviteOpen && <MeetingInviteModal onClose={() => setInviteOpen(false)} />}
      {contractInviteOpen && (
        <ContractInviteModal
          onClose={() => setContractInviteOpen(false)}
          onSent={() => setSignaturesRefresh(r => r + 1)}
        />
      )}

      <ContractSignaturesPanel instructors={instructors} refreshKey={signaturesRefresh} />

      {newInstructor && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
          <h3 className="font-semibold text-gray-800 text-sm">New Instructor</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" placeholder="Full name" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-2">Styles They Teach</label>
              <StylePicker
                styleNames={styleNames}
                value={form.styles_taught}
                onChange={v => setForm(f => ({ ...f, styles_taught: v }))}
                onStyleAdded={s => setClassStyles(prev => [...prev, s])}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Pay Rate</label>
              <input value={form.pay_rate} onChange={e => setForm(f => ({ ...f, pay_rate: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" placeholder="$85/hr" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Neighborhood</label>
              <input value={form.neighborhood} onChange={e => setForm(f => ({ ...f, neighborhood: e.target.value }))}
                placeholder="e.g. Park Slope" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Instructor'}
            </button>
            <button type="button" onClick={() => setNewInstructor(false)}
              className="px-4 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search instructors…"
            className="w-full border border-gray-300 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
        </div>
        <select value={styleFilter} onChange={e => setStyleFilter(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white text-gray-700 sm:w-44">
          <option value="">All styles</option>
          {styleNames.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white text-gray-700 sm:w-44">
          <option value="">All locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={loginFilter} onChange={e => setLoginFilter(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white text-gray-700 sm:w-44">
          <option value="">Any login status</option>
          {Object.entries(LOGIN_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-400 text-sm italic text-center py-8">No instructors found.</p>
      ) : (
        <>
          <div className="flex items-center justify-between px-1 gap-2 flex-wrap">
            <p className="text-xs text-gray-400">
              {filtered.length} instructor{filtered.length === 1 ? '' : 's'}
              {(query || styleFilter || locationFilter || loginFilter) && ` of ${instructors.length}`}
            </p>
            <div className="flex items-center gap-3">
              {selected.size > 0 && (
                <>
                  <span className="text-xs text-gray-500">{selected.size} selected</span>
                  <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-gray-700">
                    Clear
                  </button>
                  <button
                    onClick={() => setEmailBlastOpen(true)}
                    className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    Email Selected
                  </button>
                </>
              )}
              <button onClick={selectAllFiltered} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                Select all filtered
              </button>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {filtered.map((inst, i) => {
              const sub = [inst.styles_taught || inst.specialties, inst.neighborhood].filter(Boolean).join(' · ')
              const status = loginStatusOf(inst)
              return (
                <div
                  key={inst.id}
                  className={`flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors ${i > 0 ? 'border-t border-gray-100' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(inst.id)}
                    onChange={() => toggleSelected(inst.id)}
                    className="w-4 h-4 rounded border-gray-300 flex-shrink-0"
                  />
                  <Link to={`/instructors/${inst.id}`} className="flex items-center justify-between gap-3 flex-1 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-gray-900 truncate">{inst.name}</p>
                        {status === 'not_logged_in' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" title="Not logged in yet" />
                        )}
                        {status === 'active' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" title="Active" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{sub || inst.phone || '—'}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {inst.pay_rate && (
                        <span className="text-xs text-gray-400 font-medium">{inst.pay_rate}</span>
                      )}
                      <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </Link>
                </div>
              )
            })}
          </div>
        </>
      )}

      {emailBlastOpen && (
        <EmailBlastModal
          instructors={selectedInstructors}
          onClose={() => setEmailBlastOpen(false)}
        />
      )}

      {welcomeEmailFor && (
        <WelcomeEmailModal
          instructor={welcomeEmailFor}
          onClose={() => setWelcomeEmailFor(null)}
        />
      )}
    </div>
  )
}

// Preview + edit + send the welcome/sign-in-instructions email for a freshly-added
// instructor. The instructor account already exists (created with the instructor) —
// this only controls whether/when they're told about it.
function WelcomeEmailModal({ instructor, onClose }) {
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getInstructorIntroPreview(instructor.id)
      .then(p => { setPreview(p); setSubject(p.subject); setBody(p.body) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [instructor.id])

  async function send() {
    setSending(true); setError('')
    try {
      await api.sendInstructorIntro(instructor.id, { subject, body })
      setSent(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">Welcome email · {instructor.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-3">
          {sent ? (
            <p className="text-sm text-green-700">✓ Sent to {preview.to}</p>
          ) : loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : !preview?.to ? (
            <p className="text-sm text-gray-600">No email on file for {instructor.name} — nothing to send.</p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <div className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                  {preview.to}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={12}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed" />
              </div>
              <p className="text-[11px] text-gray-400">
                Filled in from the welcome email template — edit anything before sending, or close this without sending.
              </p>
            </>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg">
            {sent ? 'Done' : "Don't send"}
          </button>
          {preview?.to && !sent && (
            <button onClick={send} disabled={sending}
              className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {sending ? 'Sending…' : 'Send email'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Compose-and-send panel for a bulk email to the currently selected instructors.
// {name} in the subject/body is filled per-recipient server-side.
function EmailBlastModal({ instructors, onClose }) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const withEmail = instructors.filter(i => i.email)
  const withoutEmail = instructors.filter(i => !i.email)

  async function handleSend(e) {
    e.preventDefault()
    setSending(true)
    setError('')
    try {
      const r = await api.sendInstructorEmailBlast({
        instructor_ids: instructors.map(i => i.id),
        subject,
        body,
      })
      setResult(r)
    } catch (e2) {
      setError(e2.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
        {result ? (
          <>
            <h3 className="font-semibold text-gray-900">Email sent</h3>
            <div className="text-sm space-y-1">
              <p className="text-green-700">✓ Sent to {result.sent.length}</p>
              {result.skipped.length > 0 && (
                <p className="text-gray-500">Skipped {result.skipped.length} (no email on file)</p>
              )}
              {result.failed.length > 0 && (
                <p className="text-red-600">Failed for {result.failed.length}: {result.failed.map(f => f.name).join(', ')}</p>
              )}
            </div>
            <button onClick={onClose} className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg">
              Done
            </button>
          </>
        ) : (
          <form onSubmit={handleSend} className="space-y-3">
            <h3 className="font-semibold text-gray-900">
              Email {instructors.length} instructor{instructors.length === 1 ? '' : 's'}
            </h3>
            {withoutEmail.length > 0 && (
              <p className="text-xs text-amber-600">
                {withoutEmail.length} of these have no email on file and will be skipped: {withoutEmail.map(i => i.name).join(', ')}
              </p>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
              <input required value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="e.g. Reminder: log into BGM Office, {name}"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
              <textarea required value={body} onChange={e => setBody(e.target.value)}
                rows={8} placeholder={'Hi {name},\n\n…'}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-none" />
              <p className="text-[11px] text-gray-400 mt-1">Use {'{name}'} anywhere to insert each instructor's name.</p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={onClose} className="px-4 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={sending || withEmail.length === 0}
                className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {sending ? 'Sending…' : `Send to ${withEmail.length}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
