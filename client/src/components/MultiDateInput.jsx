import { useState } from 'react'

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function toValue({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function fmtShort(v) {
  const [y, m, d] = v.split('-').map(Number)
  return `${MONTH_LABELS[m - 1].slice(0, 3)} ${d}`
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function todayParts() {
  const t = new Date()
  return { year: t.getFullYear(), month: t.getMonth() + 1, day: t.getDate() }
}

/**
 * Always-open calendar for picking several dates at once — click a date to toggle it
 * in/out, browse months without losing earlier picks, selected dates show as a chip
 * list (with individual remove) below.
 * value    — array of 'YYYY-MM-DD' strings
 * onChange — called with the updated array
 */
export default function MultiDateInput({ value = [], onChange }) {
  const t = todayParts()
  const [viewYear, setViewYear] = useState(t.year)
  const [viewMonth, setViewMonth] = useState(t.month)
  const selected = new Set(value)

  function changeMonth(delta) {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    setViewMonth(m)
    setViewYear(y)
  }

  function toggle(day) {
    const v = toValue({ year: viewYear, month: viewMonth, day })
    onChange(selected.has(v) ? value.filter(d => d !== v) : [...value, v].sort())
  }

  function remove(v) {
    onChange(value.filter(d => d !== v))
  }

  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay()
  const numDays = daysInMonth(viewYear, viewMonth)
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: numDays }, (_, i) => i + 1)]

  return (
    <div>
      <div className="border border-gray-200 rounded-xl p-3 bg-white">
        <div className="flex items-center justify-between mb-2">
          <button type="button" onClick={() => changeMonth(-1)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">‹</button>
          <span className="text-sm font-semibold text-gray-800">
            {MONTH_LABELS[viewMonth - 1]} {viewYear}
          </span>
          <button type="button" onClick={() => changeMonth(1)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_LABELS.map((w, i) => (
            <div key={i} className="text-[10px] font-medium text-gray-400 text-center">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day === null) return <div key={i} />
            const v = toValue({ year: viewYear, month: viewMonth, day })
            const isSelected = selected.has(v)
            const isToday = t.year === viewYear && t.month === viewMonth && t.day === day
            return (
              <button
                key={i} type="button" onClick={() => toggle(day)}
                className={`w-8 h-8 text-xs rounded-lg flex items-center justify-center transition-colors
                  ${isSelected ? 'bg-gray-900 text-white font-semibold'
                    : isToday ? 'border border-gray-400 text-gray-800'
                    : 'text-gray-700 hover:bg-gray-100'}`}
              >
                {day}
              </button>
            )
          })}
        </div>
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {value.map(v => (
            <span key={v} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full pl-2.5 pr-1.5 py-1">
              {fmtShort(v)}
              <button type="button" onClick={() => remove(v)} className="text-gray-400 hover:text-red-500 leading-none">×</button>
            </span>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-1.5">
        Click dates to add or remove them{value.length > 0 ? ` — ${value.length} selected` : ''}.
      </p>
    </div>
  )
}
