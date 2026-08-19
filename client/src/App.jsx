import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import NavShell from './components/NavShell'
import InstructorShell from './components/InstructorShell'
import RoleHome from './components/RoleHome'
import InstructorMyClassesPage from './pages/InstructorMyClassesPage'
import InstructorMyProfilePage from './pages/InstructorMyProfilePage'
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
import RecruitingPage from './pages/RecruitingPage'
import TasksPage from './pages/TasksPage'
import InvoicesPage from './pages/InvoicesPage'
import InvoiceDetailPage from './pages/InvoiceDetailPage'
import PaymentPage from './pages/PaymentPage'
import SaveCardPage from './pages/SaveCardPage'
import SignContractPage from './pages/SignContractPage'
import OrgContractSignPage from './pages/OrgContractSignPage'
import PrivacyPage from './pages/PrivacyPage'
import SchedulePage from './pages/SchedulePage'
import BillingPage from './pages/BillingPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Public payment page — no auth */}
          <Route path="/pay/:token" element={<PaymentPage />} />
          <Route path="/save-card/:token" element={<SaveCardPage />} />
          <Route path="/sign-contract/:token" element={<SignContractPage />} />
          <Route path="/sign-org-contract/:token" element={<OrgContractSignPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          {/* Instructor accounts: their own week only, in a shell with no staff nav. */}
          <Route
            element={
              <ProtectedRoute instructorOnly>
                <InstructorShell />
              </ProtectedRoute>
            }
          >
            <Route path="my-classes" element={<InstructorMyClassesPage />} />
            <Route path="my-profile" element={<InstructorMyProfilePage />} />
          </Route>

          <Route
            element={
              <ProtectedRoute staffOnly>
                <NavShell />
              </ProtectedRoute>
            }
          >
            {/* Default landing depends on role: instructors → my-classes, staff → dashboard */}
            <Route index element={<RoleHome />} />
            <Route path="my-tasks" element={<MyTasksPage />} />
            <Route path="reminders" element={<RemindersPage />} />
            <Route path="reference" element={<ReferencePage />} />
            <Route path="recruiting" element={<RecruitingPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="cases/:id" element={<CaseDetailPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="clients/:id" element={<ClientProfilePage />} />
            <Route path="instructors" element={<InstructorsPage />} />
            <Route path="instructors/:id" element={<InstructorProfilePage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route
              path="settings"
              element={
                <ProtectedRoute adminOnly>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
          </Route>
          {/* Unknown path → "/" so RoleHome decides where this account belongs. Sending it
              straight to /dashboard would bounce an instructor through the staff shell. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
