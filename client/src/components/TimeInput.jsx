import { useEffect, useState } from 'react'

const BOX = 'border border-gray-300 rounded-lg px-2 py-2 text-sm text-center w-14 focus:outline-none focus:ring-2 focus:ring-gray-300'

function parse(v) {
  if (!v) return { hour: '', minute: '', meridiem: 'AM' }
  const [h, m] = String(v).split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return { hour: '', minute: '', meridiem: 'AM' }
  const meridiem = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return { hour, minute: m, meridiem }
}

/**
 * Always-AM/PM time entry, plain number fields + toggle buttons — no native
 * <input type="time"> (locale-dependent 24h display) and no dropdown/select
 * that opens an overlay over the rest of the form.
 * value    — 24-hour "HH:MM" string, or ''
 * onChange — called with 24-hour "HH:MM" string, or '' when incomplete
 */
export default function TimeInput({ value = '', onChange, required = false, className = '' }) {
  const [internal, setInternal] = useState(() => parse(value))

  useEffect(() => {
    setInternal(parse(value))
  }, [value])

  function update(hour, minute, meridiem) {
    setInternal({ hour, minute, meridiem })
    if (hour === '' || minute === '') { onChange(''); return }
    let h24 = Number(hour) % 12
    if (meridiem === 'PM') h24 += 12
    onChange(`${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  }

  function onHour(e) {
    let h = e.target.value.replace(/\D/g, '')
    if (h !== '') h = Math.min(12, Math.max(1, Number(h)))
    update(h, internal.minute, internal.meridiem)
  }

  function onMinute(e) {
    let m = e.target.value.replace(/\D/g, '')
    if (m !== '') m = Math.min(59, Math.max(0, Number(m)))
    update(internal.hour, m, internal.meridiem)
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <input
        type="text" inputMode="numeric" placeholder="HH" required={required}
        value={internal.hour} onChange={onHour}
        className={BOX}
      />
      <span className="text-gray-400 font-semibold">:</span>
      <input
        type="text" inputMode="numeric" placeholder="MM" required={required}
        value={internal.minute === '' ? '' : String(internal.minute).padStart(2, '0')}
        onChange={onMinute}
        className={BOX}
      />
      <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs font-medium">
        {['AM', 'PM'].map(p => (
          <button
            key={p} type="button"
            onClick={() => update(internal.hour, internal.minute, p)}
            className={`px-2.5 py-2 ${internal.meridiem === p ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
