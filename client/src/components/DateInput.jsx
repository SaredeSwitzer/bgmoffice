import { useState, useEffect } from 'react'

const BOX = 'border border-gray-300 rounded-lg px-2 py-2.5 text-base text-center focus:outline-none focus:ring-2 focus:ring-gray-300 min-w-0'

function parse(v) {
  if (!v) return { year: '', month: '', day: '' }
  const parts = v.split('-')
  return {
    year:  parseInt(parts[0]) || '',
    month: parseInt(parts[1]) || '',
    day:   parseInt(parts[2]) || '',
  }
}

function clamp(v, min, max) {
  if (v === '') return ''
  return Math.min(max, Math.max(min, Number(v)))
}

/**
 * Plain Month / Day / Year number fields — no <input type="date"> (locale
 * calendar popup) and no <select> (native dropdown list that covers the
 * rest of the form when opened).
 * value  — YYYY-MM-DD string or ''
 * onChange — called with YYYY-MM-DD string, or '' when any field is blank
 */
export default function DateInput({ value = '', onChange, required = false, className = '' }) {
  const [internal, setInternal] = useState(() => parse(value))

  // Sync when parent resets or sets a new value externally
  useEffect(() => {
    setInternal(parse(value))
  }, [value])

  const maxDay = (internal.year && internal.month) ? new Date(internal.year, internal.month, 0).getDate() : 31

  function update(y, m, d) {
    if (d !== '' && d > maxDay) d = maxDay
    setInternal({ year: y, month: m, day: d })
    if (y && m && d) {
      onChange(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    } else {
      onChange('')
    }
  }

  function digits(raw) { return raw.replace(/\D/g, '') }

  return (
    <div className={`flex gap-1.5 ${className}`}>
      <input
        type="text" inputMode="numeric" placeholder="MM" required={required}
        value={internal.month}
        onChange={e => update(internal.year, clamp(digits(e.target.value), 1, 12), internal.day)}
        className={`flex-1 ${BOX}`}
      />
      <input
        type="text" inputMode="numeric" placeholder="DD" required={required}
        value={internal.day}
        onChange={e => update(internal.year, internal.month, clamp(digits(e.target.value), 1, maxDay))}
        className={`flex-1 ${BOX}`}
      />
      <input
        type="text" inputMode="numeric" placeholder="YYYY" required={required}
        value={internal.year}
        onChange={e => update(clamp(digits(e.target.value).slice(0, 4), 0, 9999), internal.month, internal.day)}
        className={`flex-[1.4] ${BOX}`}
      />
    </div>
  )
}
