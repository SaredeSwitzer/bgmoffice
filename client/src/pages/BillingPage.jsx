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
  const [clientSortCol, setClientSortCol] = useState('amount')
  const [clientSortDir, setClientSortDir] = useState('desc')
  const [expandedClients, setExpandedClients] = useState(new Set())
  const [checkedClients, setCheckedClients] = useState(new Set())
  const [checkedInstructors, setCheckedInstructors] = useState(new Set())
  const [bulkClientStatus, setBulkClientStatus] = useState('charged')
  const [bulkInstructorStatus, setBulkInstructorStatus] = useState('paid')
  const [bulkApplying, setBulkApplying] = useState(false)
  const [payoutCopied, setPayoutCopied] = useState(false)
  const [payoutCopyError, setPayoutCopyError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    api.getBillingReport(ymd(weekStart)).then(setReport).catch(() => setReport(null)).finally(() => setLoading(false))
  }, [weekStart.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])
  useEffect(() => {
    setFilterClient(''); setFilterInstructor(''); setFilterMethod('')
    setCheckedClients(new Set()); setCheckedInstructors(new Set())
  }, [weekStart.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  async function updateClientStatus(r, status) {
    await api.setClientPaymentStatus({ client_id: r.client_id, week_start: ymd(weekStart), status, amount: r.amount })
    load()
  }
  async function updateInstructorStatus(r, status) {
    await api.setInstructorPaymentStatus({ instructor_id: r.instructor_id, week_start: ymd(weekStart), status, amount: r.total_pay })
    load()
  }

  function toggleExpandedClient(id) {
    setExpandedClients(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function handleClientSort(col) {
    if (clientSortCol === col) setClientSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setClientSortCol(col); setClientSortDir(col === 'client_name' || col === 'payment_method' ? 'asc' : 'desc') }
  }
  function clientSortArrow(col) {
    return clientSortCol === col ? (clientSortDir === 'asc' ? '↑' : '↓') : ''
  }

  function toggleClientChecked(id) {
    setCheckedClients(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllClientsChecked() {
    setCheckedClients(prev =>
      prev.size === report.by_client.length ? new Set() : new Set(report.by_client.map(r => r.client_id)))
  }
  async function applyBulkClientStatus() {
    setBulkApplying(true)
    try {
      const targets = report.by_client.filter(r => checkedClients.has(r.client_id))
      await Promise.all(targets.map(r =>
        api.setClientPaymentStatus({ client_id: r.client_id, week_start: ymd(weekStart), status: bulkClientStatus, amount: r.amount })))
      setCheckedClients(new Set())
      load()
    } finally {
      setBulkApplying(false)
    }
  }

  // A quick, pasteable list of everyone still owed pay this week, with the exact amount
  // and how to reach them — so checking off Zelle/Venmo/PayPal requests one by one is
  // eyeballing against this instead of re-deriving each number from scratch.
  async function copyPayoutList() {
    const unpaid = report.by_instructor.filter(r => r.paid_status !== 'paid')
    const lines = unpaid.map(r => {
      const via = r.payout_method
        ? `${r.payout_method}${r.payout_handle ? `: ${r.payout_handle}` : ''}`
        : 'no payout info on file'
      return `${r.instructor_name} — ${money(r.total_pay)} — ${via}`
    })
    const text = [`BGM Payroll — ${label}`, '', ...(lines.length ? lines : ['Everyone is marked paid.'])].join('\n')
    setPayoutCopyError('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      // navigator.clipboard.writeText can hang forever (never resolve OR reject) in some
      // embedded/automated browser contexts instead of failing cleanly — race it against a
      // timeout so the button always ends up in a definite state instead of stuck silently.
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 1500)),
      ])
    } catch {
      // Fallback for browsers/contexts that block navigator.clipboard (e.g. no clipboard
      // permission granted) — the old execCommand path still works inside a user click.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus(); ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (!ok) { setPayoutCopyError('Could not copy — your browser blocked clipboard access.'); return }
    }
    setPayoutCopied(true)
    setTimeout(() => setPayoutCopied(false), 2000)
  }

  function toggleInstructorChecked(id) {
    setCheckedInstructors(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllInstructorsChecked() {
    setCheckedInstructors(prev =>
      prev.size === report.by_instructor.length ? new Set() : new Set(report.by_instructor.map(r => r.instructor_id)))
  }
  async function applyBulkInstructorStatus() {
    setBulkApplying(true)
    try {
      const targets = report.by_instructor.filter(r => checkedInstructors.has(r.instructor_id))
      await Promise.all(targets.map(r =>
        api.setInstructorPaymentStatus({ instructor_id: r.instructor_id, week_start: ymd(weekStart), status: bulkInstructorStatus, amount: r.total_pay })))
      setCheckedInstructors(new Set())
      load()
    } finally {
      setBulkApplying(false)
    }
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

  // Payment method(s) + the individual class dates behind each client's revenue row —
  // derived from the same session list the "All Classes" table uses, so no extra fetch.
  const sessionsByClient = report.sessions.reduce((acc, s) => {
    (acc[s.client_id] ||= []).push(s)
    return acc
  }, {})
  const byClientWithMethods = report.by_client.map(r => {
    const clientSessions = (sessionsByClient[r.client_id] || [])
      .slice()
      .sort((a, b) => a.session_date.localeCompare(b.session_date))
    const methods = [...new Set(clientSessions.map(s => s.payment_method).filter(Boolean))]
    return { ...r, payment_methods: methods, payment_method_label: methods.join(', ') || '—', clientSessions }
  })
  const sortedByClient = byClientWithMethods.slice().sort((a, b) => {
    let av, bv
    if (clientSortCol === 'amount') { av = Number(a.amount) || 0; bv = Number(b.amount) || 0 }
    else if (clientSortCol === 'session_count') { av = a.session_count; bv = b.session_count }
    else if (clientSortCol === 'payment_method') { av = a.payment_method_label.toLowerCase(); bv = b.payment_method_label.toLowerCase() }
    else { av = a.client_name.toLowerCase(); bv = b.client_name.toLowerCase() }
    if (av < bv) return clientSortDir === 'asc' ? -1 : 1
    if (av > bv) return clientSortDir === 'asc' ? 1 : -1
    return 0
  })

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
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100 gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-600">Revenue by Client — {label}</span>
          <div className="flex items-center gap-2 flex-wrap">
            {checkedClients.size > 0 && (
              <>
                <select value={bulkClientStatus} onChange={e => setBulkClientStatus(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 bg-white text-gray-600">
                  {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={applyBulkClientStatus} disabled={bulkApplying}
                  className="text-xs font-semibold bg-gray-900 text-white rounded-lg px-2.5 py-1 hover:bg-gray-700 disabled:opacity-50">
                  {bulkApplying ? 'Applying…' : `Mark ${checkedClients.size} Selected`}
                </button>
              </>
            )}
            <button
              onClick={() => downloadCsv(`revenue_${weekTag}.csv`, ['Client', 'Classes', 'Amount', 'Payment Method'],
                byClientWithMethods.map(r => [r.client_name, r.session_count, r.amount, r.payment_method_label]))}
              className="text-xs text-blue-600 hover:underline">Export CSV</button>
          </div>
        </div>
        {report.by_client.length === 0 ? (
          <p className="text-gray-400 text-xs italic text-center py-6">No classes this week.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-100">
              <label className="flex items-center gap-2 text-xs text-gray-400 select-none cursor-pointer">
                <input type="checkbox" checked={checkedClients.size === report.by_client.length} onChange={toggleAllClientsChecked} />
                {checkedClients.size === report.by_client.length ? 'Uncheck all' : 'Check all'}
              </label>
              <span className="flex-1" />
              <span className="text-[11px] text-gray-400">Sort by:</span>
              {[['client_name', 'Client'], ['payment_method', 'Method'], ['session_count', 'Classes'], ['amount', 'Amount']].map(([col, text]) => (
                <button key={col} onClick={() => handleClientSort(col)}
                  className={`text-[11px] font-semibold uppercase tracking-wide hover:text-gray-700 ${clientSortCol === col ? 'text-gray-700' : 'text-gray-400'}`}>
                  {text} {clientSortArrow(col)}
                </button>
              ))}
            </div>
            {sortedByClient.map((r, i) => {
              const expanded = expandedClients.has(r.client_id)
              return (
                <div key={r.client_id} className={i > 0 ? 'border-t border-gray-100' : ''}>
                  <div
                    onClick={() => toggleExpandedClient(r.client_id)}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-sm cursor-pointer hover:bg-gray-50">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <input type="checkbox" checked={checkedClients.has(r.client_id)}
                        onClick={e => e.stopPropagation()}
                        onChange={() => toggleClientChecked(r.client_id)} />
                      <span className="text-gray-400 w-3 shrink-0 text-center">{expanded ? '▾' : '▸'}</span>
                      <Link to={`/clients/${r.client_id}`} onClick={e => e.stopPropagation()}
                        className="text-gray-700 hover:underline min-w-0 truncate">{r.client_name}</Link>
                    </div>
                    <span className="text-gray-400 text-xs shrink-0 w-28 truncate hidden sm:inline-block">{r.payment_method_label}</span>
                    <span className="text-gray-500 shrink-0">{r.session_count} class{r.session_count === 1 ? '' : 'es'}</span>
                    <span className="font-semibold text-gray-900 shrink-0">{money(r.amount)}</span>
                    <select value={r.charged_status || ''} onChange={e => updateClientStatus(r, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      className={`shrink-0 text-xs rounded-lg px-1.5 py-1 border ${STATUS_COLORS[r.charged_status] || 'bg-white text-gray-400 border-gray-200'}`}>
                      <option value="">— mark —</option>
                      {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {expanded && (
                    <div className="bg-gray-50 px-4 py-2 pl-11 space-y-1 border-t border-gray-100">
                      {r.clientSessions.map(s => (
                        <div key={s.id} className="flex items-center justify-between gap-2 text-xs text-gray-500">
                          <span className="truncate">
                            {new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            {s.start_time ? ` · ${s.start_time.slice(0, 5)}` : ''}
                            {s.style ? ` · ${s.style}` : ''}
                            {s.instructor_name ? ` · ${s.instructor_name}` : ''}
                          </span>
                          <span className="flex items-center gap-3 shrink-0">
                            <span>{s.payment_method || '—'}</span>
                            <span className="text-gray-700 font-medium">{money(s.charge_amount)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100 gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-600">Payroll by Instructor — {label}</span>
          <div className="flex items-center gap-2 flex-wrap">
            {checkedInstructors.size > 0 && (
              <>
                <select value={bulkInstructorStatus} onChange={e => setBulkInstructorStatus(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 bg-white text-gray-600">
                  {INSTRUCTOR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={applyBulkInstructorStatus} disabled={bulkApplying}
                  className="text-xs font-semibold bg-gray-900 text-white rounded-lg px-2.5 py-1 hover:bg-gray-700 disabled:opacity-50">
                  {bulkApplying ? 'Applying…' : `Mark ${checkedInstructors.size} Selected`}
                </button>
              </>
            )}
            <button onClick={copyPayoutList} className="text-xs text-blue-600 hover:underline">
              {payoutCopied ? 'Copied ✓' : '📋 Copy Payout List'}
            </button>
            {payoutCopyError && <span className="text-xs text-red-600">{payoutCopyError}</span>}
            <button
              onClick={() => downloadCsv(`payroll_${weekTag}.csv`, ['Instructor', 'Classes', 'Total Pay', 'Paid Via', 'Payout Handle'],
                report.by_instructor.map(r => [r.instructor_name, r.session_count, r.total_pay, r.payout_method || '', r.payout_handle || '']))}
              className="text-xs text-blue-600 hover:underline">Export CSV</button>
          </div>
        </div>
        {report.by_instructor.length === 0 ? (
          <p className="text-gray-400 text-xs italic text-center py-6">No instructor-taught classes this week.</p>
        ) : (
          <>
            {report.by_instructor.some(r => r.paid_status !== 'paid' && !r.payout_method) && (
              <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-800">
                Some unpaid instructors don't have a payout method on file — open their profile to add one.
              </div>
            )}
            <label className="flex items-center gap-2 px-4 py-1.5 text-xs text-gray-400 select-none cursor-pointer border-b border-gray-100">
              <input type="checkbox" checked={checkedInstructors.size === report.by_instructor.length} onChange={toggleAllInstructorsChecked} />
              {checkedInstructors.size === report.by_instructor.length ? 'Uncheck all' : 'Check all'}
            </label>
            {report.by_instructor.map((r, i) => (
              <div key={r.instructor_id} className={`flex items-center justify-between gap-2 px-4 py-2 text-sm ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <input type="checkbox" checked={checkedInstructors.has(r.instructor_id)} onChange={() => toggleInstructorChecked(r.instructor_id)} />
                  <div className="min-w-0">
                    <Link to={`/instructors/${r.instructor_id}`} className="text-gray-700 hover:underline truncate block">{r.instructor_name}</Link>
                    <span className="text-xs text-gray-400 truncate block">
                      {r.payout_method ? `${r.payout_method}${r.payout_handle ? ` · ${r.payout_handle}` : ''}` : (
                        <span className="text-amber-600">no payout method on file</span>
                      )}
                    </span>
                  </div>
                </div>
                <span className="text-gray-500 shrink-0">{r.session_count} class{r.session_count === 1 ? '' : 'es'}</span>
                <span className="font-semibold text-gray-900 shrink-0">{money(r.total_pay)}</span>
                <select value={r.paid_status || ''} onChange={e => updateInstructorStatus(r, e.target.value)}
                  className={`shrink-0 text-xs rounded-lg px-1.5 py-1 border ${STATUS_COLORS[r.paid_status] || 'bg-white text-gray-400 border-gray-200'}`}>
                  <option value="">— mark —</option>
                  {INSTRUCTOR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            ))}
          </>
        )}
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

  const [previewing, setPreviewing] = useState(false)
  const [syncPreview, setSyncPreview] = useState(null)  // dry-run result, reviewed/applied row by row
  const [syncError, setSyncError] = useState('')
  const [applyingRow, setApplyingRow] = useState(null)  // `inv-${client_id}` | `pkg-${client_id}` currently in flight
  const [appliedRows, setAppliedRows] = useState(() => new Set())  // rowKeys just committed this session, so a re-shown "updated" preview row reads as done, not still-pending

  async function previewSync() {
    setPreviewing(true); setSyncError(''); setSyncPreview(null); setAppliedRows(new Set())
    try {
      const r = await api.syncBillingWeek(ymd(weekStart), true)
      setSyncPreview(r)
    } catch (e) {
      setSyncError(e.message || 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  // Applies just one client's invoice or package updates for the week — never the whole
  // batch at once, so each invoice can be reviewed and approved on its own.
  async function applyClient(kind, clientId) {
    const rowKey = `${kind}-${clientId}`
    setApplyingRow(rowKey); setSyncError('')
    try {
      const r = await api.syncBillingWeek(ymd(weekStart), false, clientId)
      setSyncPreview(prev => ({
        ...prev,
        invoice_details: prev.invoice_details.map(d =>
          d.client_id === clientId ? (r.invoice_details.find(x => x.client_id === clientId) || d) : d),
        package_details: [
          ...prev.package_details.filter(d => d.client_id !== clientId),
          ...r.package_details.filter(d => d.client_id === clientId),
        ],
      }))
      setAppliedRows(prev => new Set(prev).add(rowKey))
    } catch (e) {
      setSyncError(e.message || 'Update failed')
    } finally {
      setApplyingRow(null)
    }
  }

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
  useEffect(() => { setSyncPreview(null); setSyncError('') }, [weekStart.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

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
          {[['charge', 'Charge Clients'], ['report', 'Weekly Report']].map(([key, text]) => (
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

          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">Invoices & Packages</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Builds this week's "Invoice"-billed classes onto each client's monthly invoice, and
                deducts "Package"-billed classes from each client's package balance. This runs
                automatically every night for the day before — use this to catch up right now
                instead of waiting, e.g. after fixing a rate. Safe to run more than once.
              </p>
            </div>

            {syncError && <p className="text-xs text-red-600">{syncError}</p>}

            {syncPreview ? (
              <>
                {syncPreview.invoice_details.length === 0 && syncPreview.package_details.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No "Invoice" or "Package" billed classes this week.</p>
                ) : (
                  <div className="text-xs bg-gray-50 border border-gray-100 rounded-lg divide-y divide-gray-100">
                    {syncPreview.invoice_details.map((d) => {
                      const rowKey = `inv-${d.client_id}`
                      const busy = applyingRow === rowKey
                      const justApplied = appliedRows.has(rowKey)
                      return (
                        <div key={rowKey} className="px-3 py-2">
                          <div className={`flex items-center justify-between gap-2 ${d.status === 'updated' && !justApplied ? 'text-gray-700' : 'text-gray-400'}`}>
                            <span>
                              {d.client_name}{' — '}
                              {justApplied ? `applied, ${d.classes_added} class${d.classes_added === 1 ? '' : 'es'} added`
                                : d.status === 'updated' ? `${d.new_invoice ? 'new invoice' : 'add to invoice'}, ${d.classes_added} class${d.classes_added === 1 ? '' : 'es'}`
                                : d.status === 'up_to_date' ? 'already up to date'
                                : 'skipped — has a manual invoice this month'}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              {d.status === 'updated' && <span className={`font-medium ${justApplied ? 'text-gray-400' : 'text-gray-700'}`}>{money(d.amount_added)}</span>}
                              {justApplied && <span className="text-green-600">✓</span>}
                              {d.invoice_id && (
                                <Link to={`/invoices/${d.invoice_id}`} className="text-blue-600 hover:underline whitespace-nowrap">
                                  Review invoice →
                                </Link>
                              )}
                              {d.status === 'updated' && !justApplied && (
                                <button onClick={() => applyClient('inv', d.client_id)} disabled={busy}
                                  className="px-2 py-1 bg-gray-900 text-white rounded-md font-medium hover:bg-gray-700 disabled:opacity-40 whitespace-nowrap">
                                  {busy ? 'Applying…' : 'Apply'}
                                </button>
                              )}
                            </div>
                          </div>
                          {d.status === 'updated' && d.lines?.length > 0 && (
                            <div className="mt-1 ml-2 space-y-0.5">
                              {d.lines.map((l, j) => (
                                <div key={j} className="flex justify-between text-gray-500">
                                  <span>· {l.description} — {l.class_date}</span>
                                  <span>{money(l.unit_price)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {Object.values(
                      syncPreview.package_details.reduce((byClient, d) => {
                        (byClient[d.client_id] ||= { client_id: d.client_id, client_name: d.client_name, dates: [] }).dates.push(d)
                        return byClient
                      }, {})
                    ).map((group) => {
                      const rowKey = `pkg-${group.client_id}`
                      const busy = applyingRow === rowKey
                      const justApplied = appliedRows.has(rowKey)
                      const hasPending = !justApplied && group.dates.some(d => d.status === 'deducted')
                      return (
                        <div key={rowKey} className="px-3 py-2">
                          <div className="flex items-center justify-between gap-2 text-gray-700">
                            <span>{group.client_name}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              {justApplied && <span className="text-green-600">✓ applied</span>}
                              {hasPending && (
                                <button onClick={() => applyClient('pkg', group.client_id)} disabled={busy}
                                  className="px-2 py-1 bg-gray-900 text-white rounded-md font-medium hover:bg-gray-700 disabled:opacity-40 whitespace-nowrap">
                                  {busy ? 'Applying…' : 'Apply'}
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="mt-1 ml-2 space-y-0.5">
                            {group.dates.map((d, j) => (
                              <div key={j} className={d.status === 'deducted' ? 'text-gray-500' : d.status === 'no_active_package' ? 'text-amber-700' : 'text-gray-400'}>
                                · {d.session_date} —{' '}
                                {d.status === 'deducted' ? (justApplied ? 'deducted' : 'deduct 1 class')
                                  : d.status === 'already_deducted' ? 'already deducted'
                                  : 'no active package to deduct from'}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                <button onClick={() => setSyncPreview(null)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
                  Done reviewing
                </button>
              </>
            ) : (
              <button onClick={previewSync} disabled={previewing}
                className="px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-40">
                {previewing ? 'Checking…' : `Review updates for ${label}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
