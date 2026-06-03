import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import NavShell from './components/NavShell'
import LoginPage from './pages/LoginPage'
import MyTasksPage from './pages/MyTasksPage'
import DashboardPage from './pages/DashboardPage'
import CaseDetailPage from './pages/CaseDetailPage'
import ClientsPage from './pages/ClientsPage'
import ClientProfilePage from './pages/ClientProfilePage'
import InstructorsPage from './pages/InstructorsPage'
import InstructorProfilePage from './pages/InstructorProfilePage'
import SettingsPage from './pages/SettingsPage'
import RemindersPage from './pages/RemindersPage'
import ReferencePage from './pages/ReferencePage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <NavShell />
              </ProtectedRoute>
            }
          >
            {/* Default landing → My Tasks */}
            <Route index element={<Navigate to="/my-tasks" replace />} />
            <Route path="my-tasks" element={<MyTasksPage />} />
            <Route path="reminders" element={<RemindersPage />} />
            <Route path="reference" element={<ReferencePage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="cases/:id" element={<CaseDetailPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="clients/:id" element={<ClientProfilePage />} />
            <Route path="instructors" element={<InstructorsPage />} />
            <Route path="instructors/:id" element={<InstructorProfilePage />} />
            <Route
              path="settings"
              element={
                <ProtectedRoute adminOnly>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/my-tasks" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
