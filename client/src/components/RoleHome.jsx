import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// After login / on "/", send instructors to their week view and staff to the dashboard.
export default function RoleHome() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'instructor') return <Navigate to="/my-classes" replace />
  return <Navigate to="/dashboard" replace />
}
