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
