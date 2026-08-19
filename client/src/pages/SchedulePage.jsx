import { useEffect, useState, useCallback, Fragment } from 'react'
import { api } from '../api/client'
import SearchSelect from '../components/SearchSelect'
import ClassNotes from '../components/ClassNotes'
import ConfirmClassModal from '../components/ConfirmClassModal'
import ClassSessionModal from '../components/ClassSessionModal'
import ClientAddressEditor from '../components/ClientAddressEditor'
import PendingClassModal from '../components/PendingClassModal'
import TimeInput from '../components/TimeInput'
import { fmtTime } from '../utils/time'

// Small pill showing a class's note / open-task counts; also the button that expands notes.
function NotesToggle({ open, noteCount = 0, openTasks = 0, onClick }) {
  const label = openTasks > 0 ? `${openTasks} to-do` : (noteCount > 0 ? `${noteCount} note${noteCount === 1 ? '' : 's'}` : 'Notes')
  return (
    <button onClick={onClick} title="Notes & tasks"
      className={`text-xs rounded-lg px-2 py-1 border transition-colors ${
        openTasks > 0
          ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
          : (noteCount > 0 ? 'border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100' : 'border-gray-200 text-gray-400 hover:bg-gray-50')
      } ${open ? 'ring-1 ring-gray-400' : ''}`}>
      {label}
    </button>
  )
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PAYMENT_METHODS = ['Credit Card', 'Zelle', 'Check', 'Cash', 'Other']

// Local YYYY-MM-DD (never toISOString — that shifts the day off UTC).
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseLocal(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function startOfWeek(d) { return addDays(d, -d.getDay()) } // back to Sunday
function money(v) { return v == null || v === '' ? '—' : `$${Number(v).toFixed(0)}` }

// Street + city + zip, skipping whichever parts are blank — matches
// server/routes/schedule.js's fmtAddress() used for the confirmation email.
function fmtAddr(s) {
  let addr = [s.street, s.city].filter(Boolean).join(', ')
  if (s.zip) addr = addr ? `${addr} ${s.zip}` : s.zip
  return addr
}

const BLANK_SCHEDULE = {
  client: null, instructor: null, weekday: '', start_time: '',
  charge_amount: '', instructor_pay: '', payment_method: '', style: '', location: '', special_instructions: '',
  participant_count: '', participant_ages: '',
}

export default function SchedulePage() {
  const [tab, setTab] = useState('week') // 'week' | 'recurring'
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()))
  const weekStart = startOfWeek(anchor)
  const weekEnd = addDays(weekStart, 6)

  const [sessions, setSessions] = useState([])
  const [schedules, setSchedules] = useState([])
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [loading, setLoading] = useState(true)

  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(BLANK_SCHEDULE)
  const [saving, setSaving] = useState(false)
  // Id of the recurring schedule being edited, or null when adding a new one.
  const [editingId, setEditingId] = useState(null)

  // Recurring class / dated session whose instructor-confirmation email modal is open.
  const [confirmSchedule, setConfirmSchedule] = useState(null)
  const [confirmSession, setConfirmSession] = useState(null)

  // Add/edit-class modal. { session: null, defaultDate } to add; { session } to edit.
  const [sessionModal, setSessionModal] = useState(null)
  // The dated session currently being marked pending, if any.
  const [pendingModal, setPendingModal] = useState(null)

  // Which class's notes panel is open, keyed like 'session-12' / 'schedule-5'.
  const [openNotes, setOpenNotes] = useState(null)
  const toggleNotes = (key) => setOpenNotes(prev => (prev === key ? null : key))
  // Keep the row's badge in sync after edits inside the panel, without a full reload.
  function applyCounts(kind, id, rows) {
    const note_count = rows.length
    const open_task_count = rows.filter(n => n.is_task && !n.is_done).length
    const patch = s => s.id === id ? { ...s, note_count, open_task_count } : s
    if (kind === 'session') setSessions(prev => prev.map(patch))
    else setSchedules(prev => prev.map(patch))
  }

  useEffect(() => {
    api.getClients().then(setClients).catch(() => {})
    api.getInstructors().then(setInstructors).catch(() => {})
  }, [])

  const loadWeek = useCallback(() => {
    setLoading(true)
    api.getClassSessions(ymd(weekStart), ymd(weekEnd))
      // Cancelling a session (vs. deleting it) is meant to invalidate it, not hide it from
      // the calendar — but this page had no filter for it, so a cancelled session rendered
      // identically to a live one. Filter it out here the same way a delete would.
      .then(rows => setSessions(rows.filter(s => s.status !== 'cancelled')))
      .catch(() => setSessions([])).finally(() => setLoading(false))
  }, [weekStart.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadSchedules = useCallback(() => {
    setLoading(true)
    api.getClassSchedules().then(setSchedules).catch(() => setSchedules([])).finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (tab === 'week') loadWeek(); else loadSchedules() }, [tab, loadWeek, loadSchedules])

  async function removeSession(id) {
    if (!confirm('Remove this class from the week?')) return
    await api.deleteClassSession(id); setSessions(prev => prev.filter(s => s.id !== id))
  }

  async function resolvePending(s) {
    if (!confirm('Mark this class as resolved (no longer pending)?')) return
    const updated = await api.updateClassSession(s.id, { status: 'scheduled' })
    setSessions(prev => prev.map(x => x.id === s.id ? { ...x, ...updated } : x))
  }

  async function createSchedule(e) {
    e.preventDefault()
    if (!form.client) return
    setSaving(true)
    try {
      const payload = {
        client_id: form.client.id,
        instructor_id: form.instructor?.id || null,
        weekday: form.weekday === '' ? null : Number(form.weekday),
        start_time: form.start_time || null,
        charge_amount: form.charge_amount || null,
        instructor_pay: form.instructor_pay || null,
        payment_method: form.payment_method || null,
        style: form.style || null,
        location: form.location || null,
        special_instructions: form.special_instructions || null,
        participant_count: form.participant_count === '' ? null : form.participant_count,
        participant_ages: form.participant_ages || null,
      }
      if (editingId) await api.updateClassSchedule(editingId, payload)
      else await api.createClassSchedule(payload)
      setForm(BLANK_SCHEDULE); setShowNew(false); setEditingId(null); loadSchedules()
    } finally {
      setSaving(false)
    }
  }

  function editSchedule(s) {
    setForm({
      client: s.client_id ? {
        id: s.client_id, name: s.client_name,
        neighborhood: s.neighborhood, street: s.street, city: s.city, zip: s.zip,
      } : null,
      instructor: s.instructor_id ? { id: s.instructor_id, name: s.instructor_name } : null,
      weekday: s.weekday ?? '',
      start_time: s.start_time ? s.start_time.slice(0, 5) : '',
      charge_amount: s.charge_amount ?? '',
      instructor_pay: s.instructor_pay ?? '',
      payment_method: s.payment_method || '',
      style: s.style || '',
      location: s.location || '',
      special_instructions: s.special_instructions || '',
      participant_count: s.participant_count ?? '',
      participant_ages: s.participant_ages || '',
    })
    setEditingId(s.id)
    setShowNew(true)
  }

  async function removeSchedule(id) {
    if (!confirm('Delete this recurring class? Existing sessions already generated are kept.')) return
    await api.deleteClassSchedule(id); setSchedules(prev => prev.filter(s => s.id !== id))
  }

  async function toggleSchedulePause(s) {
    const status = s.status === 'active' ? 'paused' : 'active'
    setSchedules(prev => prev.map(x => x.id === s.id ? { ...x, status } : x))
    try {
      await api.updateClassSchedule(s.id, { ...s, client_id: s.client_id, weekday: s.weekday, status })
    } catch { loadSchedules() }
  }

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
  const weekTotal = sessions.reduce((sum, s) => sum + (Number(s.charge_amount) || 0), 0)

  // Group week sessions by day for the report view.
  const byDay = {}
  for (const s of sessions) (byDay[s.session_date] ||= []).push(s)

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Schedule</h1>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          {['week', 'recurring'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 font-medium ${tab === t ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {t === 'week' ? 'This Week' : 'Recurring'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'week' ? (
        <>
          <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <button onClick={() => setAnchor(addDays(weekStart, -7))} className="px-2 py-1 rounded text-gray-500 hover:bg-gray-100">‹</button>
              <div className="text-sm font-semibold text-gray-800 min-w-[11rem] text-center">{weekLabel}</div>
              <button onClick={() => setAnchor(addDays(weekStart, 7))} className="px-2 py-1 rounded text-gray-500 hover:bg-gray-100">›</button>
              <button onClick={() => setAnchor(startOfWeek(new Date()))} className="ml-1 text-xs text-gray-400 hover:text-gray-700">This week</button>
            </div>
          </div>

          {loading ? (
            <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="text-gray-400 text-sm italic text-center py-10">
              No classes this week.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between text-xs text-gray-500 px-1">
                <span>{sessions.length} class{sessions.length === 1 ? '' : 'es'}</span>
                <span>Week total: <span className="font-semibold text-gray-700">{money(weekTotal)}</span></span>
              </div>
              <div className="overflow-x-auto pb-2">
                <div className="flex gap-2 min-w-[980px]">
                  {WEEKDAYS.map((dayName, i) => {
                    const date = ymd(addDays(weekStart, i))
                    const rows = (byDay[date] || []).slice().sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
                    const isToday = date === ymd(new Date())
                    return (
                      <div key={date}
                        className={`flex-1 min-w-[130px] rounded-xl border ${isToday ? 'border-gray-900' : 'border-gray-200'} bg-white shadow-sm overflow-hidden flex flex-col`}>
                        <div className={`px-2 py-2 text-center border-b ${isToday ? 'bg-gray-900 border-gray-900' : 'bg-gray-50 border-gray-100'}`}>
                          <p className={`text-[10px] font-semibold uppercase tracking-wide ${isToday ? 'text-gray-300' : 'text-gray-400'}`}>{dayName.slice(0, 3)}</p>
                          <p className={`text-sm font-bold ${isToday ? 'text-white' : 'text-gray-700'}`}>
                            {parseLocal(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                        <div className="flex-1 p-2 space-y-2">
                          {rows.length === 0 ? (
                            <p className="text-[11px] text-gray-300 italic text-center pt-3">No classes</p>
                          ) : rows.map(s => (
                            <Fragment key={s.id}>
                              <div onClick={() => setSessionModal({ session: s })}
                                className={`border rounded-lg p-2 text-xs cursor-pointer transition-colors ${
                                  s.status === 'pending'
                                    ? 'border-amber-300 bg-amber-50 hover:border-amber-400'
                                    : 'border-gray-200 hover:border-gray-400'
                                }`}>
                                <div className="flex items-start justify-between gap-1">
                                  <span className="font-semibold text-gray-700">{s.start_time ? fmtTime(s.start_time) : '—'}</span>
                                  <div className="flex items-center gap-1.5">
                                    {s.status === 'pending' ? (
                                      <button onClick={e => { e.stopPropagation(); resolvePending(s) }}
                                        title="Mark resolved" className="text-amber-600 hover:text-amber-800 leading-none text-xs">✓ Resolve</button>
                                    ) : (
                                      <button onClick={e => { e.stopPropagation(); setPendingModal(s) }}
                                        title="Mark pending" className="text-gray-300 hover:text-amber-600 leading-none text-xs">⚠</button>
                                    )}
                                    <button onClick={e => { e.stopPropagation(); setSessionModal({ session: s, duplicate: true, defaultDate: s.session_date }) }}
                                      title="Duplicate this class" className="text-gray-300 hover:text-gray-600 leading-none text-xs">⧉</button>
                                    <button onClick={e => { e.stopPropagation(); removeSession(s.id) }} className="text-gray-300 hover:text-red-500 leading-none text-sm">×</button>
                                  </div>
                                </div>
                                {s.status === 'pending' && (
                                  <p className="text-amber-700 font-semibold mt-0.5">⚠ Pending{s.notes ? `: ${s.notes}` : ''}</p>
                                )}
                                <p className="font-semibold text-gray-900 truncate mt-0.5">{s.client_name}</p>
                                <p className="text-gray-500 truncate">
                                  {s.instructor_name || 'No instructor'}{s.style ? ` · ${s.style}` : ''}
                                </p>
                                {s.neighborhood && (
                                  <p className="text-gray-400 truncate">📍 {s.neighborhood}</p>
                                )}
                                {fmtAddr(s) && (
                                  <p className="text-gray-400 truncate" title={fmtAddr(s)}>{fmtAddr(s)}</p>
                                )}
                                <div className="flex items-center justify-between mt-1">
                                  <span className="font-semibold text-gray-800">{money(s.charge_amount)}</span>
                                  <NotesToggle open={openNotes === `session-${s.id}`} noteCount={s.note_count} openTasks={s.open_task_count}
                                    onClick={e => { e.stopPropagation(); toggleNotes(`session-${s.id}`) }} />
                                </div>
                                {s.instructor_id && (
                                  <button onClick={e => { e.stopPropagation(); setConfirmSession(s) }} title="Email the instructor a class confirmation"
                                    className={`w-full mt-1 text-[10px] rounded px-1 py-0.5 border transition-colors whitespace-nowrap ${
                                      s.confirmation_sent_at
                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                        : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                    }`}>
                                    {s.confirmation_sent_at ? '✓ Emailed' : 'Confirmation Email'}
                                  </button>
                                )}
                              </div>
                              {openNotes === `session-${s.id}` && (
                                <div onClick={e => e.stopPropagation()}>
                                  <ClassNotes kind="session" id={s.id} onCountChange={rows => applyCounts('session', s.id, rows)} />
                                </div>
                              )}
                            </Fragment>
                          ))}
                          <button onClick={() => setSessionModal({ session: null, defaultDate: date })}
                            className="w-full text-[11px] text-gray-400 hover:text-gray-700 border border-dashed border-gray-200 hover:border-gray-300 rounded-lg py-1">
                            + Add
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex justify-end">
            <button onClick={() => { setEditingId(null); setForm(BLANK_SCHEDULE); setShowNew(v => !v) }}
              className="px-3 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700">
              + New Recurring Class
            </button>
          </div>

          {showNew && (
            <form onSubmit={createSchedule} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="font-semibold text-gray-800 text-sm">{editingId ? 'Edit Recurring Class' : 'New Recurring Class'}</h3>
              <div className="grid grid-cols-2 gap-3">
                <SearchSelect label="Client" required options={clients} value={form.client}
                  onChange={c => setForm(f => ({ ...f, client: c }))} placeholder="Search clients…" />
                <SearchSelect label="Instructor" options={instructors} value={form.instructor}
                  onChange={i => setForm(f => ({ ...f, instructor: i }))} placeholder="Search instructors…" />
                {form.client && (
                  <ClientAddressEditor
                    className="col-span-2"
                    client={form.client}
                    onUpdated={addr => setForm(f => ({ ...f, client: { ...f.client, ...addr } }))}
                  />
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Day of week</label>
                  <select value={form.weekday} onChange={e => setForm(f => ({ ...f, weekday: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
                    <option value="">Flexible / unset</option>
                    {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
                  <TimeInput value={form.start_time} onChange={v => setForm(f => ({ ...f, start_time: v }))} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Charge to client</label>
                  <input type="number" step="1" value={form.charge_amount} onChange={e => setForm(f => ({ ...f, charge_amount: e.target.value }))}
                    placeholder="95" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Instructor pay</label>
                  <input type="number" step="1" value={form.instructor_pay} onChange={e => setForm(f => ({ ...f, instructor_pay: e.target.value }))}
                    placeholder="60" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment method</label>
                  <select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
                    <option value="">—</option>
                    {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Style</label>
                  <input value={form.style} onChange={e => setForm(f => ({ ...f, style: e.target.value }))}
                    placeholder="Pilates" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1"># of participants</label>
                  <input type="number" step="1" min="0" value={form.participant_count} onChange={e => setForm(f => ({ ...f, participant_count: e.target.value }))}
                    placeholder="1" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ages</label>
                  <input value={form.participant_ages} onChange={e => setForm(f => ({ ...f, participant_ages: e.target.value }))}
                    placeholder="e.g. 6, 8" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving || !form.client}
                  className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
                  {saving ? 'Saving…' : (editingId ? 'Save Changes' : 'Save Recurring Class')}
                </button>
                <button type="button" onClick={() => { setShowNew(false); setForm(BLANK_SCHEDULE); setEditingId(null) }}
                  className="px-4 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">Cancel</button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
          ) : schedules.length === 0 ? (
            <p className="text-gray-400 text-sm italic text-center py-10">No recurring classes yet.</p>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {schedules.map((s, i) => (
                <Fragment key={s.id}>
                  <div className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-100' : ''} ${s.status === 'paused' ? 'opacity-50' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{s.client_name}</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {s.weekday != null ? WEEKDAYS[s.weekday] : 'Flexible'}
                        {s.start_time ? ` · ${fmtTime(s.start_time)}` : (
                          <span className="text-amber-600 font-medium"> · No time set</span>
                        )}
                        {' · '}{s.instructor_name || 'No instructor'}{s.style ? ` · ${s.style}` : ''}
                        {s.neighborhood ? ` · 📍 ${s.neighborhood}` : ''}
                      </p>
                      {fmtAddr(s) && (
                        <p className="text-[11px] text-gray-400 truncate" title={fmtAddr(s)}>{fmtAddr(s)}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-gray-800">{money(s.charge_amount)}</p>
                      <p className="text-[11px] text-gray-400">{s.payment_method || '—'}</p>
                    </div>
                    {s.instructor_id && (
                      <button onClick={() => setConfirmSchedule(s)} title="Email the instructor a class confirmation"
                        className={`text-xs rounded-lg px-2 py-1 border transition-colors ${
                          s.confirmation_sent_at
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}>
                        {s.confirmation_sent_at ? '✓ Emailed' : 'Send Confirmation Email'}
                      </button>
                    )}
                    <NotesToggle open={openNotes === `schedule-${s.id}`} noteCount={s.note_count} openTasks={s.open_task_count}
                      onClick={() => toggleNotes(`schedule-${s.id}`)} />
                    <button onClick={() => editSchedule(s)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-50">
                      Edit
                    </button>
                    <button onClick={() => toggleSchedulePause(s)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-50">
                      {s.status === 'active' ? 'Pause' : 'Resume'}
                    </button>
                    <button onClick={() => removeSchedule(s.id)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                  </div>
                  {openNotes === `schedule-${s.id}` && (
                    <ClassNotes kind="schedule" id={s.id} onCountChange={rows => applyCounts('schedule', s.id, rows)} />
                  )}
                </Fragment>
              ))}
            </div>
          )}
        </>
      )}

      {confirmSchedule && (
        <ConfirmClassModal
          schedule={confirmSchedule}
          onClose={() => setConfirmSchedule(null)}
          onSent={(r) => setSchedules(prev => prev.map(x =>
            x.id === confirmSchedule.id ? { ...x, confirmation_sent_at: r.sent_at, confirmation_sent_to: r.sent_to } : x))}
        />
      )}

      {confirmSession && (
        <ConfirmClassModal
          schedule={confirmSession}
          kind="session"
          onClose={() => setConfirmSession(null)}
          onSent={(r) => setSessions(prev => prev.map(x =>
            x.id === confirmSession.id ? { ...x, confirmation_sent_at: r.sent_at, confirmation_sent_to: r.sent_to } : x))}
        />
      )}

      {sessionModal && (
        <ClassSessionModal
          session={sessionModal.session}
          defaultDate={sessionModal.defaultDate}
          duplicate={!!sessionModal.duplicate}
          onClose={() => setSessionModal(null)}
          onSaved={() => { setSessionModal(null); loadWeek() }}
          onDeleted={(id) => {
            setSessions(prev => prev.filter(x => x.id !== id))
            setSessionModal(null)
          }}
        />
      )}

      {pendingModal && (
        <PendingClassModal
          session={pendingModal}
          onClose={() => setPendingModal(null)}
          onSaved={(updated) => {
            setSessions(prev => prev.map(x => x.id === pendingModal.id ? { ...x, ...updated } : x))
            setPendingModal(null)
          }}
        />
      )}
    </div>
  )
}
