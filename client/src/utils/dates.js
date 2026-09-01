// Calendar dates as the person looking at the screen would write them.
//
// `new Date().toISOString().slice(0, 10)` was used all over this app to mean "today". It
// doesn't: it's the UTC date, which rolls over at 8pm Eastern. So for the last four hours
// of the day, anything due tomorrow showed as overdue and anything stamped "today" got
// tomorrow's date.
//
// en-CA formats as YYYY-MM-DD, which is what every date field here stores, and with no
// timeZone argument it uses the viewer's own clock — which is the one they mean.

export function ymd(date = new Date()) {
  return new Date(date).toLocaleDateString('en-CA')
}

export function today() {
  return ymd()
}

export function daysFromToday(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return ymd(d)
}

// When a note was written, for display next to its author.
//
// Timestamps arrive in two shapes here: proper timestamptz from newer tables, and plain
// 'YYYY-MM-DD HH:MM:SS' local-time strings from the ones still carrying the SQLite-era
// TEXT columns. The latter has no zone marker, so JS would read it as UTC and show it
// hours out — hence the explicit patch to a local-time literal before parsing.
//
// The year is only shown when it isn't the current one, so the common case stays short.
export function noteTime(ts) {
  if (!ts) return ''
  const raw = String(ts)
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)
  const d = new Date(hasZone ? raw : raw.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}
