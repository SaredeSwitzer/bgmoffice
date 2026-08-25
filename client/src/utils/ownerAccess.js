// Mirrors OWNER_EMAILS in server/middleware/auth.js — used purely to decide whether to
// render the Admin Notes UI at all. The server re-checks this independently on every
// admin-notes request, so this list being out of sync would only ever hide/show a button,
// never grant real access.
const OWNER_EMAILS = ['admin@bgmoffice.com', 'sarede@bgmoffice.com', 'claire@bgmoffice.com', 'maria@bgmoffice.com']

export function isOwnerUser(user) {
  return !!user && OWNER_EMAILS.includes(user.email)
}
