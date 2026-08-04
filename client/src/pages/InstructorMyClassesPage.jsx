import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

// Read-only "my classes" week view for instructors (Phase 4 of instructor logins).
// Calls GET /api/schedule/my-sessions (Kip owns that endpoint, Phase 3).
// Never renders charge_amount; only the instructor's own instructor_pay.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseLocal(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function startOfWeek(d) {
  return addDays(d, -d.getDay()) // Sunday
}
function fmtTime(t) {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`
}
function money(v) {
  if (v == null || v === '') return ''
  return `$${Number(v).toFixed(0)}`
}
function shortDate(s) {
  const d = parseLocal(s)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function InstructorMyClassesPage() {
  const { user } = useAuth()
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()))
  const weekStart = startOfWeek(anchor)
  const weekEnd = addDays(weekStart, 6)

  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .getMySessions(ymd(weekStart), ymd(weekEnd))
      .then((rows) => setSessions(Array.isArray(rows) ? rows : rows?.sessions || []))
      .catch((e) => {
        setSessions([])
        setError(e.message || 'Could not load your classes.')
      })
      .finally(() => setLoading(false))
  }, [weekStart.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
  }, [load])

  const byDay = {}
  for (const s of sessions) {
    const key = s.session_date || s.date
    if (!byDay[key]) byDay[key] = []
    byDay[key].push(s)
  }
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i)
    const key = ymd(d)
    days.push({ key, label: shortDate(key), weekday: WEEKDAYS[d.getDay()], rows: byDay[key] || [] })
  }

  const rangeLabel = `${shortDate(ymd(weekStart))} – ${shortDate(ymd(weekEnd))}`

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">My classes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {user?.name ? `Hi ${user.name.split(' ')[0]}. ` : ''}
            Read-only view of your week.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mb-4 bg-white border border-gray-200 rounded-xl px-3 py-2">
        <button
          type="button"
          onClick={() => setAnchor(addDays(weekStart, -7))}
          className="text-sm px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-50"
        >
          Prev
        </button>
        <div className="text-center">
          <div className="text-sm font-medium text-gray-900">{rangeLabel}</div>
          <button
            type="button"
            onClick={() => setAnchor(startOfWeek(new Date()))}
            className="text-xs text-gray-400 hover:text-gray-700 mt-0.5"
          >
            This week
          </button>
        </div>
        <button
          type="button"
          onClick={() => setAnchor(addDays(weekStart, 7))}
          className="text-sm px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-50"
        >
          Next
        </button>
      </div>

      {loading && <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>}

      {!loading && error && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3 mb-4">
          {error}
          <div className="text-xs text-amber-700 mt-1">
            If this keeps happening, tell Sarede. The office side may still be setting up instructor access.
          </div>
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-sm text-gray-500">
          No classes scheduled this week.
        </div>
      )}

      {!loading &&
        days.map((day) =>
          day.rows.length === 0 ? null : (
            <section key={day.key} className="mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">
                {day.label}
              </h2>
              <ul className="space-y-2">
                {day.rows
                  .slice()
                  .sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')))
                  .map((s) => (
                    <li
                      key={s.id || `${s.session_date}-${s.start_time}-${s.client_name}`}
                      className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-sm font-semibold text-gray-900">
                          {fmtTime(s.start_time)}
                          {s.style ? (
                            <span className="font-normal text-gray-500"> · {s.style}</span>
                          ) : null}
                        </div>
                        {s.instructor_pay != null && s.instructor_pay !== '' ? (
                          <div className="text-sm font-medium text-gray-700 shrink-0">
                            {money(s.instructor_pay)}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-sm text-gray-800 mt-1">{s.client_name || 'Client'}</div>
                      {s.location ? (
                        <div className="text-xs text-gray-500 mt-0.5">{s.location}</div>
                      ) : null}
                      {s.special_instructions ? (
                        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 mt-2">
                          {s.special_instructions}
                        </div>
                      ) : null}
                      {s.status && s.status !== 'scheduled' ? (
                        <div className="text-xs text-gray-400 mt-1 capitalize">{String(s.status).replace('_', ' ')}</div>
                      ) : null}
                    </li>
                  ))}
              </ul>
            </section>
          )
        )}
    </div>
  )
}
