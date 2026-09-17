import { useEffect, useState } from 'react'
import { api } from '../api/client'


// Putting a name to a number you're texting.
//
// An unrecognised number shows as "(347) 586-2328" at the top of the conversation and in
// the call log, every time, for ever — thirteen of those had built up. There was no way to
// write down who somebody is short of inventing a client record for a person who is not a
// client, which would then turn up in invoice pickers and billing runs.
//
// So it asks what kind of contact this is, because the honest answer varies and the app
// cannot tell. A client or an instructor gets a real profile, since everything downstream
// needs one. A potential client, a potential instructor or anyone else gets a name and a
// label and nothing more.
//
// Whatever is chosen, an existing person is offered first: type "sharon" and the Sharon
// already on file appears, so her number lands on HER profile instead of creating a second
// Sharon. Duplicate instructors have been a real clean-up job here more than once.

function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '').slice(-10)
  if (d.length !== 10) return p || ''
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

const CATEGORIES = [
  { key: 'client', label: 'Client', hint: 'Creates a client profile' },
  { key: 'instructor', label: 'Instructor', hint: 'Creates an instructor profile' },
  { key: 'potential_client', label: 'Potential client', hint: 'Just a name for now' },
  { key: 'potential_instructor', label: 'Potential instructor', hint: 'Just a name for now' },
  { key: 'other', label: 'Other', hint: 'Anyone else' },
]

export default function SaveContactPanel({ phone, onSaved, onClose }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [matches, setMatches] = useState([])
  const [link, setLink] = useState(null)      // an existing person to attach to
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Look for someone already on file as the name is typed. Debounced because it runs on
  // every keystroke and the answer only matters once there is enough to match on.
  useEffect(() => {
    if (link) return
    const q = name.trim()
    if (q.length < 2) { setMatches([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      api.whoIs({ phone, name: q })
        .then(r => { if (!cancelled) setMatches(r.matches || []) })
        .catch(() => {})
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [name, phone, link])

  async function save() {
    setSaving(true); setError('')
    try {
      const r = await api.saveContact({
        phone,
        name: link ? link.name : name.trim(),
        category: link ? link.kind : category,
        link: link ? { kind: link.kind, id: link.id } : null,
      })
      onSaved?.(r)
    } catch (e) {
      setError(e.message || 'Could not save that.')
      setSaving(false)
    }
  }

  const canSave = link ? true : Boolean(name.trim() && category)

  return (
    <div className="border-b border-gray-200 bg-blue-50/60 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold text-blue-900">
          Who is {fmtPhone(phone)}?
        </p>
        <button type="button" onClick={onClose}
          className="ml-auto text-xs text-blue-400 hover:text-blue-700">Not now</button>
      </div>

      {link ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-800">
            This number will be saved to <span className="font-semibold">{link.name}</span>
            <span className="text-gray-500"> ({link.kind})</span>.
          </span>
          <button type="button" onClick={() => setLink(null)}
            className="text-xs text-blue-600 hover:underline">Change</button>
        </div>
      ) : (
        <>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            placeholder="Their name"
            className="w-full rounded-lg border border-blue-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />

          {/* Somebody already on file comes first, so a second copy of them is never made. */}
          {matches.length > 0 && (
            <div className="mt-1.5">
              <p className="text-[11px] text-blue-900">Already on file — is it one of these?</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {matches.map(m => (
                  <button key={`${m.kind}-${m.id}`} type="button" onClick={() => setLink(m)}
                    className="rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-xs text-blue-800 hover:bg-blue-100">
                    {m.name} <span className="text-blue-400">· {m.kind}</span>
                    {m.phone ? <span className="text-gray-400"> · has a number</span> : null}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="mt-2 text-[11px] font-medium text-blue-900">What kind of contact?</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {CATEGORIES.map(c => (
              <button key={c.key} type="button" onClick={() => setCategory(c.key)}
                title={c.hint}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  category === c.key
                    ? 'bg-blue-600 text-white'
                    : 'border border-blue-200 text-blue-800 hover:bg-blue-100'}`}>
                {c.label}
              </button>
            ))}
          </div>
          {category && (
            <p className="mt-1 text-[11px] text-gray-500">
              {CATEGORIES.find(c => c.key === category)?.hint}.
            </p>
          )}
        </>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={!canSave || saving}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:bg-blue-700">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {!canSave && !link && (
          <span className="text-[11px] text-blue-700">
            {name.trim() ? 'Pick what kind of contact this is.' : 'Give them a name.'}
          </span>
        )}
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
    </div>
  )
}
