import { useEffect, useState } from 'react'
import { api } from '../api/client'

// "Log in / set your availability" — the nudge to instructors who aren't using BGM Office.
//
// The in-app AvailabilityNudge only reaches people who sign in; this one goes out by text
// from the office side. Preview-first like the class and payout reminders: she reads the
// list, unticks anyone, rewords anything, then sends.
//
// Three groups, each with its own wording (server/lib/instructorNudges.js):
//   never logged in · no availability listed · availability not touched in a while
// Anyone texted about this in the last 10 days starts unticked so a slow responder
// doesn't get the same ask twice in a week.

const KIND = {
  never_logged_in: { label: 'Never logged in', tone: 'bg-red-50 text-red-700' },
  no_availability: { label: 'No availability set', tone: 'bg-amber-50 text-amber-800' },
  stale:           { label: 'Availability not updated', tone: 'bg-blue-50 text-blue-700' },
  no_login:        { label: 'No login account', tone: 'bg-gray-100 text-gray-600' },
}

function ago(iso) {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? 'a month ago' : `${months} months ago`
}

export default function InstructorNudgesPanel({ onClose, onSent }) {
  const [scope, setScope] = useState('upcoming')
  const [staleDays, setStaleDays] = useState(28)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Ticked state is explicit per person (not "everyone minus excluded") because the
  // default differs: recently-nudged people start off.
  const [ticked, setTicked] = useState({})
  const [edits, setEdits] = useState({})
  const [openId, setOpenId] = useState(null)
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState(null)

  useEffect(() => {
    setLoading(true); setError('')
    api.getInstructorNudges({ scope, stale_days: staleDays })
      .then((d) => {
        setData(d)
        const t = {}
        for (const p of d.people) t[p.instructor_id] = p.channel !== 'none' && !p.recently_nudged
        setTicked(t)
        setEdits({})
      })
      .catch((e) => setError(e.message || 'Could not work out who needs a nudge.'))
      .finally(() => setLoading(false))
  }, [scope, staleDays])

  const people = data?.people || []
  const toSend = people.filter((p) => ticked[p.instructor_id] && p.channel !== 'none')
  const unreachable = people.filter((p) => p.channel === 'none' && p.kind !== 'no_login')
  const noLogin = people.filter((p) => p.kind === 'no_login')
  const counts = people.reduce((m, p) => ({ ...m, [p.kind]: (m[p.kind] || 0) + 1 }), {})

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
      <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <span className="font-medium text-gray-900">Nudge instructors to log in / set availability</span>
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Close</button>
      </header>

      {!results && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-100 px-4 py-2 text-sm text-gray-600">
          <label className="flex items-center gap-1.5">
            <span>Who:</span>
            <select value={scope} onChange={(e) => setScope(e.target.value)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm">
              <option value="upcoming">Teaching in the next 4 weeks</option>
              <option value="all">Everyone with a login</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span>Availability counts as stale after</span>
            <select value={staleDays} onChange={(e) => setStaleDays(Number(e.target.value))}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm">
              <option value={14}>2 weeks</option>
              <option value={28}>4 weeks</option>
              <option value={56}>8 weeks</option>
              <option value={90}>3 months</option>
            </select>
          </label>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-gray-400">Checking who's logged in and set their availability…</p>
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
            Everyone here has logged in and their availability is current. Nothing to send.
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-500">
              {Object.entries(counts).map(([k, n]) => `${n} ${KIND[k].label.toLowerCase()}`).join(' · ')}
              {data.up_to_date ? ` · ${data.up_to_date} up to date (not listed)` : ''}.
              {' '}Untick anyone you don’t want to chase, or click a name to reword their message.
            </p>

            {people.map((p) => {
              const on = !!ticked[p.instructor_id]
              const k = KIND[p.kind] || KIND.no_login
              return (
                <div key={p.instructor_id}
                     className={`rounded-lg border px-3 py-2 ${on ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-60'}`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={p.channel === 'none'}
                      onChange={() => setTicked({ ...ticked, [p.instructor_id]: !on })}
                    />
                    <button
                      onClick={() => p.channel !== 'none' && setOpenId(openId === p.instructor_id ? null : p.instructor_id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="font-medium text-gray-900">{p.name}</span>
                      <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${k.tone}`}>{k.label}</span>
                      <span className="ml-2 text-xs text-gray-500">
                        {p.kind === 'stale' && p.last_availability_at ? `last updated ${ago(p.last_availability_at)}` : ''}
                        {p.kind === 'no_availability' && p.last_login_at ? `logged in ${ago(p.last_login_at)}` : ''}
                        {scope === 'all' && p.upcoming_classes > 0 ? ` · ${p.upcoming_classes} upcoming` : ''}
                        {p.last_nudged_at ? ` · nudged ${ago(p.last_nudged_at)}` : ''}
                        {p.channel === 'email' ? ' · by email' : ''}
                        {p.channel === 'none' && p.kind !== 'no_login' ? ' · no phone or email on file' : ''}
                      </span>
                    </button>
                  </div>

                  {openId === p.instructor_id && (
                    <textarea
                      value={edits[p.instructor_id] ?? p.body}
                      onChange={(e) => setEdits({ ...edits, [p.instructor_id]: e.target.value })}
                      rows={5}
                      className="mt-2 w-full resize-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  )}
                </div>
              )
            })}

            {noLogin.length > 0 && (
              <p className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">
                {noLogin.map((p) => p.name).join(', ')} {noLogin.length === 1 ? 'has' : 'have'} no login
                account, so there's nothing to send them to. Add one under Settings → Users (role
                Instructor) and they'll show up here next time.
              </p>
            )}

            {unreachable.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {unreachable.length} of them {unreachable.length === 1 ? 'has' : 'have'} no phone or
                email on file, so they can’t be reached from here — worth adding one to their profile.
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
            {sending ? 'Sending…' : `Nudge ${toSend.length} ${toSend.length === 1 ? 'instructor' : 'instructors'}`}
          </button>
        </footer>
      )}
    </section>
  )
}
