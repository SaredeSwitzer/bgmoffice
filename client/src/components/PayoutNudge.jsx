import { useEffect, useState } from 'react'
import { api } from '../api/client'

// Shown Fri–Sun on the instructor's "My classes" page: totals up instructor_pay for the
// current real-world week (independent of whatever week they're paging through on the
// page it's mounted in) and offers a one-tap Venmo request to the business. Tracks only
// that they clicked "send" — a plain Venmo link can't confirm the request actually went
// through, so this is intent, not a receipt. See server/db/migrations/010_payout_requests.sql.

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function startOfWeek(d) {
  return addDays(d, -d.getDay()) // Sunday
}
function shortDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function buildVenmoLink({ handle, amount, instructorName, weekStartLabel, weekEndLabel }) {
  const note = `${instructorName || 'BGM instructor'} — pay for week of ${weekStartLabel}–${weekEndLabel}`
  const params = new URLSearchParams({
    txn: 'charge',
    amount: amount.toFixed(2),
    note,
    recipients: handle.replace(/^@/, ''),
  })
  return `https://venmo.com/?${params.toString()}`
}

export default function PayoutNudge({ instructorName }) {
  const day = new Date().getDay() // 0=Sun … 6=Sat
  const isNudgeWindow = day === 5 || day === 6 || day === 0 // Fri, Sat, Sun

  const [total, setTotal] = useState(null)
  const [venmoHandle, setVenmoHandle] = useState('')
  const [requested, setRequested] = useState(false)
  const [loading, setLoading] = useState(isNudgeWindow)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!isNudgeWindow) return
    const weekStart = startOfWeek(new Date())
    const weekEnd = addDays(weekStart, 6)

    Promise.all([
      api.getMySessions(ymd(weekStart), ymd(weekEnd)),
      api.getMyVenmoTarget(),
      api.getMyPayoutRequestStatus(ymd(weekStart)),
    ])
      .then(([sessions, venmo, status]) => {
        const rows = Array.isArray(sessions) ? sessions : sessions?.sessions || []
        const sum = rows
          .filter((s) => s.status !== 'cancelled')
          .reduce((acc, s) => acc + Number(s.instructor_pay || 0), 0)
        setTotal(sum)
        setVenmoHandle(venmo?.handle || '')
        setRequested(!!status?.requested)
      })
      .catch(() => {
        setTotal(null)
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!isNudgeWindow || loading || total === null || total <= 0) return null

  const weekStart = startOfWeek(new Date())
  const weekEnd = addDays(weekStart, 6)

  async function handleSend() {
    setSending(true)
    try {
      await api.recordPayoutRequest({ week_start: ymd(weekStart), amount: total })
      setRequested(true)
      window.open(
        buildVenmoLink({
          handle: venmoHandle,
          amount: total,
          instructorName,
          weekStartLabel: shortDate(ymd(weekStart)),
          weekEndLabel: shortDate(ymd(weekEnd)),
        }),
        '_blank'
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <div className="text-sm font-semibold text-blue-900">You earned ${total.toFixed(0)} this week</div>
        <div className="text-xs text-blue-700">
          {requested ? 'Payout request sent ✓' : 'Send your Venmo request now so you get paid promptly.'}
        </div>
      </div>
      {venmoHandle && (
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
        >
          {sending ? 'Opening Venmo…' : requested ? 'Send again' : 'Send Payout Request'}
        </button>
      )}
    </div>
  )
}
