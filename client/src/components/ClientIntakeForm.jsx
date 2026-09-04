import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import SearchSelect from './SearchSelect'

// Taking a class on, typed straight into the app.
//
// These are the questions from the intake form staff have always filled in on the phone,
// in the same order, so nobody has to learn a new script. What's different is where the
// answers go: one submit writes the client's profile and the recruiting entry, and links
// them, instead of leaving a name in a box that someone re-types into Clients later.
//
// Nothing here decides anything about the class itself — an intake is "we've agreed to
// teach this"; scheduling happens once an instructor is found.

const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const BLANK = {
  new_or_past: 'New', gender: '', client_name: '', referral: '', phone: '',
  style: '', neighborhood: '', address: '', participants: '', client_rate: '',
  time_slot: '', notes: '', waiver: 'No', instructor_info: '', confirmed: '',
  class_type: '', class_dates: '',
}

export default function ClientIntakeForm({ clients = [], styles = [], onSaved }) {
  const { user } = useAuth()
  const [f, setF] = useState(BLANK)
  const [client, setClient] = useState(null)       // the existing client, when it's not new
  const [createClient, setCreateClient] = useState(true)
  const [days, setDays] = useState([])             // [{ day, time }]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  const isPast = f.new_or_past === 'Past'

  function toggleDay(day) {
    setDays(prev => prev.some(d => d.day === day)
      ? prev.filter(d => d.day !== day)
      : [...prev, { day, time: '' }])
  }
  const setDayTime = (day, time) =>
    setDays(prev => prev.map(d => (d.day === day ? { ...d, time } : d)))

  async function submit(e) {
    e.preventDefault()
    if (!isPast && !f.client_name.trim()) { setError('Who is the class for?'); return }
    if (isPast && !client)                { setError('Pick the client this is for.'); return }
    setSaving(true)
    setError('')
    try {
      const saved = await api.submitClientIntake({
        ...f,
        client_id: isPast ? client.id : null,
        create_client: !isPast && createClient,
        preferred_days: days.filter(d => d.day),
      })
      setDone(saved)
      onSaved?.(saved)
    } catch (err) {
      setError(err.message || 'That did not save.')
    } finally { setSaving(false) }
  }

  function startAnother() {
    setF(BLANK); setClient(null); setCreateClient(true); setDays([]); setDone(null); setError('')
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'
  const selectCls = `${inputCls} bg-white`
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  // What actually happened, in the words of "where do I go now" — the two records this
  // created are both worth opening, and the profile says which blanks it filled so nobody
  // wonders whether the intake overwrote something they'd already checked.
  if (done) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-3 max-w-2xl">
        <p className="text-sm font-semibold text-green-800">✓ Intake saved</p>
        <ul className="text-sm text-gray-700 space-y-1">
          <li>
            Recruiting entry created for{' '}
            <span className="font-medium">{done.entry?.client_name || 'this class'}</span>
            {done.entry?.day_of_week ? ` · ${done.entry.day_of_week}` : ''}
            {done.entry?.time_slot ? ` ${done.entry.time_slot}` : ''}
          </li>
          {done.client && (
            <li>
              Client profile:{' '}
              <Link to={`/clients/${done.client.id}`} className="text-blue-600 hover:underline font-medium">
                {done.client.name} →
              </Link>
              {done.filled_on_client?.length > 0 && (
                <span className="text-gray-500">
                  {' '}(filled in {done.filled_on_client.map(c => c.replace(/_/g, ' ')).join(', ')})
                </span>
              )}
            </li>
          )}
          {!done.client && (
            <li className="text-gray-500">No client profile was made — the entry keeps the name only.</li>
          )}
        </ul>
        <div className="flex gap-2 pt-1">
          <button onClick={startAnother}
            className="px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-700">
            Take another intake
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4 max-w-2xl">
      <div>
        <h2 className="text-sm font-bold text-gray-900">New client intake</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Taken by {user?.initials}. Saving this makes the recruiting entry and the client
          profile in one go, already linked to each other.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>New or past client?</label>
          <select value={f.new_or_past} onChange={e => { set('new_or_past', e.target.value); setClient(null) }}
            className={selectCls}>
            <option value="New">New client</option>
            <option value="Past">Past client</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Men&rsquo;s or women&rsquo;s class?</label>
          <select value={f.gender} onChange={e => set('gender', e.target.value)} className={selectCls}>
            <option value="">Not specified</option>
            <option value="Female">Women</option>
            <option value="Male">Men</option>
          </select>
        </div>
      </div>

      {isPast ? (
        <div>
          <label className={labelCls}>Which client? *</label>
          <SearchSelect
            options={clients.map(c => ({ id: c.id, name: c.name }))}
            value={client}
            onChange={c => { setClient(c); if (c) set('client_name', c.name) }}
            placeholder="Search clients…"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Their profile is left as it is — anything below only fills in blanks.
          </p>
        </div>
      ) : (
        <div>
          <label className={labelCls}>Client name *</label>
          <input value={f.client_name} onChange={e => set('client_name', e.target.value)}
            placeholder="Who the class is for" className={inputCls} />
          <label className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-500 select-none cursor-pointer">
            <input type="checkbox" checked={createClient} onChange={e => setCreateClient(e.target.checked)}
              className="accent-gray-800" />
            Make a client profile for them now
          </label>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Who referred them?</label>
          <input value={f.referral} onChange={e => set('referral', e.target.value)}
            placeholder="Name, or how they found us" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Phone</label>
          <input value={f.phone} onChange={e => set('phone', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Class style</label>
          <input list="intake-styles" value={f.style} onChange={e => set('style', e.target.value)}
            placeholder="e.g. Zumba" className={inputCls} />
          <datalist id="intake-styles">
            {styles.map(s => <option key={s.id ?? s.name} value={s.name ?? s} />)}
          </datalist>
        </div>
        <div>
          <label className={labelCls}>Neighborhood</label>
          <input value={f.neighborhood} onChange={e => set('neighborhood', e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Address</label>
          <input value={f.address} onChange={e => set('address', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}># of participants</label>
          <input value={f.participants} onChange={e => set('participants', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Rate charging client</label>
          <input value={f.client_rate} onChange={e => set('client_rate', e.target.value)}
            placeholder="e.g. 80" className={inputCls} />
        </div>
      </div>

      {/* The paper form asks for the time in one free-text line; in here the day can be
          said outright, which is what decides where the entry files itself. */}
      <div>
        <label className={labelCls}>Day(s) &amp; time</label>
        <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
          {WEEK_DAYS.map(d => {
            const selected = days.find(x => x.day === d)
            return (
              <div key={d} className={`flex items-center gap-3 px-3 py-1.5 ${selected ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}>
                <label className="flex items-center gap-2 cursor-pointer shrink-0 w-28">
                  <input type="checkbox" checked={!!selected} onChange={() => toggleDay(d)}
                    className="w-3.5 h-3.5 accent-gray-800" />
                  <span className="text-sm text-gray-700">{d}</span>
                </label>
                {selected && (
                  <input value={selected.time} onChange={e => setDayTime(d, e.target.value)}
                    placeholder="Time (e.g. 9–10am)"
                    className="flex-1 border border-blue-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300" />
                )}
              </div>
            )
          })}
        </div>
        <input value={f.time_slot} onChange={e => set('time_slot', e.target.value)}
          placeholder="Or describe the timing in their words — “Tuesdays 8pm, starting next week”"
          className={`${inputCls} mt-2`} />
        {days.length > 1 && (
          <p className="text-[11px] text-blue-600 mt-1">More than one day — the entry files under Flex.</p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Class type</label>
          <select value={f.class_type} onChange={e => set('class_type', e.target.value)} className={selectCls}>
            <option value="">Not specified</option>
            <option value="ala_carte">A la carte</option>
            <option value="ongoing_weekly">Ongoing weekly</option>
            <option value="semester">Semester</option>
          </select>
        </div>
        {(f.class_type === 'ala_carte' || f.class_type === 'semester') && (
          <div>
            <label className={labelCls}>{f.class_type === 'ala_carte' ? 'Specific dates' : 'Date range'}</label>
            <input value={f.class_dates} onChange={e => set('class_dates', e.target.value)} className={inputCls} />
          </div>
        )}
        <div>
          <label className={labelCls}>Waiver signed?</label>
          <select value={f.waiver} onChange={e => set('waiver', e.target.value)} className={selectCls}>
            <option value="No">Not yet</option>
            <option value="YES">Yes</option>
            <option value="Sent, waiting">Sent, waiting</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Is the class confirmed / CC on file?</label>
          <input value={f.confirmed} onChange={e => set('confirmed', e.target.value)}
            placeholder="e.g. confirmed, card on file" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Potential instructor</label>
          <input value={f.instructor_info} onChange={e => set('instructor_info', e.target.value)}
            placeholder="Anyone in mind, or who they asked for" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Notes</label>
          <textarea value={f.notes} onChange={e => set('notes', e.target.value)} rows={3}
            placeholder="Anything else from the call"
            className={`${inputCls} resize-y`} />
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 hover:bg-blue-700">
          {saving ? 'Saving…' : 'Save intake'}
        </button>
        <button type="button" onClick={startAnother}
          className="px-4 py-2 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">
          Clear
        </button>
      </div>
    </form>
  )
}
