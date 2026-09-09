// Who to say wrote something.
//
// Most entries are stamped with a person's initials, but a few are written by the app
// itself — the nightly sync that turns a calendar into reminders, the public sign-up
// form. Those store a machine name like "daily-sync", which means nothing to anyone
// reading the sheet, so they get plain English instead.
const SYSTEM_AUTHORS = {
  'daily-sync': 'Automatic',
  'signup':     'Sign-up form',
  'recruiting': 'Recruiting',
}

export function authorLabel(author) {
  if (!author) return ''
  return SYSTEM_AUTHORS[String(author).toLowerCase()] || author
}
