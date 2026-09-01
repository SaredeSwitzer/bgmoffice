// Calendar dates in the office's timezone, not UTC.
//
// `new Date().toISOString().slice(0, 10)` was used all over this app to mean "today".
// It doesn't: it's the UTC date, which rolls over at 8pm Eastern (7pm in winter). So for
// the last four hours of every working day the app believed it was already tomorrow —
// reminders due today read as overdue, tomorrow's read as due now, and anything stamped
// with "today" got the wrong date.
//
// en-CA formats as YYYY-MM-DD, which is the format every date column here stores.

const ZONE = 'America/New_York';

// The local calendar date of an instant (defaults to now), as 'YYYY-MM-DD'.
function ymd(date = new Date()) {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: ZONE });
}

// Today in the office's timezone.
function today() {
  return ymd();
}

// N days from today, as 'YYYY-MM-DD'. Positive for the future, negative for the past.
function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

module.exports = { ymd, today, daysFromToday, ZONE };
