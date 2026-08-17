// Format a 24-hour "HH:MM" (or "HH:MM:SS") string as 12-hour with am/pm.
export function fmtTime(t) {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`
}
