// Production: same-origin relative (/api via vercel.json rewrite). Dev: local server.
// Exported because anything that builds its own URL must use this — hardcoding a
// localhost fallback is what silently broke the deployed app once already.
export const API_ROOT = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001')
const BASE = API_ROOT + '/api'

export function uploadsUrl(filename) {
  if (!filename) return null
  if (filename.startsWith('https://') || filename.startsWith('http://')) return filename
  return `${API_ROOT}/uploads/${filename}`
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
  // A 401 from the sign-in endpoints means "wrong password / wrong code" — the visitor
  // isn't logged in yet, so there's no session to expire. Only a 401 elsewhere means a
  // live session went stale.
  const SIGN_IN_PATHS = [
    '/auth/login', '/auth/request-code', '/auth/verify-code',
    '/auth/passkeys/login', '/auth/passkeys/login/options',
  ]
  if (res.status === 401 && !SIGN_IN_PATHS.includes(path)) {
    localStorage.removeItem('bgm_token')
    window.dispatchEvent(new Event('bgm:session-expired'))
  }
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const api = {
  myTasks: () => request('/dashboard/my-tasks'),

  // Standalone Tasks
  getTasks: (status) => request(`/tasks${status ? `?status=${status}` : ''}`),
  createTask: (data) => request('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id, data) => request(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  starTask: (id, starred) => request(`/tasks/${id}/star`, { method: 'PATCH', body: JSON.stringify({ starred }) }),
  addTaskReply: (id, text, opts = {}) => request(`/tasks/${id}/replies`, { method: 'POST', body: JSON.stringify({ text, ...opts }) }),
  deleteTaskReply: (id, replyId) => request(`/tasks/${id}/replies/${replyId}`, { method: 'DELETE' }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),

  // Auth — code sign-in is the everyday path, password is the backup
  // account_id disambiguates when one email maps to several accounts (Sarede is both the admin
  // and a staff user, and both codes go to the same inbox).
  requestCode: (email, account_id) =>
    request('/auth/request-code', { method: 'POST', body: JSON.stringify({ email, account_id }) }),
  verifyCode: (email, code, account_id) =>
    request('/auth/verify-code', { method: 'POST', body: JSON.stringify({ email, code, account_id }) }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/auth/me'),

  // Passkey (Touch ID / Face ID). Sign-in needs no email: the browser offers whichever passkey
  // it holds for this site, so it's open -> touch -> in.
  passkeyLoginOptions: () => request('/auth/passkeys/login/options', { method: 'POST' }),
  passkeyLogin: (response) =>
    request('/auth/passkeys/login', { method: 'POST', body: JSON.stringify({ response }) }),
  passkeyRegisterOptions: () => request('/auth/passkeys/register/options', { method: 'POST' }),
  passkeyRegister: (response, label) =>
    request('/auth/passkeys/register', { method: 'POST', body: JSON.stringify({ response, label }) }),
  getPasskeys: () => request('/auth/passkeys'),
  deletePasskey: (id) => request(`/auth/passkeys/${id}`, { method: 'DELETE' }),

  // Dashboard
  dashboard: () => request('/dashboard'),

  // Clients
  getClients: (q) => request(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) => request('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) => request(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setClientInvoiceEmail: (id, invoice_email) => request(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify({ invoice_email }) }),
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
  getInstructorNotes: (id) => request(`/instructors/${id}/notes`),
  addInstructorNote: (id, text) => request(`/instructors/${id}/notes`, { method: 'POST', body: JSON.stringify({ text }) }),
  deleteInstructorNote: (id, noteId) => request(`/instructors/${id}/notes/${noteId}`, { method: 'DELETE' }),

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
  getRemindersByClient: (clientId) => request(`/reminders?client_id=${clientId}`),
  getRemindersByInstructor: (instructorId) => request(`/reminders?instructor_id=${instructorId}`),
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
  getUsers: () => request('/users'),
  createActionTypeUser: (data) =>
    request('/action-types', { method: 'POST', body: JSON.stringify(data) }),
  updateActionTypeUser: (id, data) =>
    request(`/action-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteActionTypeUser: (id) =>
    request(`/action-types/${id}`, { method: 'DELETE' }),

  // Recruiting
  getRecruiting: (q, { archived } = {}) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (archived) params.set('archived', '1')
    const qs = params.toString()
    return request(`/recruiting${qs ? `?${qs}` : ''}`)
  },
  getRecruitingByClient: (clientId) => request(`/recruiting/client/${clientId}`),
  getRecruitingByInstructor: (instructorId) => request(`/recruiting/instructor/${instructorId}`),
  createRecruitingEntry: (data) =>
    request('/recruiting/entries', { method: 'POST', body: JSON.stringify(data) }),
  updateRecruitingEntry: (id, data) =>
    request(`/recruiting/entries/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRecruitingEntry: (id) =>
    request(`/recruiting/entries/${id}`, { method: 'DELETE' }),
  archiveRecruitingEntry: (id) =>
    request(`/recruiting/entries/${id}/archive`, { method: 'PATCH' }),
  addRecruitingNote: (entryId, data) =>
    request(`/recruiting/entries/${entryId}/notes`, { method: 'POST', body: JSON.stringify(data) }),
  deleteRecruitingNote: (entryId, noteId) =>
    request(`/recruiting/entries/${entryId}/notes/${noteId}`, { method: 'DELETE' }),
  updateRecruitingNote: (entryId, noteId, data) =>
    request(`/recruiting/entries/${entryId}/notes/${noteId}`, { method: 'PUT', body: JSON.stringify(data) }),
  toggleRecruitingNoteDone: (entryId, noteId) =>
    request(`/recruiting/entries/${entryId}/notes/${noteId}/done`, { method: 'PATCH' }),
  getRecruitingColumns: () => request('/recruiting/columns'),
  addRecruitingColumn: (data) =>
    request('/recruiting/columns', { method: 'POST', body: JSON.stringify(data) }),
  updateRecruitingColumn: (id, data) =>
    request(`/recruiting/columns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRecruitingColumn: (id) =>
    request(`/recruiting/columns/${id}`, { method: 'DELETE' }),
  getInstructorAvailability: () => request('/recruiting/availability'),
  addInstructorAvailability: (data) =>
    request('/recruiting/availability', { method: 'POST', body: JSON.stringify(data) }),
  updateInstructorAvailability: (id, data) =>
    request(`/recruiting/availability/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteInstructorAvailability: (id) =>
    request(`/recruiting/availability/${id}`, { method: 'DELETE' }),
  getClassStyles: () => request('/recruiting/styles'),
  createClassStyle: (name) =>
    request('/recruiting/styles', { method: 'POST', body: JSON.stringify({ name }) }),
  updateClassStyle: (id, name) =>
    request(`/recruiting/styles/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteClassStyle: (id) =>
    request(`/recruiting/styles/${id}`, { method: 'DELETE' }),

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
  getInvoicePayments: (id) => request(`/invoices/${id}/payments`),
  addInvoicePayment: (id, data) => request(`/invoices/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  deleteInvoicePayment: (id, paymentId) => request(`/invoices/${id}/payments/${paymentId}`, { method: 'DELETE' }),

  // Public invoice (no auth — used by the pay page). Keyed on the invoice's random
  // public_token, never its id: the token is what stops strangers reading every invoice.
  getPublicInvoice: (token) => fetch(`${BASE}/invoices/public/${token}`).then(r => r.json()),
  createPaymentIntent: (token) => fetch(`${BASE}/invoices/public/${token}/pay`, { method: 'POST' }).then(r => r.json()),

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
