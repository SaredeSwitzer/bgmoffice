const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/api'

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
  deleteActionItem: (id) => request(`/action-items/${id}`, { method: 'DELETE' }),
  addNote: (actionItemId, data) =>
    request(`/action-items/${actionItemId}/notes`, { method: 'POST', body: JSON.stringify(data) }),
  deleteNote: (actionItemId, noteId) =>
    request(`/action-items/${actionItemId}/notes/${noteId}`, { method: 'DELETE' }),

  // Lookups
  getActionTypes: () => request('/action-types'),
  getDelegates: () => request('/delegates'),

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

  getSettingsUsers: () => request('/settings/users'),
  createUser: (data) =>
    request('/settings/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) =>
    request(`/settings/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setUserActive: (id, active) =>
    request(`/settings/users/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
}
