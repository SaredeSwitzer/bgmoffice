import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { isSaredeUser } from '../utils/saredeAccess'

// Sales sits beside My Tasks rather than in the top bar, because it is not really a
// separate place — it is a standing reminder to make the calls. Sarede put it here for
// that reason: the pipeline is only useful if she is nudged toward it while working
// through the day's list, not if it waits behind a tab she has to remember to open.
//
// Sarede-only, matching the route guard on the server (requireSaredeOnly). Everyone else
// sees no tabs at all — a single lonely "My Tasks" tab would just be clutter.

// A lead nobody has written on in this long is going cold. Not a hard rule, just the
// point at which it is worth a nudge.
const STALE_DAYS = 7

export default function MyTasksTabs() {
  const { user } = useAuth()
  const [needsCall, setNeedsCall] = useState(0)
  const mine = isSaredeUser(user)

  useEffect(() => {
    if (!mine) return
    api.getSalesLeads()
      .then((leads) => {
        const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000
        setNeedsCall(leads.filter((l) =>
          !l.last_note_at || new Date(l.last_note_at).getTime() < cutoff).length)
      })
      .catch(() => { /* a count failing must never break the tasks page */ })
  }, [mine])

  if (!mine) return null

  const cls = ({ isActive }) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      isActive ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`

  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-gray-100 p-1">
      <NavLink to="/my-tasks" className={cls}>My Tasks</NavLink>
      <NavLink to="/sales" className={cls}>
        Sales{needsCall > 0 ? ` (${needsCall})` : ''}
      </NavLink>
    </div>
  )
}
