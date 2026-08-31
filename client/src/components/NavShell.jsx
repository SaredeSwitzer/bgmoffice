import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import PasskeyPrompt from './PasskeyPrompt'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { RemindersProvider, useRemindersContext } from '../context/RemindersContext'
import AmberChat from './AmberChat'
import { isSaredeUser } from '../utils/saredeAccess'
import { loadDirectory } from '../utils/directory'

function Shell() {
  const { user, logout } = useAuth()
  // Fetched once behind the whole signed-in app: note text renders client/instructor
  // links from it (utils/mentions.jsx), and every screen showing a note would otherwise
  // need its own copy.
  useEffect(() => { if (user) loadDirectory() }, [user])
  const { overdueCount } = useRemindersContext()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  function handleLogout() {
    logout()
    navigate('/login')
    setOpen(false)
  }

  const navLinks = [
    { to: '/dashboard',   label: 'Dashboard' },
    { to: '/my-tasks',    label: 'My Tasks' },
    // High in the order on purpose — chasing replies is most of the day's work, so it
    // sits with the other "what do I do now" screens rather than down with reference.
    { to: '/waiting',     label: 'Waiting On' },
    { to: '/clients',     label: 'Clients' },
    { to: '/instructors', label: 'Instructors' },
    { to: '/schedule',   label: 'Schedule' },
    { to: '/billing',    label: 'Billing' },
    ...(isSaredeUser(user) ? [{ to: '/sales', label: 'Sales' }] : []),
    { to: '/reminders',  label: overdueCount > 0 ? `Reminders (${overdueCount})` : 'Reminders' },
    { to: '/sms',        label: 'Texts' },
    { to: '/recruiting', label: 'Recruiting' },
    { to: '/reference',  label: 'Reference' },
    ...(user?.role === 'admin' ? [{ to: '/settings', label: 'Settings' }] : []),
  ]

  // The mobile dropdown hangs below the bar on a white panel, so it keeps the
  // light treatment; only the bar itself is blue.
  const linkClass = ({ isActive }) =>
    `block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`

  // On the blue bar the selected tab is a white chip — the one bright thing up
  // there, so where you are reads at a glance.
  const desktopLinkClass = ({ isActive }) =>
    `px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors ${
      isActive
        ? 'bg-white text-blue-700 font-semibold shadow-sm'
        : 'text-blue-50 hover:text-white hover:bg-white/15'
    }`

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <PasskeyPrompt />

      {/* Header */}
      <header className="bg-brand-bar border-b border-brand-bar-edge shadow-sm sticky top-0 z-40">
        <div className="px-4 h-14 flex items-center justify-between max-w-7xl mx-auto">

          {/* Logo — always visible */}
          <span className="font-display font-bold text-white text-base tracking-tight shrink-0 flex items-center gap-2">
            <img src="/logo-mark.svg" alt="" aria-hidden="true" className="w-[18px] h-[18px]" />
            BGM Office
          </span>

          {/* Desktop nav — hidden on mobile */}
          <nav className="hidden sm:flex items-center gap-1 mx-4">
            {navLinks.map(({ to, label }) => (
              <NavLink key={to} to={to} className={desktopLinkClass}>{label}</NavLink>
            ))}
          </nav>

          {/* Desktop user info — hidden on mobile */}
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <span className="text-xs text-blue-50 flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-white font-bold text-xs">
                {user?.initials}
              </span>
              {user?.name}
            </span>
            <button onClick={handleLogout} className="text-xs text-blue-100 hover:text-white">
              Sign out
            </button>
          </div>

          {/* Hamburger — mobile only */}
          <button
            className="sm:hidden p-2 rounded-lg text-white hover:bg-white/15"
            onClick={() => setOpen(o => !o)}
            aria-label="Toggle menu"
          >
            {open ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile dropdown — all nav links + sign out */}
        {open && (
          <div className="sm:hidden border-t border-gray-100 bg-white px-3 py-2 space-y-1">
            {navLinks.map(({ to, label }) => (
              <NavLink key={to} to={to} className={linkClass} onClick={() => setOpen(false)}>
                {label}
              </NavLink>
            ))}
            <div className="border-t border-gray-100 mt-2 pt-2 flex items-center justify-between px-4 py-2">
              <span className="text-xs text-gray-500 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-200 text-gray-700 font-bold text-xs">
                  {user?.initials}
                </span>
                {user?.name}
              </span>
              <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-700 font-medium">
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-6">
        <Outlet />
      </main>

      {/* Amber floating chat */}
      <AmberChat />
    </div>
  )
}

export default function NavShell() {
  return (
    <RemindersProvider>
      <Shell />
    </RemindersProvider>
  )
}
