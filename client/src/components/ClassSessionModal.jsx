import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { isOwnerUser } from '../utils/ownerAccess'
import SearchSelect from './SearchSelect'
import DateInput from './DateInput'
import TimeInput from './TimeInput'
import ClientAddressEditor from './ClientAddressEditor'
import DurationInput from './DurationInput'
import ChargeInput from './ChargeInput'
import ClassNotes from './ClassNotes'
import AdminNotes from './AdminNotes'
import RescheduleAlertModal from './RescheduleAlertModal'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const PAYMENT_METHODS = ['Credit Card', 'Zelle', 'Check', 'Cash', 'Invoice', 'Package', 'Other']

// Add, edit, or duplicate a single dated class on the calendar.
//   session: null                    → create new, pre-filled with `defaultDate`
//   session: {...}                   → edit that session in place
//   session: {...}, duplicate: true  → pre-filled from that session, but saves as a new one
export default function ClassSessionModal({ session, defaultDate, duplicate = false, onClose, onSaved, onDeleted }) {
  const isEdit = !!session?.id && !duplicate
  const { user } = useAuth()
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [form, setForm] = useState({
    client: session ? {
      id: session.client_id, name: session.client_name,
      neighborhood: session.neighborhood, street: session.street, city: session.city, zip: session.zip,
    } : null,
    instructor: session?.instructor_id ? { id: session.instructor_id, name: session.instructor_name } : null,
    session_date: duplicate ? (defaultDate || '') : (session?.session_date || defaultDate || ''),
    start_time: session?.start_time ? session.start_time.slice(0, 5) : '',
    duration_minutes: session?.duration_minutes ?? 60,
    charge_amount: session?.charge_amount ?? '',
    charge_note: session?.charge_note || '',
    instructor_pay: session?.instructor_pay ?? '',
    payment_method: session?.payment_method || '',
    style: session?.style || '',
    participant_count: session?.participant_count ?? '',
    participant_ages: session?.participant_ages || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showRescheduleAlert, setShowRescheduleAlert] = useState(false)
  const [notifiedAt, setNotifiedAt] = useState(session?.reschedule_alert_sent_at || null)

  useEffect(() => {
    Promise.all([api.getClients(), api.getInstructors()])
      .then(([c, i]) => { setClients(c); setInstructors(i) })
  }, [])

  // Notes attach to a saved class, so on a brand-new one they're held here and written
  // straight after it's created — otherwise you'd have to save, reopen, then add them.
  // A class added from the calendar could only ever be a one-off — making it weekly
  // meant leaving and using the Recurring tab. Same choice the recruiting flow offers.
  const [repeatMode, setRepeatMode] = useState('once')   // 'once' | 'weekly'
  const [weekdays, setWeekdays] = useState([])
  const canSeeAdminNotes = isOwnerUser(user)
  const [newClassNote, setNewClassNote] = useState('')
  const [newAdminNote, setNewAdminNote] = useState('')

  // Default the repeat day to whatever date is picked, so switching to weekly doesn't
  // start from an empty selection.
  useEffect(() => {
    if (repeatMode !== 'weekly' || !form.session_date) return
    const [y, m, d] = form.session_date.split('-').map(Number)
    const wd = new Date(y, m - 1, d).getDay()
    setWeekdays(prev => (prev.length ? prev : [wd]))
  }, [repeatMode, form.session_date])

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // A class generated from a recurring schedule can be saved for just this date or for
  // the whole weekly class — offered as two buttons rather than a prompt after the fact,
  // so the choice is visible before committing to anything.
  const repeats = isEdit && !!session?.schedule_id

  function handleSubmit(e) {
    e.preventDefault()
    save(false)
  }

  async function save(applyToSeries) {
    if (!form.client) { setError('Please select a client.'); return }
    if (!form.session_date) { setError('Please pick a date.'); return }
    setSaving(true); setError('')
    const payload = {
      client_id: form.client.id,
      instructor_id: form.instructor?.id || null,
      session_date: form.session_date,
      start_time: form.start_time || null,
      duration_minutes: form.duration_minutes || 60,
      charge_amount: form.charge_amount === '' ? null : form.charge_amount,
      charge_note: form.charge_note || null,
      instructor_pay: form.instructor_pay === '' ? null : form.instructor_pay,
      payment_method: form.payment_method || null,
      style: form.style || null,
      participant_count: form.participant_count === '' ? null : form.participant_count,
      participant_ages: form.participant_ages || null,
      ...(applyToSeries ? { apply_to_series: true } : {}),
    }
    try {
      // Weekly: create one recurring schedule per chosen day (that's how the app models a
      // multi-day class) rather than a single dated class. The server fills the calendar.
      if (!isEdit && repeatMode === 'weekly') {
        if (weekdays.length === 0) { setError('Pick at least one day it repeats on.'); setSaving(false); return }
        const made = []
        for (const wd of weekdays) {
          const sch = await api.createClassSchedule({
            client_id: payload.client_id,
            instructor_id: payload.instructor_id,
            weekday: wd,
            start_time: payload.start_time,
            duration_minutes: payload.duration_minutes,
            charge_amount: payload.charge_amount,
            instructor_pay: payload.instructor_pay,
            payment_method: payload.payment_method,
            style: payload.style,
            participant_count: payload.participant_count,
            participant_ages: payload.participant_ages,
            start_date: form.session_date || null,
            status: 'active',
          })
          made.push(sch)
          if (newClassNote.trim()) {
            await api.addClassNote('schedule', sch.id, { text: newClassNote.trim() }).catch(() => {})
          }
          if (canSeeAdminNotes && newAdminNote.trim()) {
            await api.addAdminNote('schedule', sch.id, { text: newAdminNote.trim() }).catch(() => {})
          }
        }
        onSaved(made[0])
        return
      }

      const saved = isEdit
        ? await api.updateClassSession(session.id, payload)
        : await api.createClassSession(payload)

      if (!isEdit && saved?.id) {
        // Best-effort: the class itself is already saved, so a note failing here must not
        // read as the whole save failing.
        if (newClassNote.trim()) {
          await api.addClassNote('session', saved.id, { text: newClassNote.trim() }).catch(() => {})
        }
        if (canSeeAdminNotes && newAdminNote.trim()) {
          await api.addAdminNote('session', saved.id, { text: newAdminNote.trim() }).catch(() => {})
        }
      }
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Remove this class?')) return
    await api.deleteClassSession(session.id)
    onDeleted(session.id)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 px-4 py-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-auto overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-900 text-base">{isEdit ? 'Edit Class' : duplicate ? 'Duplicate Class' : 'Add Class'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 space-y-3">
            {/* Paperwork gap on the class being edited. Shown at the top rather than
                buried, since it's the kind of thing only noticed once someone is
                already standing in a client's living room. */}
            {session && (session.client_waiver_signed === false ||
                        (session.instructor_id && session.instructor_contract_signed === false)) && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <span className="font-semibold">⚠ Missing paperwork:</span>{' '}
                {[
                  session.client_waiver_signed === false && `${session.client_name || 'This client'} hasn’t signed a waiver`,
                  session.instructor_id && session.instructor_contract_signed === false &&
                    `${session.instructor_name || 'This instructor'} hasn’t signed their contract`,
                ].filter(Boolean).join(' · ')}
              </div>
            )}
            <SearchSelect label="Client" required options={clients} value={form.client}
              onChange={v => setForm(f => ({
                ...f,
                client: v,
                // Pre-fill from the client's class defaults — only when this field
                // hasn't already been typed in, so switching clients never clobbers
                // something staff already entered for this specific class.
                style: f.style || v?.default_style || '',
                participant_count: f.participant_count || (v?.default_participants ?? ''),
                participant_ages: f.participant_ages || v?.default_age || '',
              }))} placeholder="Search client…" />
            <SearchSelect label="Instructor" options={instructors} value={form.instructor}
              onChange={v => setForm(f => ({
                ...f,
                instructor: v,
                // Pay follows whoever is actually teaching, not the client or a prior
                // instructor's rate — e.g. when someone subs a one-off class.
                instructor_pay: v?.pay_rate ?? f.instructor_pay,
              }))} placeholder="Search instructor…" />
            {form.client && (
              <ClientAddressEditor
                client={form.client}
                onUpdated={addr => setForm(f => ({ ...f, client: { ...f.client, ...addr } }))}
              />
            )}
            {!isEdit && (
              <div className="space-y-2">
                <div className="inline-flex rounded-lg border border-gray-300 p-0.5 text-xs">
                  {[['once', 'Just this date'], ['weekly', 'Every week']].map(([key, text]) => (
                    <button key={key} type="button" onClick={() => setRepeatMode(key)}
                      className={`rounded-md px-3 py-1 font-medium ${repeatMode === key ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>
                      {text}
                    </button>
                  ))}
                </div>
                {repeatMode === 'weekly' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      Repeats on <span className="font-normal text-gray-400">— pick every day it runs</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAY_LABELS.map((d, i) => {
                        const on = weekdays.includes(i)
                        return (
                          <button key={d} type="button"
                            onClick={() => setWeekdays(w => on ? w.filter(x => x !== i) : [...w, i])}
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                              on ? 'border-purple-400 bg-purple-100 text-purple-800'
                                 : 'border-gray-300 bg-gray-50 text-gray-600 hover:border-gray-400'
                            }`}>
                            {on && <span className="mr-1">✓</span>}{d}
                          </button>
                        )
                      })}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">
                      The date below is when it starts. Each day becomes its own weekly class.
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {!isEdit && repeatMode === 'weekly' ? 'Starting' : 'Date'}
                </label>
                <DateInput value={form.session_date} onChange={v => setField('session_date', v)} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
                <TimeInput value={form.start_time} onChange={v => setField('start_time', v)} required />
              </div>
              <DurationInput
                startTime={form.start_time}
                durationMinutes={form.duration_minutes}
                onDurationChange={v => setField('duration_minutes', v)}
              />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Charge to client</label>
                <ChargeInput amount={form.charge_amount} note={form.charge_note}
                  onChange={({ amount, note }) => setForm(f => ({ ...f, charge_amount: amount, charge_note: note }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Instructor pay</label>
                <input type="number" step="1" value={form.instructor_pay} onChange={e => setField('instructor_pay', e.target.value)}
                  placeholder="60" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment method</label>
                <select value={form.payment_method} onChange={e => setField('payment_method', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300">
                  <option value="">—</option>
                  {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Style</label>
                <input value={form.style} onChange={e => setField('style', e.target.value)}
                  placeholder="Pilates" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"># of participants</label>
                <input type="text" value={form.participant_count} onChange={e => setField('participant_count', e.target.value)}
                  placeholder="e.g. 12, or Around 15 kids, or 5-10" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ages</label>
                <input value={form.participant_ages} onChange={e => setField('participant_ages', e.target.value)}
                  placeholder="e.g. 6, 8" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
          <div className="px-5 py-4 border-t border-gray-100 space-y-2">
            {repeats && (
              <p className="text-[11px] text-gray-500">
                This class repeats weekly — saving all future classes updates the weekly class too.
                Past classes are never changed, and the date only ever applies to this one.
              </p>
            )}
            <div className="flex gap-2">
              {repeats ? (
                <>
                  <button type="button" onClick={() => save(false)} disabled={saving}
                    className="flex-1 border border-gray-300 text-gray-800 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-50">
                    {saving ? 'Saving…' : 'Save This Class Only'}
                  </button>
                  <button type="button" onClick={() => save(true)} disabled={saving}
                    className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700">
                    {saving ? 'Saving…' : 'Save All Future Classes'}
                  </button>
                </>
              ) : (
                <button type="submit" disabled={saving}
                  className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700">
                  {saving ? 'Saving…' : isEdit ? 'Save Changes'
                    : repeatMode === 'weekly'
                      ? `Add Weekly Class${weekdays.length > 1 ? `es (${weekdays.length})` : ''}`
                      : 'Add Class'}
                </button>
              )}
              <button type="button" onClick={onClose}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              {isEdit && (
                <button type="button" onClick={handleDelete}
                  className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50">
                  Delete
                </button>
              )}
            </div>
          </div>
          {isEdit && form.instructor && (
            <div className="px-5 pb-4">
              <button type="button" onClick={() => setShowRescheduleAlert(true)}
                title="Email the instructor that this class's date/time changed"
                className={`w-full text-xs rounded-lg px-3 py-1.5 border transition-colors ${
                  notifiedAt
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}>
                {notifiedAt ? '✓ Notified of change' : 'Notify Instructor of Change'}
              </button>
            </div>
          )}
        </form>
        {/* Outside the <form> above — these have their own add-note forms, and forms can't nest. */}
        {isEdit ? (
          <>
            <ClassNotes kind="session" id={session.id} />
            {canSeeAdminNotes && <AdminNotes kind="session" id={session.id} />}
          </>
        ) : (
          <>
            <div className="bg-sky-50/60 border-t border-sky-100 px-4 py-3 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-700">
                👁 Class note — the instructor can see this
              </p>
              <textarea value={newClassNote} onChange={e => setNewClassNote(e.target.value)} rows={2}
                placeholder="e.g. buzzer is broken, call on arrival"
                className="w-full rounded-lg border border-sky-200 px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-sky-300" />
            </div>
            {canSeeAdminNotes && (
              <div className="bg-amber-50/60 border-t border-amber-100 px-4 py-3 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-700">
                  🔒 Admin note — Sarede, Claire &amp; Maria only
                </p>
                <textarea value={newAdminNote} onChange={e => setNewAdminNote(e.target.value)} rows={2}
                  placeholder="Not visible to the instructor"
                  className="w-full rounded-lg border border-amber-200 px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-amber-300" />
              </div>
            )}
          </>
        )}
      </div>
      {showRescheduleAlert && (
        <RescheduleAlertModal
          session={session}
          onClose={() => setShowRescheduleAlert(false)}
          onSent={r => setNotifiedAt(r.sent_at)}
        />
      )}
    </div>
  )
}
