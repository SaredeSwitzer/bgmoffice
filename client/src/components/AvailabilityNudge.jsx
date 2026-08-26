import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

// Shown on the instructor's "My classes" page alongside PayoutNudge — prompts them to
// confirm their listed availability is still accurate. Three independent triggers, any
// one of which is enough to show it:
//   1. Same Fri/Sat/Sun window as the payout nudge, once per week, until confirmed.
//   2. Their very first login ever (staleLogin — see server/routes/auth.js recordLogin).
//   3. They haven't logged in for 7+ days (staleLogin covers this too — same flag).
// staleLogin comes from AuthContext, set once from the login response and not
// re-derived on refresh, so this only fires right after an actual sign-in.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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

export default function AvailabilityNudge({ instructorId, staleLogin }) {
  const day = new Date().getDay()
  const isWeeklyWindow = day === 5 || day === 6 || day === 0 // Fri, Sat, Sun
  const shouldCheck = isWeeklyWindow || staleLogin

  const [slots, setSlots] = useState([])
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(shouldCheck)
  const [confirming, setConfirming] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!shouldCheck || !instructorId) return
    const weekStart = ymd(startOfWeek(new Date()))
    Promise.all([
      api.getMyAvailability(instructorId),
      api.getMyAvailabilityCheckStatus(instructorId, weekStart),
    ])
      .then(([avail, status]) => {
        setSlots(Array.isArray(avail) ? avail : [])
        setConfirmed(!!status?.confirmed)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instructorId])

  if (!shouldCheck || loading || confirmed || dismissed) return null

  async function handleConfirm() {
    setConfirming(true)
    try {
      await api.confirmMyAvailability(instructorId, ymd(startOfWeek(new Date())))
      setConfirmed(true)
    } finally {
      setConfirming(false)
    }
  }

  const byDay = {}
  for (const s of slots) {
    if (!byDay[s.day_of_week]) byDay[s.day_of_week] = []
    byDay[s.day_of_week].push(s)
  }
  const daysWithSlots = DAYS.filter(d => byDay[d])

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-amber-900">
            {staleLogin ? 'Welcome back! Is your availability still accurate?' : 'Quick check: is your availability still accurate?'}
          </div>
          <div className="text-xs text-amber-700 mt-0.5">
            Let us know if anything's changed so we can schedule you right.
          </div>
        </div>
        <button type="button" onClick={() => setDismissed(true)}
          className="text-amber-400 hover:text-amber-700 text-sm leading-none flex-shrink-0">✕</button>
      </div>

      <div className="mt-2 mb-3">
        {daysWithSlots.length === 0 ? (
          <p className="text-xs text-amber-800 italic">Nothing on file yet.</p>
        ) : (
          <ul className="text-xs text-amber-900 space-y-0.5">
            {daysWithSlots.map(d => (
              <li key={d}>
                <span className="font-semibold">{d}:</span>{' '}
                {byDay[d].map(s => s.time_slot || 'anytime').join(', ')}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={handleConfirm} disabled={confirming}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
          {confirming ? 'Saving…' : 'Yep, still accurate'}
        </button>
        <Link to="/my-profile#availability"
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100">
          Update my availability
        </Link>
      </div>
    </div>
  )
}
