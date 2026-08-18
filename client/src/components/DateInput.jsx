import { useEffect, useRef, useState } from 'react'

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function parse(v) {
  if (!v) return null
  const [y, m, d] = String(v).split('-').map(Number)
  if (!y || !m || !d) return null
  return { year: y, month: m, day: d }
}

function toValue({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function fmt(parsed) {
  if (!parsed) return ''
  return `${MONTH_LABELS[parsed.month - 1].slice(0, 3)} ${parsed.day}, ${parsed.year}`
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/**
 * Click-to-open calendar popover — replaces both the native
 * <input type="date"> (whose browser calendar popup covered the rest of the
 * form) and an earlier typed MM/DD/YYYY version (no visual calendar at all).
 * The popover is anchored under the field and sized to itself, so it only
 * overlaps the space right below the field, not the rest of the form.
 * value    — YYYY-MM-DD string, or ''
 * onChange — called with YYYY-MM-DD string, or '' when cleared
 */
export default function DateInput({ value = '', onChange, required = false, className = '' }) {
  const selected = parse(value)
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(() => (selected || todayParts()).year)
  const [viewMonth, setViewMonth] = useState(() => (selected || todayParts()).month)
  const wrapRef = useRef(null)

  function todayParts() {
    const t = new Date()
    return { year: t.getFullYear(), month: t.getMonth() + 1, day: t.getDate() }
  }

  useEffect(() => {
    if (!open) return
    const base = selected || todayParts()
    setViewYear(base.year)
    setViewMonth(base.month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function changeMonth(delta) {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    setViewMonth(m)
    setViewYear(y)
  }

  function pick(day) {
    onChange(toValue({ year: viewYear, month: viewMonth, day }))
    setOpen(false)
  }

  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay()
  const numDays = daysInMonth(viewYear, viewMonth)
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: numDays }, (_, i) => i + 1)]
  const t = todayParts()

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-left bg-white focus:outline-none focus:ring-2 focus:ring-gray-300 flex items-center justify-between gap-2"
      >
        <span className={selected ? 'text-gray-900' : 'text-gray-400'}>
          {selected ? fmt(selected) : 'Select date'}
        </span>
        <span className="text-gray-400">📅</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-64">
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
              const isSelected = selected && selected.year === viewYear && selected.month === viewMonth && selected.day === day
              const isToday = t.year === viewYear && t.month === viewMonth && t.day === day
              return (
                <button
                  key={i} type="button" onClick={() => pick(day)}
                  className={`w-7 h-7 text-xs rounded-lg flex items-center justify-center
                    ${isSelected ? 'bg-gray-900 text-white font-semibold'
                      : isToday ? 'border border-gray-400 text-gray-800'
                      : 'text-gray-700 hover:bg-gray-100'}`}
                >
                  {day}
                </button>
              )
            })}
          </div>
          {selected && (
            <button type="button" onClick={() => { onChange(''); setOpen(false) }}
              className="mt-2 text-xs text-gray-400 hover:text-gray-600">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
