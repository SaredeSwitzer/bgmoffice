// Mirrors SAREDE_EMAILS in server/middleware/auth.js — used purely to decide whether to
// render the Sales tab/nav link at all. The server re-checks this independently on every
// /api/sales request, so this list being out of sync would only ever hide/show a link,
// never grant real access.
const SAREDE_EMAILS = ['admin@bgmoffice.com', 'sarede@bgmoffice.com']

export function isSaredeUser(user) {
  return !!user && SAREDE_EMAILS.includes(user.email)
}
