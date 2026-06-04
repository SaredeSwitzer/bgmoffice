const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/api'
const API_ROOT = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export function uploadsUrl(filename) {
  return filename ? `${API_ROOT}/uploads/${filename}` : null
}

function getToken() {
  return localStorage.getItem('bgm_token')
}

async function request(path, options = {}) {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const api = {
  myTasks: () => request('/dashboard/my-tasks'),

  // Standalone Tasks
  getTasks: (status) => request(`/tasks${status ? `?status=${status}` : ''}`),
  createTask: (data) => request('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id, data) => request(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),

  // Auth
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/auth/me'),

  // Dashboard
  dashboard: () => request('/dashboard'),

  // Clients
  getClients: (q) => request(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) => request('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) => request(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteClient: (id) => request(`/clients/${id}`, { method: 'DELETE' }),
  addPref: (clientId, data) =>
    request(`/clients/${clientId}/prefs`, { method: 'POST', body: JSON.stringify(data) }),
  deletePref: (clientId, prefId) =>
    request(`/clients/${clientId}/prefs/${prefId}`, { method: 'DELETE' }),

  // Instructors
  getInstructors: (q) => request(`/instructors${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getInstructor: (id) => request(`/instructors/${id}`),
  createInstructor: (data) => request('/instructors', { method: 'POST', body: JSON.stringify(data) }),
  updateInstructor: (id, data) =>
    request(`/instructors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteInstructor: (id) => request(`/instructors/${id}`, { method: 'DELETE' }),
  uploadInstructorPhoto: (id, file) => {
    const token = getToken()
    const fd = new FormData()
    fd.append('photo', file)
    return fetch(`${BASE}/instructors/${id}/photo`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d })
  },
  uploadInstructorDocument: (id, file) => {
    const token = getToken()
    const fd = new FormData()
    fd.append('document', file)
    return fetch(`${BASE}/instructors/${id}/documents`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d })
  },
  deleteInstructorDocument: (id, docId) =>
    request(`/instructors/${id}/documents/${docId}`, { method: 'DELETE' }),

  // Cases
  getCases: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/cases${qs ? `?${qs}` : ''}`)
  },
  getCase: (id) => request(`/cases/${id}`),
  createCase: (data) => request('/cases', { method: 'POST', body: JSON.stringify(data) }),
  updateCase: (id, data) => request(`/cases/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setCaseStatus: (id, status) =>
    request(`/cases/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  // Action items
  createActionItem: (data) =>
    request('/action-items', { method: 'POST', body: JSON.stringify(data) }),
  updateActionItem: (id, data) =>
    request(`/action-items/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setActionItemStatus: (id, status) =>
    request(`/action-items/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  starActionItem: (id, starred) =>
    request(`/action-items/${id}/star`, { method: 'PATCH', body: JSON.stringify({ starred }) }),
  deleteActionItem: (id) => request(`/action-items/${id}`, { method: 'DELETE' }),
  addNote: (actionItemId, data) =>
    request(`/action-items/${actionItemId}/notes`, { method: 'POST', body: JSON.stringify(data) }),
  updateNote: (actionItemId, noteId, data) =>
    request(`/action-items/${actionItemId}/notes/${noteId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNote: (actionItemId, noteId) =>
    request(`/action-items/${actionItemId}/notes/${noteId}`, { method: 'DELETE' }),

  // Reminders
  getReminders: () => request('/reminders'),
  createReminder: (data) =>
    request('/reminders', { method: 'POST', body: JSON.stringify(data) }),
  updateReminder: (id, data) =>
    request(`/reminders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  markReminderDone: (id) =>
    request(`/reminders/${id}/done`, { method: 'PATCH' }),
  deleteReminder: (id) =>
    request(`/reminders/${id}`, { method: 'DELETE' }),

  // Lookups + all-user action type management
  getActionTypes: () => request('/action-types'),
  getDelegates: () => request('/delegates'),
  createActionTypeUser: (data) =>
    request('/action-types', { method: 'POST', body: JSON.stringify(data) }),
  updateActionTypeUser: (id, data) =>
    request(`/action-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteActionTypeUser: (id) =>
    request(`/action-types/${id}`, { method: 'DELETE' }),

  // Recruiting
  getRecruiting: (q) => request(`/recruiting${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getRecruitingByClient: (clientId) => request(`/recruiting/client/${clientId}`),
  createRecruitingEntry: (data) =>
    request('/recruiting/entries', { method: 'POST', body: JSON.stringify(data) }),
  updateRecruitingEntry: (id, data) =>
    request(`/recruiting/entries/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRecruitingEntry: (id) =>
    request(`/recruiting/entries/${id}`, { method: 'DELETE' }),
  addRecruitingNote: (entryId, data) =>
    request(`/recruiting/entries/${entryId}/notes`, { method: 'POST', body: JSON.stringify(data) }),
  deleteRecruitingNote: (entryId, noteId) =>
    request(`/recruiting/entries/${entryId}/notes/${noteId}`, { method: 'DELETE' }),
  getRecruitingColumns: () => request('/recruiting/columns'),
  addRecruitingColumn: (data) =>
    request('/recruiting/columns', { method: 'POST', body: JSON.stringify(data) }),
  updateRecruitingColumn: (id, data) =>
    request(`/recruiting/columns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRecruitingColumn: (id) =>
    request(`/recruiting/columns/${id}`, { method: 'DELETE' }),

  // Settings (admin)
  getSettingsActionTypes: () => request('/settings/action-types'),
  createActionType: (data) =>
    request('/settings/action-types', { method: 'POST', body: JSON.stringify(data) }),
  updateActionType: (id, data) =>
    request(`/settings/action-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteActionType: (id) => request(`/settings/action-types/${id}`, { method: 'DELETE' }),
  reorderActionTypes: (items) =>
    request('/settings/action-types/reorder', { method: 'PATCH', body: JSON.stringify({ items }) }),

  getSettingsDelegates: () => request('/settings/delegates'),
  createDelegate: (data) =>
    request('/settings/delegates', { method: 'POST', body: JSON.stringify(data) }),
  updateDelegate: (id, data) =>
    request(`/settings/delegates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDelegate: (id) => request(`/settings/delegates/${id}`, { method: 'DELETE' }),

  // Reference (internal wiki)
  getReference: () => request('/reference'),
  createReferenceSection: (data) =>
    request('/reference', { method: 'POST', body: JSON.stringify(data) }),
  updateReferenceSection: (id, data) =>
    request(`/reference/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteReferenceSection: (id) =>
    request(`/reference/${id}`, { method: 'DELETE' }),
  reorderReferenceSections: (items) =>
    request('/reference/reorder', { method: 'PATCH', body: JSON.stringify({ items }) }),

  // Invoices
  getInvoices: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([,v]) => v)).toString()
    return request(`/invoices${q ? `?${q}` : ''}`)
  },
  getInvoice: (id) => request(`/invoices/${id}`),
  createInvoice: (data) => request('/invoices', { method: 'POST', body: JSON.stringify(data) }),
  updateInvoice: (id, data) => request(`/invoices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setInvoiceStatus: (id, status) => request(`/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteInvoice: (id) => request(`/invoices/${id}`, { method: 'DELETE' }),

  // Public invoice (no auth needed — used by payment page)
  getPublicInvoice: (id) => fetch(`${BASE}/invoices/public/${id}`).then(r => r.json()),
  createPaymentIntent: (id) => fetch(`${BASE}/invoices/public/${id}/pay`, { method: 'POST' }).then(r => r.json()),

  // Class packages
  getClientPackages: (clientId) => request(`/packages/client/${clientId}`),
  getRecentlyCompletedPackages: () => request('/packages/completed-recent'),
  createPackage: (data) => request('/packages', { method: 'POST', body: JSON.stringify(data) }),
  updatePackage: (id, data) => request(`/packages/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePackage: (id) => request(`/packages/${id}`, { method: 'DELETE' }),
  logSession: (packageId, data) => request(`/packages/${packageId}/sessions`, { method: 'POST', body: JSON.stringify(data) }),
  deleteSession: (packageId, sessionId) => request(`/packages/${packageId}/sessions/${sessionId}`, { method: 'DELETE' }),

  // Stripe settings (admin)
  getStripeSettings: () => request('/settings/stripe'),
  saveStripeSettings: (data) => request('/settings/stripe', { method: 'POST', body: JSON.stringify(data) }),

  getSettingsUsers: () => request('/settings/users'),
  createUser: (data) =>
    request('/settings/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) =>
    request(`/settings/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setUserActive: (id, active) =>
    request(`/settings/users/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
}
