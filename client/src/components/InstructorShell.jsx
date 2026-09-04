import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import { useAuth } from '../context/AuthContext'

// Minimal shell for instructor accounts: no admin nav, no Amber chat, no staff tools.
// Paired with InstructorMyClassesPage. Server-side deny-by-default (Kip Phases 2–3) is still
// required before any real instructor login is created.

export default function InstructorShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
        <div className="px-4 h-14 flex items-center justify-between max-w-2xl mx-auto w-full">
          <span className="font-bold text-gray-900 text-base tracking-tight">BGM Office</span>
          <nav className="flex items-center gap-2">
            <NavLink
              to="/my-classes"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-sm font-medium ${
                  isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-800'
                }`
              }
            >
              My classes
            </NavLink>
            <NavLink
              to="/my-profile"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-sm font-medium ${
                  isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-800'
                }`
              }
            >
              My Profile
            </NavLink>
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-gray-500 flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-200 text-gray-700 font-bold text-xs">
                {user?.initials || '?'}
              </span>
              <span className="hidden sm:inline">{user?.name}</span>
            </span>
            <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-gray-700">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-2xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <ErrorBoundary key={location.pathname} what="this page">
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
