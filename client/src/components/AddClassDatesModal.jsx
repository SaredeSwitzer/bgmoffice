import { useEffect, useState } from 'react'
import { api } from '../api/client'
import SearchSelect from './SearchSelect'
import MultiDateInput from './MultiDateInput'
import TimeInput from './TimeInput'
import ClientAddressEditor from './ClientAddressEditor'
import DurationInput from './DurationInput'
import ChargeInput from './ChargeInput'

const PAYMENT_METHODS = ['Credit Card', 'Zelle', 'Check', 'Cash', 'Invoice', 'Package', 'Other']

// Add a set of specific dates at once — for a run of classes that doesn't fit a weekly
// recurring pattern (e.g. "these 6 dates over the next two months"). Same fields as a
// single class, one shared time/rate/etc. applied to every date picked.
export default function AddClassDatesModal({ onClose, onSaved }) {
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [form, setForm] = useState({
    client: null, instructor: null, dates: [],
    start_time: '', duration_minutes: 60,
    charge_amount: '', charge_note: '', instructor_pay: '', payment_method: '', style: '',
    participant_count: '', participant_ages: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.getClients(), api.getInstructors()])
      .then(([c, i]) => { setClients(c); setInstructors(i) })
  }, [])

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.client) { setError('Please select a client.'); return }
    if (form.dates.length === 0) { setError('Please pick at least one date.'); return }
    setSaving(true); setError('')
    const payload = {
      client_id: form.client.id,
      instructor_id: form.instructor?.id || null,
      dates: form.dates,
      start_time: form.start_time || null,
      duration_minutes: form.duration_minutes || 60,
      charge_amount: form.charge_amount === '' ? null : form.charge_amount,
      charge_note: form.charge_note || null,
      instructor_pay: form.instructor_pay === '' ? null : form.instructor_pay,
      payment_method: form.payment_method || null,
      style: form.style || null,
      participant_count: form.participant_count === '' ? null : form.participant_count,
      participant_ages: form.participant_ages || null,
    }
    try {
      const saved = await api.createClassSessionsBulk(payload)
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 px-4 py-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-900 text-base">Add Class Dates</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 space-y-3">
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
                instructor_pay: v?.pay_rate ?? f.instructor_pay,
              }))} placeholder="Search instructor…" />
            {form.client && (
              <ClientAddressEditor
                client={form.client}
                onUpdated={addr => setForm(f => ({ ...f, client: { ...f.client, ...addr } }))}
              />
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Dates</label>
              <MultiDateInput value={form.dates} onChange={v => setField('dates', v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
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
                  placeholder="e.g. 12, or Around 15 kids" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ages</label>
                <input value={form.participant_ages} onChange={e => setField('participant_ages', e.target.value)}
                  placeholder="e.g. 6, 8" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            <button type="submit" disabled={saving}
              className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700">
              {saving ? 'Saving…' : `Add ${form.dates.length || ''} Class${form.dates.length === 1 ? '' : 'es'}`.trim()}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
