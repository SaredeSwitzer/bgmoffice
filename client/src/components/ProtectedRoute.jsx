import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isSaredeUser } from '../utils/saredeAccess'

export default function ProtectedRoute({
  children,
  adminOnly = false,
  staffOnly = false,
  instructorOnly = false,
  saredeOnly = false,
}) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  // Instructors never enter the staff shell, and staff never land in the instructor one.
  // This is convenience routing only — the real enforcement is the server's deny-by-default
  // guard, since anything here can be bypassed by editing the URL.
  if (staffOnly && user.role === 'instructor') return <Navigate to="/my-classes" replace />
  if (instructorOnly && user.role !== 'instructor') return <Navigate to="/" replace />

  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />

  // Money screens are Sarede's alone — not Claire, Maria, or Erica. Sending them home
  // rather than showing a locked page; the server refuses the data either way.
  if (saredeOnly && !isSaredeUser(user)) return <Navigate to="/" replace />

  return children
}
