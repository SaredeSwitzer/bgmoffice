import { useEffect, useState } from 'react'
import { api } from '../api/client'
import SearchSelect from './SearchSelect'
import DateInput from './DateInput'

const PAYMENT_METHODS = ['Credit Card', 'Zelle', 'Check', 'Cash', 'Invoice', 'Package', 'Other']

// Add, edit, or duplicate a single dated class on the calendar.
//   session: null                    → create new, pre-filled with `defaultDate`
//   session: {...}                   → edit that session in place
//   session: {...}, duplicate: true  → pre-filled from that session, but saves as a new one
export default function ClassSessionModal({ session, defaultDate, duplicate = false, onClose, onSaved, onDeleted }) {
  const isEdit = !!session?.id && !duplicate
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [form, setForm] = useState({
    client: session ? { id: session.client_id, name: session.client_name } : null,
    instructor: session?.instructor_id ? { id: session.instructor_id, name: session.instructor_name } : null,
    session_date: duplicate ? (defaultDate || '') : (session?.session_date || defaultDate || ''),
    start_time: session?.start_time ? session.start_time.slice(0, 5) : '',
    charge_amount: session?.charge_amount ?? '',
    instructor_pay: session?.instructor_pay ?? '',
    payment_method: session?.payment_method || '',
    style: session?.style || '',
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
    if (!form.session_date) { setError('Please pick a date.'); return }
    setSaving(true); setError('')
    const payload = {
      client_id: form.client.id,
      instructor_id: form.instructor?.id || null,
      session_date: form.session_date,
      start_time: form.start_time || null,
      charge_amount: form.charge_amount === '' ? null : form.charge_amount,
      instructor_pay: form.instructor_pay === '' ? null : form.instructor_pay,
      payment_method: form.payment_method || null,
      style: form.style || null,
    }
    try {
      const saved = isEdit
        ? await api.updateClassSession(session.id, payload)
        : await api.createClassSession(payload)
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-900 text-base">{isEdit ? 'Edit Class' : duplicate ? 'Duplicate Class' : 'Add Class'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 space-y-3">
            <SearchSelect label="Client" required options={clients} value={form.client}
              onChange={v => setField('client', v)} placeholder="Search client…" />
            <SearchSelect label="Instructor" options={instructors} value={form.instructor}
              onChange={v => setForm(f => ({
                ...f,
                instructor: v,
                // Pay follows whoever is actually teaching, not the client or a prior
                // instructor's rate — e.g. when someone subs a one-off class.
                instructor_pay: v?.pay_rate ?? f.instructor_pay,
              }))} placeholder="Search instructor…" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <DateInput value={form.session_date} onChange={v => setField('session_date', v)} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
                <input type="time" value={form.start_time} onChange={e => setField('start_time', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Charge to client</label>
                <input type="number" step="1" value={form.charge_amount} onChange={e => setField('charge_amount', e.target.value)}
                  placeholder="95" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Instructor pay</label>
                <input type="number" step="1" value={form.instructor_pay} onChange={e => setField('instructor_pay', e.target.value)}
                  placeholder="60" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment method</label>
                <select value={form.payment_method} onChange={e => setField('payment_method', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">—</option>
                  {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Style</label>
                <input value={form.style} onChange={e => setField('style', e.target.value)}
                  placeholder="Pilates" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            <button type="submit" disabled={saving}
              className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700">
              {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Class')}
            </button>
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
        </form>
      </div>
    </div>
  )
}
