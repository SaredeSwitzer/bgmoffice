import { useEffect, useState } from 'react'
import { api } from '../api/client'
import DateInput from './DateInput'
import TimeInput from './TimeInput'

// The away message for the texting line — for Yom Tov, a vacation, any time nobody can
// answer. Anyone who texts in between the two times gets this message back once, and it
// turns itself off at the end time.

function pad(n) { return String(n).padStart(2, '0') }
function splitLocal(iso) {
  if (!iso) return ['', '']
  const d = new Date(iso)
  return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`]
}
function joinLocal(date, time) {
  return date ? new Date(`${date}T${time || '00:00'}`).toISOString() : null
}
function when(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function AwayMessagePanel() {
  const [away, setAway]     = useState(null)
  const [onNow, setOnNow]   = useState(false)
  const [open, setOpen]     = useState(false)
  const [text, setText]     = useState('')
  const [sd, setSd] = useState(''); const [st, setSt] = useState('')
  const [ed, setEd] = useState(''); const [et, setEt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  function take(r) {
    setAway(r.away); setOnNow(r.on_now)
    const a = r.away || {}
    setText(a.text || '')
    const [d1, t1] = splitLocal(a.starts_at); setSd(d1); setSt(t1)
    const [d2, t2] = splitLocal(a.ends_at);   setEd(d2); setEt(t2)
  }

  useEffect(() => { api.smsGetAway().then(take).catch(() => {}) }, [])

  async function save(enabled) {
    setSaving(true); setError('')
    try {
      take(await api.smsSetAway({ text, enabled, starts_at: joinLocal(sd, st), ends_at: joinLocal(ed, et) }))
      setOpen(false)
    } catch (e) {
      setError(e.message || 'Could not save that.')
    } finally {
      setSaving(false)
    }
  }

  const scheduled = away?.enabled && away.starts_at && new Date(away.starts_at) > new Date()

  return (
    <div className="mb-3">
      {!open && (
        onNow || scheduled ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="font-semibold">{onNow ? 'Away message is on' : 'Away message is scheduled'}</span>
            <span className="text-amber-800">
              {scheduled ? `from ${when(away.starts_at)} ` : ''}
              {away.ends_at ? `until ${when(away.ends_at)}` : ''} — everyone who texts gets one reply:
              “{away.text}”
            </span>
            <button onClick={() => setOpen(true)} className="ml-auto text-xs font-medium text-amber-900 underline">Change</button>
            <button onClick={() => save(false)} disabled={saving} className="text-xs font-medium text-red-700 underline">Turn off</button>
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="text-xs font-medium text-gray-500 hover:text-gray-800 hover:underline">
            Set an away message (Yom Tov, vacation)…
          </button>
        )
      )}

      {open && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Away message</h3>
          <p className="mb-3 text-xs text-gray-500">
            Anyone who texts in between these times gets this reply once. It turns itself off at the end.
          </p>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Starts</label>
              <div className="flex gap-2"><DateInput value={sd} onChange={setSd} /><TimeInput value={st} onChange={setSt} /></div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Ends</label>
              <div className="flex gap-2"><DateInput value={ed} onChange={setEd} /><TimeInput value={et} onChange={setEt} /></div>
            </div>
          </div>
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={() => save(true)} disabled={saving || !text.trim()}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save and turn on'}
            </button>
            <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-800">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
