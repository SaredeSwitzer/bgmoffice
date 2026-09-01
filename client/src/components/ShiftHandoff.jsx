import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

// What one shift leaves for the next.
//
// The three sections are how staff actually describe a shift: what's on fire, who needs
// chasing, and who owes us a reply. The middle one is names only on purpose — the detail
// lives in the app, and a handoff that restates it goes stale the moment somebody updates
// the record.
//
// The draft is built from the working sheet as it stands, so nobody retypes what's already
// there. Edit it, add what the sheet can't know, save.

function fmtWhen(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const SECTIONS = [
  {
    key: 'urgent',
    title: 'Urgent',
    hint: 'Deal with these first. If nothing is on fire, say so — an empty section reads as "you forgot".',
    accent: 'border-red-300 bg-red-50/50',
    label: 'text-red-700',
  },
  {
    key: 'follow_up',
    title: 'Needs following up',
    hint: 'Names only. Whoever picks this up looks the details up in the app.',
    accent: 'border-amber-300 bg-amber-50/50',
    label: 'text-amber-800',
  },
  {
    key: 'waiting',
    title: 'Waiting to hear back from',
    hint: 'Who owes us a reply, and anything the next person should know before chasing.',
    accent: 'border-blue-300 bg-blue-50/50',
    label: 'text-blue-800',
  },
]

// ── What the person starting a shift reads ────────────────────────────────────
export function LatestHandoff() {
  const { user } = useAuth()
  const [row, setRow] = useState(undefined)   // undefined = loading, null = none yet
  const [open, setOpen] = useState(true)

  useEffect(() => {
    api.getLatestHandoff().then(setRow).catch(() => setRow(null))
  }, [])

  async function markRead() {
    const updated = await api.markHandoffRead(row.id)
    setRow(updated)
  }

  if (row === undefined || row === null) return null

  const sections = SECTIONS.filter(s => (row[s.key] || '').trim())

  return (
    <section className="rounded-xl border border-gray-900/10 bg-white shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-gray-400 text-xs">{open ? '▾' : '▸'}</span>
          <span className="text-sm font-bold uppercase tracking-widest text-gray-600">
            Handoff from {row.author}
          </span>
          <span className="text-xs text-gray-400 truncate">{fmtWhen(row.created_at)}</span>
        </span>
        {!row.read_at && (
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-blue-600 text-white px-2 py-0.5 rounded-full">
            New
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {sections.length === 0 && (
            <p className="text-sm text-gray-400 italic">They left nothing outstanding.</p>
          )}
          {sections.map(s => (
            <div key={s.key} className={`rounded-lg border ${s.accent} px-3 py-2`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${s.label}`}>{s.title}</p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{row[s.key]}</p>
            </div>
          ))}
          {row.notes && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-gray-500">Anything else</p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{row.notes}</p>
            </div>
          )}
          <div className="flex items-center gap-3">
            {row.read_at ? (
              <p className="text-[11px] text-gray-400">Read by {row.read_by} &middot; {fmtWhen(row.read_at)}</p>
            ) : (
              <button onClick={markRead}
                className="px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-700">
                ✓ Read it — I&rsquo;ve got this
              </button>
            )}
            {!row.read_at && user?.initials === row.author && (
              <span className="text-[11px] text-gray-400">(this is your own)</span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

// ── What the person ending a shift writes ─────────────────────────────────────
export function WriteHandoff() {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function start() {
    setError('')
    try {
      const draft = await api.getHandoffDraft()
      setForm({ urgent: draft.urgent || '', follow_up: draft.follow_up || '', waiting: draft.waiting || '', notes: '' })
    } catch (e) {
      // A failed draft shouldn't stop the handoff being written by hand.
      setForm({ urgent: '', follow_up: '', waiting: '', notes: '' })
      setError('Couldn’t read the sheet for a starting draft — write it yourself below.')
    }
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      await api.saveHandoff(form)
      setSaved(true)
      setForm(null)
    } catch (e) {
      setError(e.message || 'That didn’t save.')
    } finally { setSaving(false) }
  }

  if (saved) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50/60 px-4 py-3">
        <p className="text-sm font-semibold text-green-800">✓ Handoff saved</p>
        <p className="text-xs text-green-700 mt-0.5">
          The next person sees it at the top of My Tasks when they start.
        </p>
      </div>
    )
  }

  if (!form) {
    return (
      <button onClick={start}
        className="px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-700">
        Write the handoff for the next shift
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-gray-900">Handoff for the next shift</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Filled in from your sheet. Edit it, add anything the sheet can&rsquo;t know, then save.
          Write it for somebody who has no idea what you did today.
        </p>
      </div>

      {SECTIONS.map(s => (
        <div key={s.key}>
          <label className={`block text-[10px] font-bold uppercase tracking-widest mb-1 ${s.label}`}>
            {s.title}
          </label>
          <textarea
            value={form[s.key]}
            onChange={e => setForm(f => ({ ...f, [s.key]: e.target.value }))}
            rows={Math.max(2, Math.min(8, (form[s.key] || '').split('\n').length + 1))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-[11px] text-gray-400 mt-0.5">{s.hint}</p>
        </div>
      ))}

      <div>
        <label className="block text-[10px] font-bold uppercase tracking-widest mb-1 text-gray-500">
          Anything else
        </label>
        <textarea
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          rows={2}
          placeholder="Anything that doesn't fit above"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 hover:bg-blue-700">
          {saving ? 'Saving…' : 'Save handoff'}
        </button>
        <button onClick={() => setForm(null)}
          className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">Cancel</button>
      </div>
    </div>
  )
}
