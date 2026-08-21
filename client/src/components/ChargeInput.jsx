import { useEffect, useState } from 'react'

// A single "Charge to client" field that accepts a plain number OR free text (TBD, a
// range like "$80-100", etc). Behind the scenes there are still two separate fields —
// charge_amount (numeric) and charge_note (text) — because charge_amount feeds real
// billing math (summed for revenue totals, used as the actual Stripe line-item price in
// dailySync.js); letting non-numeric text land there risks a SQL error at best and a
// miscalculated charge at worst. This component hides that split: on blur, whatever was
// typed gets classified as a clean number (→ charge_amount) or anything else (→
// charge_note), so staff just type into the one field.
export default function ChargeInput({ amount, note, onChange, placeholder = 'e.g. 95, TBD, $80–100', py = 'py-2' }) {
  const [text, setText] = useState(() => note || (amount ?? ''))

  useEffect(() => {
    setText(note || (amount ?? ''))
  }, [amount, note])

  function commit() {
    const cleaned = text.trim()
    const numeric = cleaned.replace(/^\$/, '')
    if (cleaned === '') {
      onChange({ amount: '', note: '' })
    } else if (/^\d+(\.\d{1,2})?$/.test(numeric)) {
      onChange({ amount: numeric, note: '' })
    } else {
      onChange({ amount: '', note: cleaned })
    }
  }

  return (
    <input
      type="text"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      placeholder={placeholder}
      className={`w-full border border-gray-300 rounded-lg px-3 ${py} text-sm`}
    />
  )
}
