import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import CallButton from '../components/CallButton'

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

  const load = useCallback(async () => {
    try { setCalls(await api.voiceCalls()) }
    catch (e) { setError(e.message || 'Could not load calls.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    // A call finishing while this page is open should appear without a refresh.
    const id = setInterval(load, 20000)
    return () => clearInterval(id)
  }, [load])

  async function markHeard(c) {
    if (c.voicemail_heard_at) return
    setCalls((prev) => prev.map((x) => (x.id === c.id ? { ...x, voicemail_heard_at: new Date().toISOString() } : x)))
    api.markVoicemailHeard(c.id).catch(() => load())
  }

  const newMessages = calls.filter((c) => c.voicemail_url && !c.voicemail_heard_at).length

  return (
    <div className="mx-auto max-w-4xl px-3 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-gray-900">Calls</h1>
        {newMessages > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
            {newMessages} new {newMessages === 1 ? 'message' : 'messages'}
          </span>
        )}
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <p className="p-4 text-sm text-gray-400">Loading…</p>
        ) : calls.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">
            No calls yet. They’ll appear here as soon as the phone rings.
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
