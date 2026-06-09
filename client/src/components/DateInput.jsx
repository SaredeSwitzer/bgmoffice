import { useState, useEffect } from 'react'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const YEARS = Array.from({ length: 11 }, (_, i) => 2020 + i) // 2020–2030

const SEL = 'border border-gray-300 rounded-lg px-2 py-2.5 bg-white text-base focus:outline-none focus:ring-2 focus:ring-gray-300 min-w-0'

function parse(v) {
  if (!v) return { year: '', month: '', day: '' }
  const parts = v.split('-')
  return {
    year:  parseInt(parts[0]) || '',
    month: parseInt(parts[1]) || '',
    day:   parseInt(parts[2]) || '',
  }
}

/**
 * Replaces <input type="date"> with three selects (Month / Day / Year).
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
  const days = Array.from({ length: maxDay }, (_, i) => i + 1)

  function update(y, m, d) {
    setInternal({ year: y, month: m, day: d })
    if (y && m && d) {
      onChange(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    } else {
      onChange('')
    }
  }

  return (
    <div className={`flex gap-1.5 ${className}`}>
      {/* Month */}
      <select
        value={internal.month}
        onChange={e => update(internal.year, Number(e.target.value) || '', internal.day)}
        required={required}
        className={`flex-[3] ${SEL}`}
      >
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={i + 1} value={i + 1}>{name}</option>
        ))}
      </select>

      {/* Day */}
      <select
        value={internal.day}
        onChange={e => update(internal.year, internal.month, Number(e.target.value) || '')}
        required={required}
        className={`flex-[1.5] ${SEL}`}
      >
        <option value="">Day</option>
        {days.map(n => <option key={n} value={n}>{n}</option>)}
      </select>

      {/* Year */}
      <select
        value={internal.year}
        onChange={e => update(Number(e.target.value) || '', internal.month, internal.day)}
        required={required}
        className={`flex-[2] ${SEL}`}
      >
        <option value="">Year</option>
        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}
