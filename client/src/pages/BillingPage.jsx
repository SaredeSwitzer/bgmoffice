import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

// Weekly recurring CC billing — review then charge. The amounts are computed live
// from the schedule (class_sessions), so updating the schedule updates this. Nothing
// is charged until the user reviews and clicks Charge.

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function startOfWeek(d) { return addDays(d, -d.getDay()) }
function money(v) { return `$${(Number(v) || 0).toFixed(2)}` }

export default function BillingPage() {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()))
  const weekStart = startOfWeek(anchor)
  const weekEnd = addDays(weekStart, 6)

  const [rows, setRows] = useState([])       // { client_id, client_name, amount(edited), session_count, card_last4, has_card, charged_status, include }
  const [loading, setLoading] = useState(true)
  const [charging, setCharging] = useState(false)
  const [results, setResults] = useState(null)

  const load = useCallback(() => {
    setLoading(true); setResults(null)
    api.getBillingWeek(ymd(weekStart)).then(({ items }) => {
      setRows((items || []).map(it => ({
        ...it,
        amount: Number(it.amount) || 0,
        include: it.has_card && it.charged_status !== 'charged',
      })))
    }).catch(() => setRows([])).finally(() => setLoading(false))
  }, [weekStart.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  function patch(id, changes) {
    setRows(prev => prev.map(r => r.client_id === id ? { ...r, ...changes } : r))
  }

  const selected = rows.filter(r => r.include && r.has_card && r.charged_status !== 'charged')
  const selectedTotal = selected.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const needCard = rows.filter(r => !r.has_card && r.charged_status !== 'charged')

  async function charge() {
    if (!selected.length) return
    if (!confirm(`Charge ${selected.length} client${selected.length === 1 ? '' : 's'} a total of ${money(selectedTotal)}?`)) return
    setCharging(true)
    try {
      const r = await api.chargeBilling(ymd(weekStart), selected.map(s => ({
        client_id: s.client_id, amount: Number(s.amount), session_count: s.session_count,
      })))
      setResults(r.results || [])
      load()
    } catch (e) {
      alert(e.message || 'Charge failed')
    } finally {
      setCharging(false)
    }
  }

  const label = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Weekly CC Billing</h1>
      </div>

      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => setAnchor(addDays(weekStart, -7))} className="px-2 py-1 rounded text-gray-500 hover:bg-gray-100">‹</button>
          <div className="text-sm font-semibold text-gray-800 min-w-[11rem] text-center">{label}</div>
          <button onClick={() => setAnchor(addDays(weekStart, 7))} className="px-2 py-1 rounded text-gray-500 hover:bg-gray-100">›</button>
          <button onClick={() => setAnchor(startOfWeek(new Date()))} className="ml-1 text-xs text-gray-400 hover:text-gray-700">This week</button>
        </div>
        <button onClick={load} className="text-xs text-gray-400 hover:text-gray-700">↻ Refresh from schedule</button>
      </div>

      {results && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-1">
          <p className="text-sm font-semibold text-gray-800 mb-2">Charge results</p>
          {results.map(r => (
            <div key={r.client_id} className="flex justify-between text-sm">
              <span className="text-gray-700">{r.client_name}</span>
              <span className={r.status === 'charged' ? 'text-green-600' : r.status === 'skipped' ? 'text-gray-400' : 'text-red-600'}>
                {r.status === 'charged' ? `charged ${money(r.amount)}` : r.status === 'skipped' ? 'skipped' : `failed — ${r.error}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-400 text-sm italic text-center py-10">
          No credit-card classes this week. (Only classes with payment method “Credit Card” in the schedule show here.)
        </p>
      ) : (
        <>
          {needCard.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
              {needCard.length} client{needCard.length === 1 ? '' : 's'} have CC classes but no card on file yet — open their profile to send a “save card” link or key a card.
            </div>
          )}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {rows.map((r, i) => {
              const done = r.charged_status === 'charged'
              return (
                <div key={r.client_id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-100' : ''} ${done ? 'bg-green-50/40' : ''}`}>
                  <input type="checkbox" disabled={!r.has_card || done}
                    checked={r.include && r.has_card && !done}
                    onChange={e => patch(r.client_id, { include: e.target.checked })}
                    className="w-4 h-4 shrink-0 disabled:opacity-30" />
                  <div className="flex-1 min-w-0">
                    <Link to={`/clients/${r.client_id}`} className="text-sm font-semibold text-gray-900 hover:underline truncate block">{r.client_name}</Link>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {r.session_count} class{r.session_count === 1 ? '' : 'es'}
                      {' · '}
                      {done ? <span className="text-green-600 font-medium">charged {money(r.charged_amount)}</span>
                        : r.has_card ? <span>{r.card_brand ? `${r.card_brand} ` : ''}•••• {r.card_last4}</span>
                        : <span className="text-amber-600 font-medium">no card on file</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-gray-400 text-sm">$</span>
                    <input type="number" step="1" value={r.amount} disabled={done}
                      onChange={e => patch(r.client_id, { amount: e.target.value })}
                      className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right disabled:bg-gray-50 disabled:text-gray-400" />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm sticky bottom-2">
            <div className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{selected.length}</span> selected ·
              <span className="font-semibold text-gray-900"> {money(selectedTotal)}</span>
            </div>
            <button onClick={charge} disabled={charging || !selected.length}
              className="px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-40">
              {charging ? 'Charging…' : `Charge ${selected.length || ''} card${selected.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
