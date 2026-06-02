import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import NavShell from './components/NavShell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import CaseDetailPage from './pages/CaseDetailPage'
import ClientsPage from './pages/ClientsPage'
import ClientProfilePage from './pages/ClientProfilePage'
import InstructorsPage from './pages/InstructorsPage'
import InstructorProfilePage from './pages/InstructorProfilePage'
import SettingsPage from './pages/SettingsPage'

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
            <Route index element={<DashboardPage />} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
