import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

// Weekly recurring CC billing — review then charge. The amounts are computed live
// from the schedule (class_sessions), so updating the schedule updates this. Nothing
// is charged until the user reviews and clicks Charge.
//
// Also holds the Weekly Report tab: revenue / instructor-pay totals for accounting,
// and a per-instructor payroll breakdown — both read-only, computed live from the
// same calendar data.

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function startOfWeek(d) { return addDays(d, -d.getDay()) }
function money(v) { return `$${(Number(v) || 0).toFixed(2)}` }

// Builds a CSV file client-side and triggers a browser download — no server round trip.
function downloadCsv(filename, headers, rows) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers, ...rows].map(row => row.map(esc).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

const CLIENT_STATUSES = ['charged', 'declined', 'unpaid', 'pending']
const INSTRUCTOR_STATUSES = ['paid', 'unpaid']
const STATUS_COLORS = {
  charged: 'bg-green-50 text-green-700 border-green-200',
  paid:    'bg-green-50 text-green-700 border-green-200',
  declined: 'bg-red-50 text-red-700 border-red-200',
  unpaid:  'bg-amber-50 text-amber-700 border-amber-200',
  pending: 'bg-gray-50 text-gray-500 border-gray-200',
}

function SortableTh({ col, label: text, sortCol, sortDir, onSort, className = '' }) {
  const active = sortCol === col
  return (
    <th onClick={() => onSort(col)}
      className={`px-2 py-1.5 font-semibold cursor-pointer select-none hover:text-gray-700 whitespace-nowrap ${className}`}>
      {text}
      <span className="ml-0.5 inline-block w-2.5 text-gray-300">{active ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
    </th>
  )
}

function ReportTab({ weekStart, weekEnd, label }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filterClient, setFilterClient] = useState('')
  const [filterInstructor, setFilterInstructor] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [sortCol, setSortCol] = useState('session_date')
  const [sortDir, setSortDir] = useState('asc')

  const load = useCallback(() => {
    setLoading(true)
    api.getBillingReport(ymd(weekStart)).then(setReport).catch(() => setReport(null)).finally(() => setLoading(false))
  }, [weekStart.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])
  useEffect(() => { setFilterClient(''); setFilterInstructor(''); setFilterMethod('') }, [weekStart.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  async function updateClientStatus(r, status) {
    await api.setClientPaymentStatus({ client_id: r.client_id, week_start: ymd(weekStart), status, amount: r.amount })
    load()
  }
  async function updateInstructorStatus(r, status) {
    await api.setInstructorPaymentStatus({ instructor_id: r.instructor_id, week_start: ymd(weekStart), status, amount: r.total_pay })
    load()
  }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  if (loading) return <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
  if (!report) return <p className="text-gray-400 text-sm text-center py-8">Could not load the report.</p>

  const weekTag = `${ymd(weekStart)}_to_${ymd(weekEnd)}`

  const clientOptions = [...new Map(report.sessions.map(s => [s.client_id, s.client_name])).entries()]
  const instructorOptions = [...new Map(report.sessions.filter(s => s.instructor_id).map(s => [s.instructor_id, s.instructor_name])).entries()]
  const methodOptions = [...new Set(report.sessions.map(s => s.payment_method).filter(Boolean))]

  const filteredSessions = report.sessions
    .filter(s => !filterClient || String(s.client_id) === filterClient)
    .filter(s => !filterInstructor || String(s.instructor_id) === filterInstructor)
    .filter(s => !filterMethod || s.payment_method === filterMethod)
    .slice()
    .sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol]
      if (sortCol === 'charge_amount' || sortCol === 'instructor_pay') { av = Number(av) || 0; bv = Number(bv) || 0 }
      else { av = (av || '').toString().toLowerCase(); bv = (bv || '').toString().toLowerCase() }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  const hasFilters = filterClient || filterInstructor || filterMethod

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
          <p className="text-xs text-gray-500">Revenue</p>
          <p className="text-lg font-bold text-gray-900">{money(report.total_revenue)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
          <p className="text-xs text-gray-500">Instructor Pay</p>
          <p className="text-lg font-bold text-gray-900">{money(report.total_instructor_pay)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
          <p className="text-xs text-gray-500">Net</p>
          <p className="text-lg font-bold text-gray-900">{money(report.net)}</p>
        </div>
      </div>

      {report.by_payment_method.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-600">
            Revenue by Payment Method
          </div>
          {report.by_payment_method.map((r, i) => (
            <div key={r.payment_method} className={`flex items-center justify-between px-4 py-2 text-sm ${i > 0 ? 'border-t border-gray-100' : ''}`}>
              <span className="text-gray-700">{r.payment_method}</span>
              <span className="text-gray-500">{r.session_count} class{r.session_count === 1 ? '' : 'es'}</span>
              <span className="font-semibold text-gray-900">{money(r.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-600">Revenue by Client — {label}</span>
          <button
            onClick={() => downloadCsv(`revenue_${weekTag}.csv`, ['Client', 'Classes', 'Amount'],
              report.by_client.map(r => [r.client_name, r.session_count, r.amount]))}
            className="text-xs text-blue-600 hover:underline">Export CSV</button>
        </div>
        {report.by_client.length === 0 ? (
          <p className="text-gray-400 text-xs italic text-center py-6">No classes this week.</p>
        ) : report.by_client.map((r, i) => (
          <div key={r.client_id} className={`flex items-center justify-between gap-2 px-4 py-2 text-sm ${i > 0 ? 'border-t border-gray-100' : ''}`}>
            <Link to={`/clients/${r.client_id}`} className="text-gray-700 hover:underline min-w-0 truncate">{r.client_name}</Link>
            <span className="text-gray-500 shrink-0">{r.session_count} class{r.session_count === 1 ? '' : 'es'}</span>
            <span className="font-semibold text-gray-900 shrink-0">{money(r.amount)}</span>
            <select value={r.charged_status || ''} onChange={e => updateClientStatus(r, e.target.value)}
              className={`shrink-0 text-xs rounded-lg px-1.5 py-1 border ${STATUS_COLORS[r.charged_status] || 'bg-white text-gray-400 border-gray-200'}`}>
              <option value="">— mark —</option>
              {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-600">Payroll by Instructor — {label}</span>
          <button
            onClick={() => downloadCsv(`payroll_${weekTag}.csv`, ['Instructor', 'Classes', 'Total Pay'],
              report.by_instructor.map(r => [r.instructor_name, r.session_count, r.total_pay]))}
            className="text-xs text-blue-600 hover:underline">Export CSV</button>
        </div>
        {report.by_instructor.length === 0 ? (
          <p className="text-gray-400 text-xs italic text-center py-6">No instructor-taught classes this week.</p>
        ) : report.by_instructor.map((r, i) => (
          <div key={r.instructor_id} className={`flex items-center justify-between gap-2 px-4 py-2 text-sm ${i > 0 ? 'border-t border-gray-100' : ''}`}>
            <Link to={`/instructors/${r.instructor_id}`} className="text-gray-700 hover:underline min-w-0 truncate">{r.instructor_name}</Link>
            <span className="text-gray-500 shrink-0">{r.session_count} class{r.session_count === 1 ? '' : 'es'}</span>
            <span className="font-semibold text-gray-900 shrink-0">{money(r.total_pay)}</span>
            <select value={r.paid_status || ''} onChange={e => updateInstructorStatus(r, e.target.value)}
              className={`shrink-0 text-xs rounded-lg px-1.5 py-1 border ${STATUS_COLORS[r.paid_status] || 'bg-white text-gray-400 border-gray-200'}`}>
              <option value="">— mark —</option>
              {INSTRUCTOR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100 gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-600">
            All Classes — {label}
            {hasFilters && <span className="text-gray-400 font-normal"> ({filteredSessions.length} of {report.sessions.length})</span>}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={filterClient} onChange={e => setFilterClient(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 bg-white text-gray-600">
              <option value="">All clients</option>
              {clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={filterInstructor} onChange={e => setFilterInstructor(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 bg-white text-gray-600">
              <option value="">All instructors</option>
              {instructorOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 bg-white text-gray-600">
              <option value="">All methods</option>
              {methodOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {hasFilters && (
              <button onClick={() => { setFilterClient(''); setFilterInstructor(''); setFilterMethod('') }}
                className="text-xs text-gray-400 hover:text-gray-700">✕ clear</button>
            )}
            <button
              onClick={() => downloadCsv(`classes_${weekTag}${hasFilters ? '_filtered' : ''}.csv`,
                ['Date', 'Time', 'Client', 'Instructor', 'Style', 'Charge', 'Instructor Pay', 'Payment Method', 'Status'],
                filteredSessions.map(s => [s.session_date, s.start_time ? s.start_time.slice(0, 5) : '', s.client_name,
                  s.instructor_name || '', s.style || '', s.charge_amount, s.instructor_pay, s.payment_method || '', s.status]))}
              className="text-xs text-blue-600 hover:underline">Export CSV</button>
          </div>
        </div>
        {filteredSessions.length === 0 ? (
          <p className="text-gray-400 text-xs italic text-center py-6">No classes match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wide">
                  <SortableTh col="session_date" label="Date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="pl-4" />
                  <SortableTh col="client_name" label="Client" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortableTh col="instructor_name" label="Instructor" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortableTh col="charge_amount" label="Charge" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
                  <SortableTh col="instructor_pay" label="Pay" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
                  <SortableTh col="payment_method" label="Method" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="pr-4" />
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((s, i) => (
                  <tr key={s.id} className={i > 0 ? 'border-t border-gray-100' : ''}>
                    <td className="px-4 py-1.5 text-gray-500 whitespace-nowrap">
                      {new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {s.start_time ? ` ${s.start_time.slice(0, 5)}` : ''}
                    </td>
                    <td className="px-2 py-1.5 text-gray-800">{s.client_name}</td>
                    <td className="px-2 py-1.5 text-gray-500">{s.instructor_name || '—'}</td>
                    <td className="px-2 py-1.5 text-right text-gray-800">{money(s.charge_amount)}</td>
                    <td className="px-2 py-1.5 text-right text-gray-500">{money(s.instructor_pay)}</td>
                    <td className="px-4 py-1.5 text-gray-400">{s.payment_method || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function BillingPage() {
  const [tab, setTab] = useState('charge') // 'charge' | 'report'
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

  useEffect(() => { if (tab === 'charge') load() }, [tab, load])

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
        <h1 className="text-xl font-bold text-gray-900">Billing</h1>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          {[['charge', 'Charge Cards'], ['report', 'Weekly Report']].map(([key, text]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-3 py-1.5 font-medium ${tab === key ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {text}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => setAnchor(addDays(weekStart, -7))} className="px-2 py-1 rounded text-gray-500 hover:bg-gray-100">‹</button>
          <div className="text-sm font-semibold text-gray-800 min-w-[11rem] text-center">{label}</div>
          <button onClick={() => setAnchor(addDays(weekStart, 7))} className="px-2 py-1 rounded text-gray-500 hover:bg-gray-100">›</button>
          <button onClick={() => setAnchor(startOfWeek(new Date()))} className="ml-1 text-xs text-gray-400 hover:text-gray-700">This week</button>
        </div>
        {tab === 'charge' && (
          <button onClick={load} className="text-xs text-gray-400 hover:text-gray-700">↻ Refresh from schedule</button>
        )}
      </div>

      {tab === 'report' ? (
        <ReportTab weekStart={weekStart} weekEnd={weekEnd} label={label} />
      ) : (
        <>
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
        </>
      )}
    </div>
  )
}
