import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { RemindersProvider, useRemindersContext } from '../context/RemindersContext'

function Shell() {
  const { user, logout } = useAuth()
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
    { to: '/clients',     label: 'Clients' },
    { to: '/instructors', label: 'Instructors' },
    { to: '/reminders',  label: overdueCount > 0 ? `Reminders (${overdueCount})` : 'Reminders' },
    { to: '/tasks',      label: 'Tasks' },
    { to: '/recruiting', label: 'Recruiting' },
    { to: '/reference',  label: 'Reference' },
    ...(user?.role === 'admin' ? [{ to: '/settings', label: 'Settings' }] : []),
  ]

  const linkClass = ({ isActive }) =>
    `block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`

  const desktopLinkClass = ({ isActive }) =>
    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
      isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
    }`

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
        <div className="px-4 h-14 flex items-center justify-between max-w-7xl mx-auto">

          {/* Logo — always visible */}
          <span className="font-bold text-gray-900 text-base tracking-tight shrink-0">
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
            <span className="text-xs text-gray-500 flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-200 text-gray-700 font-bold text-xs">
                {user?.initials}
              </span>
              {user?.name}
            </span>
            <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-gray-700">
              Sign out
            </button>
          </div>

          {/* Hamburger — mobile only */}
          <button
            className="sm:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100"
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
