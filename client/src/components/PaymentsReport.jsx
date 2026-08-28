import { useState } from 'react'
import { api } from '../api/client'

const money = n => `$${Number(n || 0).toFixed(2)}`
const fmtDate = ymd => {
  if (!ymd) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Who was charged, when, and how — for a date range. Pulls from both places money is
// recorded: Stripe (the weekly card run, pay-link charges) and invoice_payments (checks,
// cash, Zelle logged in the app). Answering "did this client pay" needed both.
export default function PaymentsReport() {
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [start, setStart] = useState(monthAgo)
  const [end, setEnd] = useState(today)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  async function run(e) {
    e?.preventDefault()
    setLoading(true); setError('')
    try {
      setData(await api.getPaymentsReport(start, end))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={run} className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">From</label>
            <input type="date" value={start} onChange={e => setStart(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">To</label>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <button type="submit" disabled={loading}
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-gray-700 transition-colors">
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
      </form>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {data && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <span className="text-lg font-bold text-gray-900">{money(data.total)}</span>
            <span className="text-sm text-gray-500">
              {data.count} payment{data.count === 1 ? '' : 's'} from {data.clients.length} client{data.clients.length === 1 ? '' : 's'}
            </span>
          </div>

          {data.card_error && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ⚠ Card charges couldn’t be loaded ({data.card_error}), so this shows only payments recorded in the app.
            </p>
          )}

          {data.clients.length === 0 ? (
            <p className="text-sm italic text-gray-400">No payments in this range.</p>
          ) : (
            <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
              {data.clients.map(c => (
                <div key={c.client_name}>
                  <button type="button" onClick={() => setOpen(open === c.client_name ? null : c.client_name)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50">
                    <span className="min-w-0 truncate text-sm font-medium text-gray-900">{c.client_name}</span>
                    <span className="shrink-0 text-xs text-gray-400">
                      {c.payments.length} payment{c.payments.length === 1 ? '' : 's'}
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-gray-800">{money(c.total)}</span>
                  </button>
                  {open === c.client_name && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-2">
                      {c.payments.map((p, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 py-1 text-xs">
                          <span className="text-gray-600">{fmtDate(p.date)}</span>
                          <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-gray-200">
                            {p.method}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-gray-400">
                            {p.invoice_number || p.note || ''}
                          </span>
                          <span className="font-semibold text-gray-800">{money(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
