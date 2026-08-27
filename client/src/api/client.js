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

// A non-2xx from Vercel's platform itself (e.g. "Request Entity Too Large" for an
// oversized upload) arrives as plain text, not JSON — res.json() on that throws an
// unreadable "Unexpected token" error instead of the actual problem. Read as text first
// and only parse it as JSON if it looks like JSON.
async function parseUploadResponse(res) {
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} }
  catch { data = { error: res.status === 413 ? 'That file is too large to upload.' : text.slice(0, 200) || 'Upload failed.' } }
  if (!res.ok) throw new Error(data.error || 'Upload failed.')
  return data
}

// Large phone-camera photos routinely exceed what the upload endpoint accepts, and
// nobody uploading a JPEG needs it at full resolution anyway. Downscale + recompress
// client-side before it ever leaves the browser; leave non-images (PDFs, etc.) alone.
function compressImage(file, maxDim = 1800, quality = 0.82) {
  if (!file.type?.startsWith('image/') || file.type === 'image/gif') return Promise.resolve(file)
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => {
        if (!blob || blob.size >= file.size) return resolve(file)
        resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
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

  // SMS inbox (two-way texting)
  smsThreads: () => request('/sms/threads'),
  smsThread: (phone) => request(`/sms/thread/${encodeURIComponent(phone)}`),
  smsSend: (to, body) => request('/sms/send', { method: 'POST', body: JSON.stringify({ to, body }) }),

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
  updateClientAddress: (id, data) => request(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
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
  getLoginReminderPreview: (id) => request(`/instructors/${id}/login-reminder-preview`),
  sendLoginReminder: (id, data = {}) => request(`/instructors/${id}/send-login-reminder`, { method: 'POST', body: JSON.stringify(data) }),
  getInstructorIntroPreview: (id) => request(`/instructors/${id}/intro-preview`),
  sendInstructorIntro: (id, data = {}) => request(`/instructors/${id}/send-intro`, { method: 'POST', body: JSON.stringify(data) }),
  sendInstructorEmailBlast: (data) => request('/instructors/email-blast', { method: 'POST', body: JSON.stringify(data) }),
  revealInstructorSSN: (id) => request(`/instructors/${id}/reveal-ssn`),

  // Instructor sign-ups — public submission (from /join, no login) + staff review
  submitInstructorSignup: (data) => request('/instructor-signup', { method: 'POST', body: JSON.stringify(data) }),
  getInstructorSignups: (status) => request(`/instructor-signup${status ? `?status=${status}` : ''}`),
  approveInstructorSignup: (id) => request(`/instructor-signup/${id}/approve`, { method: 'POST' }),
  rejectInstructorSignup: (id) => request(`/instructor-signup/${id}/reject`, { method: 'POST' }),
  uploadInstructorPhoto: async (id, file) => {
    const token = getToken()
    const fd = new FormData()
    fd.append('photo', await compressImage(file))
    const r = await fetch(`${BASE}/instructors/${id}/photo`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    return parseUploadResponse(r)
  },
  uploadInstructorDocument: async (id, file) => {
    const token = getToken()
    const fd = new FormData()
    fd.append('document', await compressImage(file))
    const r = await fetch(`${BASE}/instructors/${id}/documents`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    return parseUploadResponse(r)
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
  getReminderNotes: (id) => request(`/reminders/${id}/notes`),
  addReminderNote: (id, text) =>
    request(`/reminders/${id}/notes`, { method: 'POST', body: JSON.stringify({ text }) }),
  deleteReminderNote: (id, noteId) =>
    request(`/reminders/${id}/notes/${noteId}`, { method: 'DELETE' }),

  // Sales leads (Sarede-only)
  getSalesLeads: () => request('/sales'),
  createSalesLead: (data) => request('/sales', { method: 'POST', body: JSON.stringify(data) }),
  updateSalesLead: (id, data) => request(`/sales/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSalesLead: (id) => request(`/sales/${id}`, { method: 'DELETE' }),
  getSalesLeadNotes: (id) => request(`/sales/${id}/notes`),
  addSalesLeadNote: (id, text) =>
    request(`/sales/${id}/notes`, { method: 'POST', body: JSON.stringify({ text }) }),
  deleteSalesLeadNote: (id, noteId) =>
    request(`/sales/${id}/notes/${noteId}`, { method: 'DELETE' }),

  // Lookups + all-user action type management
  getActionTypes: () => request('/action-types'),
  getDelegates: () => request('/delegates'),
  getUsers: () => request('/users'),
  getMentionableUsers: () => request('/mentionable-users'),
  createActionTypeUser: (data) =>
    request('/action-types', { method: 'POST', body: JSON.stringify(data) }),
  updateActionTypeUser: (id, data) =>
    request(`/action-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteActionTypeUser: (id) =>
    request(`/action-types/${id}`, { method: 'DELETE' }),

  // Recruiting
  getMeetingInvitePreview: (data) => request('/recruiting/meeting-invite/preview', { method: 'POST', body: JSON.stringify(data) }),
  sendMeetingInvite: (data) => request('/recruiting/meeting-invite', { method: 'POST', body: JSON.stringify(data) }),

  // Instructor contract e-signature
  getContractInvitePreview: (data) => request('/instructor-contract/invite/preview', { method: 'POST', body: JSON.stringify(data) }),
  sendContractInvite: (id, data) => request(`/instructor-contract/invite/${id}/send`, { method: 'POST', body: JSON.stringify(data) }),
  getContractSignatures: () => request('/instructor-contract/signatures'),
  linkContractSignature: (id, instructor_id) => request(`/instructor-contract/signatures/${id}/link`, { method: 'POST', body: JSON.stringify({ instructor_id }) }),
  dismissContractSignature: (id) => request(`/instructor-contract/signatures/${id}/dismiss`, { method: 'POST' }),
  getContractSigningInfo: (token) => request(`/instructor-contract/public/${token}`),
  signContract: (token, data) => request(`/instructor-contract/public/${token}/sign`, { method: 'POST', body: JSON.stringify(data) }),

  // Client/organization contract e-signature
  getClientContractInvitePreview: (data) => request('/client-contract/invite/preview', { method: 'POST', body: JSON.stringify(data) }),
  sendClientContractInvite: (id, data) => request(`/client-contract/invite/${id}/send`, { method: 'POST', body: JSON.stringify(data) }),
  getClientContractSignatures: () => request('/client-contract/signatures'),
  linkClientContractSignature: (id, client_id) => request(`/client-contract/signatures/${id}/link`, { method: 'POST', body: JSON.stringify({ client_id }) }),
  dismissClientContractSignature: (id) => request(`/client-contract/signatures/${id}/dismiss`, { method: 'POST' }),
  getClientContractSigningInfo: (token) => fetch(`${BASE}/client-contract/public/${token}`).then(r => r.json()),
  createClientContractPaymentIntent: (token) => fetch(`${BASE}/client-contract/public/${token}/create-payment-intent`, { method: 'POST' }).then(r => r.json()),
  signClientContract: (token, data) => fetch(`${BASE}/client-contract/public/${token}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
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
  resolveMention: (id) => request(`/dashboard/mentions/${id}/resolve`, { method: 'PATCH' }),
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
  getReadyToSendInvoices: () => request('/invoices/ready-to-send'),
  approveInvoice: (id) => request(`/invoices/${id}/approve`, { method: 'PATCH' }),
  createInvoice: (data) => request('/invoices', { method: 'POST', body: JSON.stringify(data) }),
  updateInvoice: (id, data) => request(`/invoices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setInvoiceStatus: (id, status) => request(`/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  getInvoiceSendPreview: (id) => request(`/invoices/${id}/send-preview`, { method: 'POST' }),
  sendInvoiceEmail: (id, data) => request(`/invoices/${id}/send`, { method: 'POST', body: JSON.stringify(data) }),
  archiveInvoice: (id) => request(`/invoices/${id}/archive`, { method: 'PATCH' }),
  duplicateInvoice: (id) => request(`/invoices/${id}/duplicate`, { method: 'POST' }),
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

  // Scheduling — recurring class arrangements + their dated occurrences
  getClassSchedules: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
    return request(`/schedule/schedules${qs ? `?${qs}` : ''}`)
  },
  createClassSchedule: (data) => request('/schedule/schedules', { method: 'POST', body: JSON.stringify(data) }),
  updateClassSchedule: (id, data) => request(`/schedule/schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteClassSchedule: (id) => request(`/schedule/schedules/${id}`, { method: 'DELETE' }),
  deleteFutureSessions: (id) => request(`/schedule/schedules/${id}/future-sessions`, { method: 'DELETE' }),
  getClassSessions: (start, end, params = {}) => {
    const qs = new URLSearchParams({ start, end, ...params }).toString()
    return request(`/schedule/sessions?${qs}`)
  },
  createClassSession: (data) => request('/schedule/sessions', { method: 'POST', body: JSON.stringify(data) }),
  createClassSessionsBulk: (data) => request('/schedule/sessions/bulk', { method: 'POST', body: JSON.stringify(data) }),
  updateClassSession: (id, data) => request(`/schedule/sessions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  bulkUpdateClassSessions: (data) => request('/schedule/sessions/bulk-update', { method: 'PATCH', body: JSON.stringify(data) }),
  deleteClassSession: (id) => request(`/schedule/sessions/${id}`, { method: 'DELETE' }),

  // Instructor accounts only — the caller's own classes. The server scopes this to the
  // instructor_id in the session, so there is no id to pass and none can be forged here.
  getMySessions: (start, end) => {
    const qs = new URLSearchParams({ start, end }).toString()
    return request(`/schedule/my-sessions?${qs}`)
  },
  getMyVenmoTarget: () => request('/schedule/my-venmo-target'),
  getMyPayoutRequestStatus: (week_start) => request(`/payout-requests/status?${new URLSearchParams({ week_start }).toString()}`),
  recordPayoutRequest: (data) => request('/payout-requests', { method: 'POST', body: JSON.stringify(data) }),

  // Instructor accounts only — their own availability slots (instructors/:id/availability
  // is locked to req.user.instructor_id server-side; instructorId here is just for the URL).
  getMyAvailability: (instructorId) => request(`/instructors/${instructorId}/availability`),
  addMyAvailability: (instructorId, data) =>
    request(`/instructors/${instructorId}/availability`, { method: 'POST', body: JSON.stringify(data) }),
  updateMyAvailability: (instructorId, availId, data) =>
    request(`/instructors/${instructorId}/availability/${availId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMyAvailability: (instructorId, availId) =>
    request(`/instructors/${instructorId}/availability/${availId}`, { method: 'DELETE' }),
  getMyAvailabilityCheckStatus: (instructorId, week_start) =>
    request(`/instructors/${instructorId}/availability-check?${new URLSearchParams({ week_start }).toString()}`),
  confirmMyAvailability: (instructorId, week_start) =>
    request(`/instructors/${instructorId}/availability-check`, { method: 'POST', body: JSON.stringify({ week_start }) }),

  // Notes & to-do tasks on a class — attach to a recurring class ('schedule') or a dated 'session'.
  getClassNotes: (kind, id) => request(`/schedule/${kind === 'session' ? 'sessions' : 'schedules'}/${id}/notes`),
  addClassNote: (kind, id, data) => request(`/schedule/${kind === 'session' ? 'sessions' : 'schedules'}/${id}/notes`, { method: 'POST', body: JSON.stringify(data) }),
  updateClassNote: (noteId, data) => request(`/schedule/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  toggleClassNoteDone: (noteId) => request(`/schedule/notes/${noteId}/done`, { method: 'PATCH' }),
  deleteClassNote: (noteId) => request(`/schedule/notes/${noteId}`, { method: 'DELETE' }),

  // Admin-only notes — same shape, but only visible to Sarede/Claire/Maria (server-enforced).
  getAdminNotes: (kind, id) => request(`/schedule/${kind === 'session' ? 'sessions' : 'schedules'}/${id}/admin-notes`),
  addAdminNote: (kind, id, data) => request(`/schedule/${kind === 'session' ? 'sessions' : 'schedules'}/${id}/admin-notes`, { method: 'POST', body: JSON.stringify(data) }),
  deleteAdminNote: (noteId) => request(`/schedule/admin-notes/${noteId}`, { method: 'DELETE' }),

  // Instructor confirmation email — preview (fills the template from the class) then send.
  // Works for a recurring schedule or a single dated session.
  getConfirmationPreview: (scheduleId) => request(`/schedule/schedules/${scheduleId}/confirmation-preview`),
  sendConfirmation: (scheduleId, data = {}) => request(`/schedule/schedules/${scheduleId}/send-confirmation`, { method: 'POST', body: JSON.stringify(data) }),
  getCombinedConfirmationPreview: (scheduleIds) => request('/schedule/schedules/combined-confirmation-preview', { method: 'POST', body: JSON.stringify({ schedule_ids: scheduleIds }) }),
  sendCombinedConfirmation: (scheduleIds, data = {}) => request('/schedule/schedules/combined-send-confirmation', { method: 'POST', body: JSON.stringify({ schedule_ids: scheduleIds, ...data }) }),
  getSessionConfirmationPreview: (sessionId) => request(`/schedule/sessions/${sessionId}/confirmation-preview`),
  sendSessionConfirmation: (sessionId, data = {}) => request(`/schedule/sessions/${sessionId}/send-confirmation`, { method: 'POST', body: JSON.stringify(data) }),
  getRescheduleAlertPreview: (sessionId) => request(`/schedule/sessions/${sessionId}/reschedule-alert-preview`),
  sendRescheduleAlert: (sessionId, data = {}) => request(`/schedule/sessions/${sessionId}/send-reschedule-alert`, { method: 'POST', body: JSON.stringify(data) }),
  getSessionSiblings: (sessionId) => request(`/schedule/sessions/${sessionId}/siblings`),
  getCombinedSessionConfirmationPreview: (sessionIds) => request('/schedule/sessions/combined-confirmation-preview', { method: 'POST', body: JSON.stringify({ session_ids: sessionIds }) }),
  sendCombinedSessionConfirmation: (sessionIds, data = {}) => request('/schedule/sessions/combined-send-confirmation', { method: 'POST', body: JSON.stringify({ session_ids: sessionIds, ...data }) }),
  // Editable confirmation template (admin)
  getConfirmationTemplate: () => request('/settings/confirmation-template'),
  saveConfirmationTemplate: (data) => request('/settings/confirmation-template', { method: 'POST', body: JSON.stringify(data) }),

  // Recurring CC billing (Stripe saved cards) + card-on-file
  // Public save-card link (no auth):
  getSaveCard: (token) => fetch(`${BASE}/billing/save-card/${token}`).then(r => r.json()),
  createSaveCardIntent: (token) => fetch(`${BASE}/billing/save-card/${token}/intent`, { method: 'POST' }).then(r => r.json()),
  confirmSaveCard: (token, setup_intent_id) => fetch(`${BASE}/billing/save-card/${token}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setup_intent_id }),
  }).then(r => r.json()),
  // Staff (authed):
  getClientSaveLink: (clientId) => request(`/billing/clients/${clientId}/save-link`, { method: 'POST' }),
  createClientSetupIntent: (clientId) => request(`/billing/clients/${clientId}/setup-intent`, { method: 'POST' }),
  confirmClientCard: (clientId, setup_intent_id) => request(`/billing/clients/${clientId}/confirm-card`, { method: 'POST', body: JSON.stringify({ setup_intent_id }) }),
  removeClientCard: (clientId) => request(`/billing/clients/${clientId}/card`, { method: 'DELETE' }),
  getBillingWeek: (start) => request(`/billing/week?start=${start}`),
  getBillingReport: (start) => request(`/billing/report?start=${start}`),
  chargeBilling: (week_start, items) => request('/billing/charge', { method: 'POST', body: JSON.stringify({ week_start, items }) }),
  setClientPaymentStatus: (data) => request('/billing/client-status', { method: 'PATCH', body: JSON.stringify(data) }),
  setInstructorPaymentStatus: (data) => request('/billing/instructor-status', { method: 'PATCH', body: JSON.stringify(data) }),
  syncBillingWeek: (week_start, dry_run = false, client_id = null) =>
    request('/billing/sync-week', { method: 'POST', body: JSON.stringify({ week_start, dry_run, client_id }) }),
  getStripeCharges: (range) => {
    const q = (range && typeof range === 'object')
      ? `start=${range.start}&end=${range.end}`
      : `days=${range || 7}`
    return request(`/billing/stripe-charges?${q}`)
  },

  // Stripe settings (admin)
  getStripeSettings: () => request('/settings/stripe'),
  saveStripeSettings: (data) => request('/settings/stripe', { method: 'POST', body: JSON.stringify(data) }),

  // Venmo settings (admin) — the business's own handle, shown to instructors for payout requests
  getVenmoSettings: () => request('/settings/venmo'),
  saveVenmoSettings: (data) => request('/settings/venmo', { method: 'POST', body: JSON.stringify(data) }),

  getSettingsUsers: () => request('/settings/users'),
  createUser: (data) =>
    request('/settings/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) =>
    request(`/settings/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setUserActive: (id, active) =>
    request(`/settings/users/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
}
