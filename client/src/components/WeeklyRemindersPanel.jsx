import { useEffect, useState } from 'react'
import { api } from '../api/client'

// The weekly class-reminder run, moved off Amber's Google Voice browser automation.
// Deliberately preview-first: nothing sends until staff has seen every message and the
// list of who's being skipped. Amber's version once reported success while delivering
// zero texts for weeks, so per-person results are shown after sending too.
export default function WeeklyRemindersPanel({ onClose, onSent }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [excluded, setExcluded] = useState(() => new Set())
  const [edits, setEdits] = useState({})           // key -> edited message body
  const [openKey, setOpenKey] = useState(null)
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState(null)
  const [range, setRange] = useState({ start: '', end: '' })

  const keyOf = r => `${r.kind}-${r.id}`

  function load(params) {
    setLoading(true); setError('')
    api.getWeeklyReminders(params)
      .then(d => { setData(d); setRange({ start: d.start, end: d.end }); setExcluded(new Set()); setEdits({}) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function toggle(key) {
    setExcluded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const included = (data?.recipients || []).filter(r => !excluded.has(keyOf(r)))

  async function handleSend() {
    if (included.length === 0) return
    if (!confirm(`Send ${included.length} text${included.length === 1 ? '' : 's'} for ${data.label}?`)) return
    setSending(true); setError('')
    try {
      const res = await api.sendWeeklyReminders(included.map(r => ({
        to: r.phone, name: r.name, body: edits[keyOf(r)] ?? r.message,
      })))
      setResults(res)
      onSent?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Building this week’s reminders…</div>

  if (results) {
    const failed = results.results.filter(r => !r.ok)
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <span className="font-medium text-gray-900">Weekly reminders sent</span>
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Close</button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm text-gray-800">
            ✅ Sent {results.sent}{results.failed > 0 && <span className="text-red-600"> · {results.failed} failed</span>}
          </p>
          {failed.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="mb-1 text-xs font-semibold text-red-800">These didn’t go through — send them by hand:</p>
              <ul className="space-y-0.5 text-xs text-red-700">
                {failed.map((f, i) => <li key={i}>• {f.name || f.to} — {f.error}</li>)}
              </ul>
            </div>
          )}
          <p className="text-xs text-gray-500">Replies land in the Texts inbox.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <span className="font-medium text-gray-900">Weekly reminders · {data.label}</span>
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Close</button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-600">Week starts</label>
            <input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-600">through</label>
            <input type="date" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs" />
          </div>
          <button onClick={() => load(range)}
            className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
            Rebuild
          </button>
        </div>

        {data.flags.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="mb-1 text-xs font-semibold text-amber-900">Needs your attention ({data.flags.length})</p>
            <ul className="space-y-0.5 text-xs text-amber-800">
              {data.flags.map((f, i) => <li key={i}>• {f}</li>)}
            </ul>
          </div>
        )}

        <p className="text-xs text-gray-500">
          {included.length} of {data.recipients.length} will be texted. Untick anyone you want to skip, or click a
          name to read and edit their message.
        </p>

        {['instructor', 'client'].map(kind => {
          const group = data.recipients.filter(r => r.kind === kind)
          if (group.length === 0) return null
          return (
            <div key={kind}>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                {kind === 'instructor' ? 'Instructors' : 'Clients'} ({group.length})
              </p>
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {group.map(r => {
                  const key = keyOf(r)
                  const isOpen = openKey === key
                  return (
                    <div key={key} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={!excluded.has(key)} onChange={() => toggle(key)}
                          className="h-4 w-4 rounded border-gray-300" />
                        <button type="button" onClick={() => setOpenKey(isOpen ? null : key)}
                          className="flex-1 text-left text-sm text-gray-800 hover:underline">
                          {r.name}
                          <span className="ml-1.5 text-[11px] text-gray-400">
                            {r.class_count} class{r.class_count === 1 ? '' : 'es'}
                          </span>
                        </button>
                      </div>
                      {isOpen && (
                        <textarea
                          value={edits[key] ?? r.message}
                          onChange={e => setEdits(prev => ({ ...prev, [key]: e.target.value }))}
                          rows={6}
                          className="mt-2 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs leading-relaxed"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <footer className="border-t border-gray-200 p-3">
        <button onClick={handleSend} disabled={sending || included.length === 0}
          className="w-full rounded-lg bg-gray-900 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {sending ? 'Sending…' : `Send ${included.length} reminder${included.length === 1 ? '' : 's'}`}
        </button>
      </footer>
    </div>
  )
}
