import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { noteTime } from '../utils/dates'

// Who signed in, when, and how.
//
// The app used to keep one timestamp per person, overwritten every time, so "who actually
// signed in as Claire on Tuesday?" had no answer at all. It still can't stop somebody
// using a code out of a shared inbox — nothing in the app can — but it can make the
// question answerable, which is most of what was wanted.

const METHOD = {
  code:     { label: 'Emailed code', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  password: { label: 'Password',     tone: 'bg-gray-100 text-gray-600 border-gray-200' },
  passkey:  { label: 'Touch ID',     tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  unknown:  { label: 'Unknown',      tone: 'bg-gray-100 text-gray-500 border-gray-200' },
}

export default function LoginHistory() {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open || rows) return
    api.getLoginHistory().then(setRows).catch(() => setRows([]))
  }, [open, rows])

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between text-left">
        <h3 className="font-semibold text-gray-800 text-sm">Recent sign-ins</h3>
        <span className="text-xs text-gray-400">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <>
          <p className="text-[11px] text-gray-400 mt-1">
            Every sign-in, newest first — who, when, and which way they came in.
          </p>

          {rows === null ? (
            <p className="text-sm text-gray-400 italic mt-3">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-400 italic mt-3">
              Nothing recorded yet — this starts from the next time somebody signs in.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {rows.map(r => {
                const m = METHOD[r.method] || METHOD.unknown
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-medium text-gray-800 w-40 truncate">{r.name}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${m.tone}`}>
                      {m.label}
                    </span>
                    <span className="text-xs text-gray-500">{r.device || 'unknown device'}</span>
                    <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">{noteTime(r.created_at)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
