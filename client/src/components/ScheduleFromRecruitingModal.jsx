import { useEffect, useState } from 'react'
import { api } from '../api/client'
import DateInput from './DateInput'
import SearchSelect from './SearchSelect'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Turn a recruiting entry into real calendar classes once an instructor is lined up,
// instead of retyping it all into the Schedule screen. Prefilled from the entry, but
// everything stays editable — the entry's free-text fields ("$75 for 30 min (30-45 min)",
// "mon wed and fri 8am would be perfect") are notes from a phone call, not clean data,
// so they're shown for reference rather than parsed into the form.
export default function ScheduleFromRecruitingModal({ entry, instructors, onClose, onDone }) {
  const [mode, setMode] = useState('recurring')
  const [clients, setClients] = useState([])
  const [client, setClient] = useState(null)          // existing client, when one is picked
  const [makeClient, setMakeClient] = useState(!entry.client_id)
  const [form, setForm] = useState({
    instructor_id: entry.instructor_id || '',
    weekday: WEEKDAYS.includes(entry.day_of_week) ? entry.day_of_week : '',
    start_time: '',
    duration_minutes: 60,
    charge_amount: '',
    instructor_pay: '',
    payment_method: '',
    style: entry.style || '',
  })
  const [dates, setDates] = useState([''])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getClients().then(setClients).catch(() => {})
  }, [])

  useEffect(() => {
    if (entry.client_id && clients.length) {
      setClient(clients.find(c => String(c.id) === String(entry.client_id)) || null)
    }
  }, [entry.client_id, clients])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const cleanDates = dates.filter(Boolean)

  async function handleSave(archive) {
    setError('')
    if (!form.start_time) return setError('Add a start time.')
    if (mode === 'recurring' && !form.weekday) return setError('Pick which day it repeats on.')
    if (mode === 'dates' && cleanDates.length === 0) return setError('Pick at least one date.')
    if (!client && !makeClient) return setError('Pick a client, or tick "create a client".')

    setSaving(true)
    try {
      const res = await api.scheduleFromRecruiting(entry.id, {
        mode,
        client_id: client?.id || null,
        create_client: !client && makeClient,
        instructor_id: form.instructor_id || null,
        weekday: form.weekday,
        start_time: form.start_time,
        duration_minutes: Number(form.duration_minutes) || 60,
        charge_amount: form.charge_amount === '' ? null : Number(form.charge_amount),
        instructor_pay: form.instructor_pay === '' ? null : Number(form.instructor_pay),
        payment_method: form.payment_method || null,
        style: form.style || null,
        dates: mode === 'dates' ? cleanDates : (cleanDates[0] ? [cleanDates[0]] : []),
        archive,
      })
      onDone?.(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Add to calendar · {entry.client_name?.trim()}</h3>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-700">×</button>
        </div>

        <div className="space-y-3 p-5">
          {/* What was written down when this lead came in — often a phone note, not
              clean data, so it's shown to copy from rather than auto-filled. */}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600">
            {entry.time_slot && <p><span className="font-semibold">When:</span> {entry.time_slot}</p>}
            {entry.client_rate && <p><span className="font-semibold">Rate discussed:</span> {entry.client_rate}</p>}
            {entry.participants && <p><span className="font-semibold">Who:</span> {entry.participants}</p>}
            {entry.address && <p><span className="font-semibold">Where:</span> {entry.address.trim()}</p>}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Client</label>
            {entry.client_id || client ? (
              <SearchSelect options={clients} value={client} onChange={setClient} placeholder="Search clients…" />
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={makeClient} onChange={e => setMakeClient(e.target.checked)} />
                  Create a new client called “{entry.client_name?.trim()}”
                </label>
                {!makeClient && (
                  <div className="mt-2">
                    <SearchSelect options={clients} value={client} onChange={setClient} placeholder="…or pick an existing client" />
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Instructor</label>
            <select value={form.instructor_id} onChange={e => set('instructor_id', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
              <option value="">— none yet —</option>
              {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>

          <div className="inline-flex rounded-lg border border-gray-300 p-0.5 text-xs">
            <button type="button" onClick={() => setMode('recurring')}
              className={`rounded-md px-3 py-1 ${mode === 'recurring' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>Every week</button>
            <button type="button" onClick={() => setMode('dates')}
              className={`rounded-md px-3 py-1 ${mode === 'dates' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>Specific dates</button>
          </div>

          {mode === 'recurring' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Repeats on</label>
                <select value={form.weekday} onChange={e => set('weekday', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
                  <option value="">— pick a day —</option>
                  {WEEKDAYS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Starting (optional)</label>
                <DateInput value={dates[0] || ''} onChange={v => setDates([v])} />
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Dates</label>
              <div className="space-y-2">
                {dates.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1"><DateInput value={d} onChange={v => setDates(ds => ds.map((x, j) => j === i ? v : x))} /></div>
                    {dates.length > 1 && (
                      <button type="button" onClick={() => setDates(ds => ds.filter((_, j) => j !== i))}
                        className="text-xs text-gray-400 hover:text-red-500">✕</button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setDates(ds => [...ds, ''])}
                className="mt-1.5 text-[11px] text-blue-600 hover:underline">+ Add another date</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Start time</label>
              <input type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Minutes</label>
              <input type="number" value={form.duration_minutes} onChange={e => set('duration_minutes', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Charge client</label>
              <input type="number" value={form.charge_amount} onChange={e => set('charge_amount', e.target.value)}
                placeholder="$" className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Pay instructor</label>
              <input type="number" value={form.instructor_pay} onChange={e => set('instructor_pay', e.target.value)}
                placeholder="$" className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Payment method</label>
              <select value={form.payment_method} onChange={e => set('payment_method', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
                <option value="">—</option>
                {['Credit Card', 'Invoice', 'Package', 'Cash', 'Check'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Style</label>
              <input value={form.style} onChange={e => set('style', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600">Cancel</button>
          <button onClick={() => handleSave(false)} disabled={saving}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50">
            {saving ? 'Adding…' : 'Add to calendar'}
          </button>
          <button onClick={() => handleSave(true)} disabled={saving}
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            Add &amp; archive entry
          </button>
        </div>
      </div>
    </div>
  )
}
