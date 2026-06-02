import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function NavShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <span className="font-bold text-gray-900 text-lg tracking-tight">BGM Office</span>
            <nav className="flex gap-1">
              {[
                { to: '/dashboard', label: 'Dashboard' },
                { to: '/my-tasks',  label: 'My Tasks',  bold: true },
                { to: '/clients',   label: 'Clients' },
                { to: '/instructors', label: 'Instructors' },
              ].map(({ to, label, bold }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded text-sm transition-colors ${
                      isActive
                        ? bold ? 'bg-gray-900 text-white font-semibold' : 'bg-gray-100 text-gray-900 font-medium'
                        : bold ? 'text-gray-700 font-semibold hover:bg-gray-100' : 'text-gray-500 font-medium hover:text-gray-800 hover:bg-gray-50'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
              {user?.role === 'admin' && (
                <NavLink
                  to="/settings"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                    }`
                  }
                >
                  Settings
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-200 text-gray-700 font-bold text-xs mr-1.5">
                {user?.initials}
              </span>
              {user?.name}
            </span>
            <button
              onClick={handleLogout}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
