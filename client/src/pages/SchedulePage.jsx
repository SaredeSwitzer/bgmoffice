import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import SearchSelect from '../components/SearchSelect'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PAYMENT_METHODS = ['Credit Card', 'Zelle', 'Check', 'Cash', 'Other']
const SESSION_STATUS = ['scheduled', 'completed', 'cancelled', 'no_show']

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

const BLANK_SCHEDULE = {
  client: null, instructor: null, weekday: '', start_time: '',
  charge_amount: '', instructor_pay: '', payment_method: '', style: '', location: '', special_instructions: '',
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
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState(null)

  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(BLANK_SCHEDULE)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getClients().then(setClients).catch(() => {})
    api.getInstructors().then(setInstructors).catch(() => {})
  }, [])

  const loadWeek = useCallback(() => {
    setLoading(true)
    api.getClassSessions(ymd(weekStart), ymd(weekEnd))
      .then(setSessions).catch(() => setSessions([])).finally(() => setLoading(false))
  }, [weekStart.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadSchedules = useCallback(() => {
    setLoading(true)
    api.getClassSchedules().then(setSchedules).catch(() => setSchedules([])).finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (tab === 'week') loadWeek(); else loadSchedules() }, [tab, loadWeek, loadSchedules])

  async function generate() {
    setGenerating(true); setMsg(null)
    try {
      const r = await api.generateClassWeek(ymd(weekStart))
      setMsg(r.created > 0 ? `Added ${r.created} class${r.created === 1 ? '' : 'es'} from recurring schedules.` : 'Already up to date — nothing new to add.')
      loadWeek()
    } catch (e) {
      setMsg(e.message || 'Could not generate the week.')
    } finally {
      setGenerating(false)
    }
  }

  async function setSessionStatus(id, status) {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s))
    try { await api.updateClassSession(id, { status }) } catch { loadWeek() }
  }

  async function removeSession(id) {
    if (!confirm('Remove this class from the week?')) return
    await api.deleteClassSession(id); setSessions(prev => prev.filter(s => s.id !== id))
  }

  async function createSchedule(e) {
    e.preventDefault()
    if (!form.client) return
    setSaving(true)
    try {
      await api.createClassSchedule({
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
      })
      setForm(BLANK_SCHEDULE); setShowNew(false); loadSchedules()
    } finally {
      setSaving(false)
    }
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
            <button onClick={generate} disabled={generating}
              className="px-3 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50">
              {generating ? 'Generating…' : 'Generate week'}
            </button>
          </div>

          {msg && <p className="text-xs text-gray-500 px-1">{msg}</p>}

          {loading ? (
            <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="text-gray-400 text-sm italic text-center py-10">
              No classes this week. Use “Generate week” to fill it from recurring schedules, or add recurring classes first.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between text-xs text-gray-500 px-1">
                <span>{sessions.length} class{sessions.length === 1 ? '' : 'es'}</span>
                <span>Week total: <span className="font-semibold text-gray-700">{money(weekTotal)}</span></span>
              </div>
              {WEEKDAYS.map((dayName, i) => {
                const date = ymd(addDays(weekStart, i))
                const rows = byDay[date]
                if (!rows) return null
                return (
                  <div key={date} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-600">
                      {dayName} · {parseLocal(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </div>
                    {rows.map((s, r) => (
                      <div key={s.id} className={`flex items-center gap-3 px-4 py-3 ${r > 0 ? 'border-t border-gray-100' : ''}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{s.client_name}</p>
                          <p className="text-xs text-gray-500 mt-0.5 truncate">
                            {s.instructor_name || 'No instructor'}{s.start_time ? ` · ${s.start_time.slice(0, 5)}` : ''}{s.style ? ` · ${s.style}` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-gray-800">{money(s.charge_amount)}</p>
                          <p className="text-[11px] text-gray-400">{s.payment_method || '—'}</p>
                        </div>
                        <select value={s.status} onChange={e => setSessionStatus(s.id, e.target.value)}
                          className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 text-gray-600 bg-white">
                          {SESSION_STATUS.map(st => <option key={st} value={st}>{st.replace('_', ' ')}</option>)}
                        </select>
                        <button onClick={() => removeSession(s.id)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex justify-end">
            <button onClick={() => setShowNew(v => !v)}
              className="px-3 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700">
              + New Recurring Class
            </button>
          </div>

          {showNew && (
            <form onSubmit={createSchedule} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="font-semibold text-gray-800 text-sm">New Recurring Class</h3>
              <div className="grid grid-cols-2 gap-3">
                <SearchSelect label="Client" required options={clients} value={form.client}
                  onChange={c => setForm(f => ({ ...f, client: c }))} placeholder="Search clients…" />
                <SearchSelect label="Instructor" options={instructors} value={form.instructor}
                  onChange={i => setForm(f => ({ ...f, instructor: i }))} placeholder="Search instructors…" />
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
                  <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
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
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving || !form.client}
                  className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save Recurring Class'}
                </button>
                <button type="button" onClick={() => { setShowNew(false); setForm(BLANK_SCHEDULE) }}
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
                <div key={s.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-100' : ''} ${s.status === 'paused' ? 'opacity-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{s.client_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {s.weekday != null ? WEEKDAYS[s.weekday] : 'Flexible'}{s.start_time ? ` · ${s.start_time.slice(0, 5)}` : ''}
                      {' · '}{s.instructor_name || 'No instructor'}{s.style ? ` · ${s.style}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-gray-800">{money(s.charge_amount)}</p>
                    <p className="text-[11px] text-gray-400">{s.payment_method || '—'}</p>
                  </div>
                  <button onClick={() => toggleSchedulePause(s)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-50">
                    {s.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => removeSchedule(s.id)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
