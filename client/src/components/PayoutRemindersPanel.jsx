import { useEffect, useState } from 'react'
import { api } from '../api/client'

// "Send us your payment request" — the nudge to instructors who taught last week and
// haven't been paid.
//
// Preview-first, for the same reason the class reminders are: this one talks about money,
// and a wrong figure sent to eight instructors is a wrong figure you then have to chase
// down eight times. Nothing leaves until she has read the list, and she can drop anyone
// or reword a message before it goes.
//
// Built on Sarede's own payment record rather than on whether the instructor tapped the
// Venmo button. The question is "who have I not paid?", and someone paid in cash who
// never touched the button is not someone to chase.

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`
}

function prettyWeek(w) {
  if (!w?.start) return ''
  const d = (s) => {
    const [y, m, day] = s.split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return `${d(w.start)} – ${d(w.end)}`
}

export default function PayoutRemindersPanel({ onClose, onSent }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [excluded, setExcluded] = useState(() => new Set())
  const [edits, setEdits] = useState({})
  const [openId, setOpenId] = useState(null)
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState(null)

  useEffect(() => {
    api.getPayoutReminders()
      .then(setData)
      .catch((e) => setError(e.message || 'Could not work out who is still owed.'))
      .finally(() => setLoading(false))
  }, [])

  const people = data?.people || []
  // Somebody with neither a mobile nor an email cannot be reached at all; they are listed
  // so she knows to chase them another way, but they are never counted as "sending".
  const reachable = people.filter((p) => p.channel !== 'none')
  const unreachable = people.filter((p) => p.channel === 'none')
  // Anyone with no pay recorded starts unticked: the fix there is the rate, not a text.
  const toSend = reachable.filter((p) => !excluded.has(p.instructor_id) && !p.nothing_owed)
  const nothingOwed = people.filter((p) => p.nothing_owed)
  const owed = toSend.reduce((sum, p) => sum + p.amount, 0)

  function toggle(id) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function send() {
    setSending(true); setError('')
    try {
      const messages = toSend.map((p) => ({
        to: p.to,
        name: p.name,
        channel: p.channel,
        subject: p.subject,
        body: edits[p.instructor_id] ?? p.body,
      }))
      const r = await api.sendPreparedMessages(messages)
      setResults(r)
      onSent?.()
    } catch (e) {
      setError(e.message || 'Could not send those.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <span className="font-medium text-gray-900">Ask for payment requests</span>
          {data && <span className="ml-2 text-sm text-gray-500">week of {prettyWeek(data.week)}</span>}
        </div>
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Close</button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-gray-400">Working out who is still owed…</p>
        ) : error && !results ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        ) : results ? (
          <>
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              Sent {results.sent}{results.failed ? ` · ${results.failed} failed` : ''}.
            </div>
            <ul className="space-y-1 text-sm">
              {results.results.map((r, i) => (
                <li key={i} className={r.ok ? 'text-gray-600' : 'text-red-600'}>
                  {r.ok ? '✓' : '✗'} {r.name || r.to}
                  {r.error ? ` — ${r.error}` : ''}
                </li>
              ))}
            </ul>
          </>
        ) : people.length === 0 ? (
          <p className="rounded-lg bg-green-50 px-3 py-3 text-sm text-green-800">
            Everyone who taught that week is marked paid. Nothing to chase.
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-500">
              {reachable.length} {reachable.length === 1 ? 'instructor' : 'instructors'} taught that
              week and {reachable.length === 1 ? 'is' : 'are'} not marked paid. Untick anyone you
              don’t want to chase, or click a name to reword their message.
            </p>

            {people.map((p) => {
              const off = excluded.has(p.instructor_id) || p.channel === 'none' || p.nothing_owed
              return (
                <div key={p.instructor_id}
                     className={`rounded-lg border px-3 py-2 ${off ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!off}
                      disabled={p.channel === 'none' || p.nothing_owed}
                      onChange={() => toggle(p.instructor_id)}
                    />
                    <button
                      onClick={() => setOpenId(openId === p.instructor_id ? null : p.instructor_id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="font-medium text-gray-900">{p.name}</span>
                      <span className="ml-2 text-xs text-gray-500">
                        {p.classes} {p.classes === 1 ? 'class' : 'classes'}
                        {p.nothing_owed ? ' · nothing owed' : ` · ${money(p.amount)}`}
                        {p.channel === 'email' ? ' · by email' : ''}
                        {p.channel === 'none' ? ' · no phone or email on file' : ''}
                      </span>
                    </button>
                  </div>

                  {openId === p.instructor_id && (
                    <textarea
                      value={edits[p.instructor_id] ?? p.body}
                      onChange={(e) => setEdits({ ...edits, [p.instructor_id]: e.target.value })}
                      rows={4}
                      className="mt-2 w-full resize-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  )}
                </div>
              )
            })}

            {nothingOwed.length > 0 && (
              <p className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">
                {nothingOwed.length === 1
                  ? `${nothingOwed[0].name} taught that week with nothing owed for it, so there's nothing to ask for.`
                  : `${nothingOwed.length} of them taught that week with nothing owed, so there's nothing to ask them for.`}
                {' '}Left out of the chase. If that's not right, the pay is set on the class.
              </p>
            )}

            {unreachable.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {unreachable.length} of them {unreachable.length === 1 ? 'has' : 'have'} no phone or
                email on file, so {unreachable.length === 1 ? 'they' : 'they'} can’t be reached from
                here — worth adding one to their profile.
              </p>
            )}
          </>
        )}
      </div>

      {!results && people.length > 0 && (
        <footer className="border-t border-gray-200 p-3">
          <button
            onClick={send}
            disabled={sending || toSend.length === 0}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {sending ? 'Sending…' : `Ask ${toSend.length} ${toSend.length === 1 ? 'instructor' : 'instructors'} · ${money(owed)} owed`}
          </button>
        </footer>
      )}
    </section>
  )
}
