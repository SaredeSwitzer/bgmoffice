import { useEffect, useState } from 'react'
import { api } from '../api/client'
import CollapsibleSection from './CollapsibleSection'

// What each shift sent Sarede when they finished: which of the seven steps they got
// through, what was still outstanding at the time, and anything they wanted to say.
//
// Only she sees this — the server checks independently, this just decides whether to
// render. Not marked read on load: opening My Tasks shouldn't clear the "new" flag on a
// summary she hasn't actually looked at.

function fmtWhen(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const COUNT_LABELS = {
  tasks: 'tasks',
  mentions: 'mentions',
  overdue_reminders: 'overdue reminders',
  anyone: 'up for grabs',
}

function Summary({ row, onRead }) {
  const [open, setOpen] = useState(!row.read_at)
  const steps = row.steps || []
  const doneCount = steps.filter(s => s.done).length
  const missed = steps.filter(s => !s.done)
  const leftovers = Object.entries(row.counts || {}).filter(([, n]) => Number(n) > 0)

  return (
    <div className={`rounded-xl border px-4 py-3 ${row.read_at ? 'border-gray-200 bg-white' : 'border-blue-300 bg-blue-50/40'}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="flex flex-wrap items-baseline gap-2 min-w-0">
          <span className="text-sm font-semibold text-gray-900">
            {row.author_name || row.author}
          </span>
          <span className="text-xs text-gray-400">{fmtWhen(row.created_at)}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
            doneCount === steps.length ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'
          }`}>
            {doneCount} of {steps.length}
          </span>
        </span>
        {!row.read_at && (
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-blue-600 text-white px-2 py-0.5 rounded-full">
            New
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {missed.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-800 mb-1">Didn&rsquo;t get to</p>
              <ul className="text-sm text-gray-700 list-disc pl-5">
                {missed.map(s => <li key={s.key}>{s.title}</li>)}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-green-700">Got through everything.</p>
          )}

          {leftovers.length > 0 && (
            <p className="text-xs text-gray-500">
              Still outstanding when they finished:{' '}
              {leftovers.map(([k, n]) => `${n} ${COUNT_LABELS[k] || k}`).join(', ')}.
            </p>
          )}

          {row.note && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">They said</p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{row.note}</p>
            </div>
          )}

          {!row.read_at && (
            <button onClick={() => onRead(row.id)}
              className="px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-700">
              ✓ Read
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function ShiftSummaries({ id = 'mytasks_shift_summaries' }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    api.getShiftReports().then(setRows).catch(() => setRows([]))
  }, [])

  async function markRead(reportId) {
    const updated = await api.markShiftReportRead(reportId)
    setRows(rs => rs.map(r => (String(r.id) === String(updated.id) ? updated : r)))
  }

  if (!rows || rows.length === 0) return null
  const unread = rows.filter(r => !r.read_at).length

  return (
    <CollapsibleSection
      id={id} accent="purple" title="🗒 Shift summaries"
      count={unread} defaultOpen={unread > 0}
    >
      <div className="space-y-2">
        {rows.slice(0, 12).map(row => (
          <Summary key={row.id} row={row} onRead={markRead} />
        ))}
      </div>
    </CollapsibleSection>
  )
}
