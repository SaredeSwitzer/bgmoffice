import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import CallButton from '../components/CallButton'
import PhoneTabs from '../components/PhoneTabs'

// Every call on the BGM line — in, out, missed, and any message left.
//
// Reads like a phone's recent-calls list rather than a table of records: who it was, which
// way it went, and how long. A missed call and a call nobody could take are the two things
// worth spotting at a glance, so those are the ones given colour.

function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '').slice(-10)
  if (d.length !== 10) return p || 'Unknown'
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

function fmtWhen(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function fmtLength(secs) {
  if (!secs) return ''
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m ? `${m}m ${s}s` : `${s}s`
}

// What actually happened, in the words someone would use about a phone call.
function describe(c) {
  if (c.status === 'voicemail') return { label: 'Left a message', tone: 'text-amber-700' }
  if (c.status === 'missed')    return { label: 'Missed',         tone: 'text-red-600' }
  if (c.status === 'completed' || c.status === 'answered') {
    return { label: c.direction === 'inbound' ? 'Answered' : 'Called', tone: 'text-gray-500' }
  }
  if (c.status === 'ringing') return { label: 'Ringing…', tone: 'text-gray-400' }
  return { label: c.status || '', tone: 'text-gray-500' }
}

export default function CallsPage() {
  const [calls, setCalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [dialOpen, setDialOpen] = useState(false)

  const load = useCallback(async (q) => {
    try {
      const term = (q ?? '').trim()
      setCalls(term.length >= 2 ? await api.voiceCallSearch(term) : await api.voiceCalls())
    }
    catch (e) { setError(e.message || 'Could not load calls.') }
    finally { setLoading(false) }
  }, [])

  // Search as she types, a beat behind, the same as the text inbox.
  useEffect(() => {
    const id = setTimeout(() => load(query), 250)
    return () => clearTimeout(id)
  }, [query, load])

  useEffect(() => {
    // A call finishing while this page is open should appear without a refresh — but not
    // while a search is on screen, or the results would be replaced by the full list.
    const id = setInterval(() => { if (!query.trim()) load('') }, 20000)
    return () => clearInterval(id)
  }, [load, query])

  async function markHeard(c) {
    if (c.voicemail_heard_at) return
    setCalls((prev) => prev.map((x) => (x.id === c.id ? { ...x, voicemail_heard_at: new Date().toISOString() } : x)))
    api.markVoicemailHeard(c.id).catch(() => load())
  }

  const newMessages = calls.filter((c) => c.voicemail_url && !c.voicemail_heard_at).length

  return (
    <div className="mx-auto max-w-4xl px-3 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div><PhoneTabs voicemailCount={newMessages} /></div>
        {newMessages > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
            {newMessages} new {newMessages === 1 ? 'message' : 'messages'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search calls"
              className="w-48 rounded-lg border border-gray-300 bg-gray-50 py-1.5 pl-8 pr-8 text-sm focus:border-blue-500 focus:bg-white focus:outline-none sm:w-64"
            />
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>
            )}
          </div>
          <button
            onClick={() => setDialOpen((o) => !o)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            New call
          </button>
        </div>
      </div>

      {dialOpen && <Dialer onClose={() => setDialOpen(false)} />}

      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <p className="p-4 text-sm text-gray-400">Loading…</p>
        ) : calls.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">
            {query.trim()
              ? `Nothing found for “${query.trim()}”.`
              : 'No calls yet. They’ll appear here as soon as the phone rings.'}
          </p>
        ) : (
          calls.map((c) => {
            const d = describe(c)
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
                <span className={`shrink-0 text-lg ${c.direction === 'inbound' ? 'text-blue-500' : 'text-gray-400'}`}
                      title={c.direction === 'inbound' ? 'Incoming' : 'Outgoing'}>
                  {c.direction === 'inbound' ? '↙' : '↗'}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-gray-900">
                    {c.person_name || fmtPhone(c.phone)}
                  </div>
                  <div className="text-xs text-gray-400">
                    {fmtPhone(c.phone)}
                    {c.person_kind ? ` · ${c.person_kind}` : ''}
                    {c.answered_by ? ` · taken by ${c.answered_by}` : ''}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className={`text-sm ${d.tone}`}>{d.label}</div>
                  <div className="text-xs text-gray-400">
                    {fmtWhen(c.started_at)}{c.duration_seconds ? ` · ${fmtLength(c.duration_seconds)}` : ''}
                  </div>
                </div>

                <CallButton phone={c.phone} name={c.person_name} className="shrink-0" />

                <Transcript text={c.transcript} kind={c.transcript_kind} />

                {c.voicemail_url && (
                  <div className="w-full">
                    <audio
                      controls
                      preload="none"
                      src={c.voicemail_url}
                      onPlay={() => markHeard(c)}
                      className="mt-1 h-9 w-full"
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}


// What was said, short by default.
//
// A transcript is often a paragraph, and a list of calls where every row is a paragraph
// is a list you stop reading. So: one line, and the rest on a click. The preview is the
// point — it answers "do I need to listen to this?" without playing anything.
function Transcript({ text, kind }) {
  const [open, setOpen] = useState(false)
  if (!String(text || '').trim()) return null

  const label = kind === 'voicemail' ? 'Message' : 'Call'
  const long = text.length > 110

  return (
    <div className="mt-1 w-full rounded-lg bg-gray-50 px-3 py-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left"
        title={long ? (open ? 'Show less' : 'Read the whole thing') : undefined}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {label}
        </span>
        <span className={`ml-2 text-sm text-gray-700 ${open ? '' : 'line-clamp-1'}`}>
          “{text}”
        </span>
        {long && (
          <span className="ml-1 text-xs font-medium text-blue-600">
            {open ? 'less' : 'more'}
          </span>
        )}
      </button>
    </div>
  )
}

// ── Calling a number we don't have on file ───────────────────────────────────────────
// A new client rings, or somebody leaves a number on a voicemail, and there is no contact
// to click. Type the number and call it. Known contacts are offered too, so this doubles
// as "call anyone" rather than being a second-class path for strangers only.
function Dialer({ onClose }) {
  const [value, setValue] = useState('')
  const [contacts, setContacts] = useState([])

  useEffect(() => {
    // The same list the text composer uses — everyone with a phone on file.
    api.smsContacts().then(setContacts).catch(() => setContacts([]))
  }, [])

  // Accepts a raw typed number, or "Name — (xxx) xxx-xxxx" picked from the suggestions.
  const match = contacts.find((c) => `${c.name} — ${fmtPhone(c.phone)}` === value.trim())
  const phone = match ? match.phone : value.trim()
  const digits = phone.replace(/\D/g, '')
  const usable = digits.length >= 10

  return (
    <div className="mb-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">New call</span>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">×</button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Number, or a name already on file
          </label>
          <input
            list="dial-contacts"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="(917) 555-0100"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <datalist id="dial-contacts">
            {contacts.map((c) => (
              <option key={`${c.kind}-${c.id}`} value={`${c.name} — ${fmtPhone(c.phone)}`} />
            ))}
          </datalist>
        </div>

        {/* The same button used everywhere else, so a call placed from here behaves
            identically — through the computer if the phone is on, otherwise by ringing
            your own phone first.
            In a list, CallButton hides itself when there is no number to call, which is
            right there and wrong here: an empty box beside a field you have not filled in
            yet reads as broken. So a dead button stands in until the number is usable. */}
        {usable ? (
          <CallButton phone={phone} name={match?.name} className="shrink-0 pb-0.5" />
        ) : (
          <button disabled
            className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-400">
            📞 Call
          </button>
        )}
      </div>

      {value.trim() && !usable && (
        <p className="mt-2 text-xs text-gray-500">That needs to be a full 10-digit number.</p>
      )}
      <p className="mt-2 text-xs text-gray-400">
        They’ll see the BGM number, never your own.
      </p>
    </div>
  )
}
