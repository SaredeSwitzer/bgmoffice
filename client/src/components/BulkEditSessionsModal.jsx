import { useEffect, useState } from 'react'
import { api } from '../api/client'
import SearchSelect from './SearchSelect'
import TimeInput from './TimeInput'
import DurationInput from './DurationInput'

const PAYMENT_METHODS = ['Credit Card', 'Zelle', 'Check', 'Cash', 'Invoice', 'Package', 'Other']

// Each field has its own "apply this change" checkbox, off by default — so picking a
// new instructor doesn't accidentally also blank out everyone's time or rate. Only
// checked fields are sent, and only those get overwritten across every selected session.
const FIELD_DEFS = [
  { key: 'instructor_id', label: 'Instructor' },
  { key: 'start_time', label: 'Time' },
  { key: 'duration_minutes', label: 'Duration' },
  { key: 'charge_amount', label: 'Charge to client' },
  { key: 'instructor_pay', label: 'Instructor pay' },
  { key: 'payment_method', label: 'Payment method' },
  { key: 'style', label: 'Style' },
]

export default function BulkEditSessionsModal({ sessionIds, onClose, onSaved }) {
  const [instructors, setInstructors] = useState([])
  const [enabled, setEnabled] = useState({})
  const [instructor, setInstructor] = useState(null)
  const [startTime, setStartTime] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [chargeAmount, setChargeAmount] = useState('')
  const [instructorPay, setInstructorPay] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [style, setStyle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getInstructors().then(setInstructors)
  }, [])

  function toggle(key) {
    setEnabled(e => ({ ...e, [key]: !e[key] }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const updates = {}
    if (enabled.instructor_id)     updates.instructor_id = instructor?.id || null
    if (enabled.start_time)        updates.start_time = startTime || null
    if (enabled.duration_minutes)  updates.duration_minutes = durationMinutes || 60
    if (enabled.charge_amount)     updates.charge_amount = chargeAmount === '' ? null : chargeAmount
    if (enabled.instructor_pay)    updates.instructor_pay = instructorPay === '' ? null : instructorPay
    if (enabled.payment_method)    updates.payment_method = paymentMethod || null
    if (enabled.style)             updates.style = style || null

    if (Object.keys(updates).length === 0) {
      setError('Check at least one field to change.')
      return
    }
    setSaving(true); setError('')
    try {
      const saved = await api.bulkUpdateClassSessions({ session_ids: sessionIds, ...updates })
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
          <div>
            <h3 className="font-bold text-gray-900 text-base">Edit {sessionIds.length} class{sessionIds.length === 1 ? '' : 'es'}</h3>
            <p className="text-xs text-gray-500 mt-0.5">Check a field to change it on every selected class. Leave the rest untouched.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 space-y-3">
            <FieldRow label="Instructor" checked={!!enabled.instructor_id} onToggle={() => toggle('instructor_id')}>
              <SearchSelect options={instructors} value={instructor} onChange={setInstructor} placeholder="Search instructor…" />
            </FieldRow>
            <FieldRow label="Time" checked={!!enabled.start_time} onToggle={() => toggle('start_time')}>
              <TimeInput value={startTime} onChange={setStartTime} />
            </FieldRow>
            <FieldRow label="Duration" checked={!!enabled.duration_minutes} onToggle={() => toggle('duration_minutes')}>
              <DurationInput startTime={startTime} durationMinutes={durationMinutes} onDurationChange={setDurationMinutes} />
            </FieldRow>
            <FieldRow label="Charge to client" checked={!!enabled.charge_amount} onToggle={() => toggle('charge_amount')}>
              <input type="number" step="0.01" value={chargeAmount} onChange={e => setChargeAmount(e.target.value)}
                placeholder="35" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </FieldRow>
            <FieldRow label="Instructor pay" checked={!!enabled.instructor_pay} onToggle={() => toggle('instructor_pay')}>
              <input type="number" step="1" value={instructorPay} onChange={e => setInstructorPay(e.target.value)}
                placeholder="60" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </FieldRow>
            <FieldRow label="Payment method" checked={!!enabled.payment_method} onToggle={() => toggle('payment_method')}>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">—</option>
                {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Style" checked={!!enabled.style} onToggle={() => toggle('style')}>
              <input value={style} onChange={e => setStyle(e.target.value)}
                placeholder="Pilates" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </FieldRow>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            <button type="submit" disabled={saving}
              className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700">
              {saving ? 'Saving…' : `Apply to ${sessionIds.length} class${sessionIds.length === 1 ? '' : 'es'}`}
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

function FieldRow({ label, checked, onToggle, children }) {
  return (
    <div className={`flex items-start gap-3 ${checked ? '' : 'opacity-50'}`}>
      <label className="flex items-center gap-2 pt-2 w-36 flex-shrink-0 cursor-pointer select-none">
        <input type="checkbox" checked={checked} onChange={onToggle} className="rounded border-gray-300" />
        <span className="text-xs font-medium text-gray-600">{label}</span>
      </label>
      <div className={`flex-1 ${checked ? '' : 'pointer-events-none'}`}>
        {children}
      </div>
    </div>
  )
}
