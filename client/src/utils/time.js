// Format a 24-hour "HH:MM" (or "HH:MM:SS") string as 12-hour with am/pm.
export function fmtTime(t) {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

// "HH:MM" + minutes -> "HH:MM", wrapping past midnight (24hr, for further formatting).
function addMinutes(startTime, minutes) {
  const [h, m] = String(startTime).split(':').map(Number)
  const total = (h * 60 + m + minutes + 1440) % 1440
  const eh = Math.floor(total / 60)
  const em = total % 60
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
}

// "9:30am–10:30am" from a start time + duration. Falls back to just the start time if
// there's no duration to work with.
export function fmtTimeRange(startTime, durationMinutes) {
  if (!startTime) return ''
  if (!durationMinutes) return fmtTime(startTime)
  return `${fmtTime(startTime)}–${fmtTime(addMinutes(startTime, durationMinutes))}`
}

// "1h", "45 min", "1h 30m" — a duration in minutes as a short label.
export function fmtDuration(minutes) {
  if (!minutes) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
