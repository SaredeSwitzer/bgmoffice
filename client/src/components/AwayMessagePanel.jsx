import { useEffect, useState } from 'react'
import { api } from '../api/client'
import DateInput from './DateInput'
import TimeInput from './TimeInput'

// Away messages for the business line — Yom Tov, Chol Hamoed, a vacation. Each one has a
// start and an end; anyone who texts in during it gets its reply once, callers hear its
// voicemail greeting, and it switches itself off at the end. Several can be lined up in
// one sitting, so a run of holidays doesn't need somebody at a computer between them.

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
  return iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
}
function toDraft(p) {
  const [sd, st] = splitLocal(p.starts_at)
  const [ed, et] = splitLocal(p.ends_at)
  return { text: p.text || '', voice_text: p.voice_text || '', sd, st, ed, et }
}

export default function AwayMessagePanel() {
  const [periods, setPeriods] = useState([])
  const [editing, setEditing] = useState(null)   // index being edited, or 'new'
  const [draft, setDraft]     = useState(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => { api.smsGetAway().then(r => setPeriods(r.periods || [])).catch(() => {}) }, [])

  // Past periods drop off the list; there is nothing left to do with them.
  const upcoming = periods.filter(p => !p.ends_at || new Date(p.ends_at) > new Date())

  async function saveList(list) {
    setSaving(true); setError('')
    try {
      const r = await api.smsSetAway({ periods: list })
      setPeriods(r.periods || [])
      setEditing(null); setDraft(null)
    } catch (e) {
      setError(e.message || 'Could not save that.')
    } finally {
      setSaving(false)
    }
  }

  function strip(p) {
    return { text: p.text, voice_text: p.voice_text, starts_at: p.starts_at, ends_at: p.ends_at, enabled: p.enabled !== false }
  }

  function saveDraft() {
    const item = {
      text: draft.text, voice_text: draft.voice_text, enabled: true,
      starts_at: joinLocal(draft.sd, draft.st), ends_at: joinLocal(draft.ed, draft.et),
    }
    const list = upcoming.map(strip)
    if (editing === 'new') list.push(item); else list[editing] = item
    saveList(list)
  }

  function remove(i) {
    saveList(upcoming.map(strip).filter((_, j) => j !== i))
  }

  const set = k => v => setDraft(d => ({ ...d, [k]: v }))

  return (
    <div className="mb-3 space-y-2">
      {upcoming.map((p, i) => editing === i ? null : (
        <div key={i} className={`rounded-xl border px-3 py-2 text-sm ${p.on_now ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-700'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{p.on_now ? 'Away message is on' : 'Away message scheduled'}</span>
            <span className="text-xs">{p.on_now ? '' : `${when(p.starts_at)} → `}until {when(p.ends_at)}</span>
            <button onClick={() => { setEditing(i); setDraft(toDraft(p)) }} className="ml-auto text-xs font-medium underline">Change</button>
            <button onClick={() => remove(i)} disabled={saving} className="text-xs font-medium text-red-700 underline">
              {p.on_now ? 'Turn off' : 'Remove'}
            </button>
          </div>
          <p className="mt-1 text-xs"><span className="font-medium">Text reply:</span> “{p.text}”</p>
          {p.voice_text && <p className="mt-0.5 text-xs"><span className="font-medium">Voicemail:</span> “{p.voice_text}”</p>}
        </div>
      ))}

      {editing === null && (
        <button onClick={() => { setEditing('new'); setDraft({ text: '', voice_text: '', sd: '', st: '', ed: '', et: '' }) }}
          className="text-xs font-medium text-gray-500 hover:text-gray-800 hover:underline">
          + Add an away message (Yom Tov, vacation)…
        </button>
      )}

      {editing !== null && draft && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Away message</h3>
          <p className="mb-3 text-xs text-gray-500">
            Between these times, anyone who texts gets the text reply once, and callers hear the
            voicemail message. It turns itself off at the end.
          </p>
          <label className="mb-1 block text-xs font-medium text-gray-600">Text reply</label>
          <textarea value={draft.text} onChange={e => set('text')(e.target.value)} rows={3}
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <label className="mb-1 block text-xs font-medium text-gray-600">Voicemail greeting (leave empty for the usual one)</label>
          <textarea value={draft.voice_text} onChange={e => set('voice_text')(e.target.value)} rows={3}
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Starts</label>
              <div className="flex gap-2"><DateInput value={draft.sd} onChange={set('sd')} /><TimeInput value={draft.st} onChange={set('st')} /></div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Ends</label>
              <div className="flex gap-2"><DateInput value={draft.ed} onChange={set('ed')} /><TimeInput value={draft.et} onChange={set('et')} /></div>
            </div>
          </div>
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={saveDraft} disabled={saving || !draft.text.trim() || !draft.ed}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(null); setDraft(null) }} className="text-xs text-gray-500 hover:text-gray-800">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
