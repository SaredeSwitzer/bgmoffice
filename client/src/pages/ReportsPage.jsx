import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import SearchSelect from '../components/SearchSelect'
import DateInput from '../components/DateInput'
import BulkEditSessionsModal from '../components/BulkEditSessionsModal'
import { ClientLink, InstructorLink } from '../components/NameLink'
import { fmtTime, fmtTimeRange } from '../utils/time'

function fmtDate(iso) {
  const [y, m, d] = iso.split('-')
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const STATUS_STYLE = {
  scheduled: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
  'no-show': 'bg-red-50 text-red-700',
}

// Quick date-range presets. "All time" is a wide but bounded window (the sessions
// endpoint requires start/end) rather than truly unbounded, to keep the query cheap.
function presetRange(key) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (key) {
    case 'upcoming':
      return { start: ymd(today), end: ymd(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())) }
    case 'past30':
      return { start: ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)), end: ymd(today) }
    case 'thisyear':
      return { start: `${today.getFullYear()}-01-01`, end: `${today.getFullYear()}-12-31` }
    case 'all':
    default:
      return { start: ymd(new Date(today.getFullYear() - 3, today.getMonth(), today.getDate())), end: ymd(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())) }
  }
}

function money(v) { return v == null || v === '' ? '' : `$${Number(v).toFixed(0)}` }
// A charge note ("TBD", "$80–100") is purely informational — the numeric charge_amount
// stays whatever it is, so a note never silently zeroes out a real invoice line. Matches
// the same helper in SchedulePage.jsx.
function chargeDisplay(s) { return s.charge_note || money(s.charge_amount) }

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(rows, clients, instructors) {
  const clientsById = new Map(clients.map(c => [c.id, c]))
  const instructorsById = new Map(instructors.map(i => [i.id, i]))
  const header = ['Client Name', 'Contact Phone', 'Start Date', 'Class Time', 'Charge to Client', 'Payment Method', 'Full Name', 'Instructor Rate', 'Expected Rate']
  const lines = [header, ...rows.map(s => [
    s.client_name,
    clientsById.get(s.client_id)?.phone || '',
    s.session_date,
    s.start_time ? fmtTimeRange(s.start_time, s.duration_minutes) : '',
    chargeDisplay(s),
    s.payment_method || '',
    s.instructor_name || '',
    s.instructor_pay ?? '',
    instructorsById.get(s.instructor_id)?.pay_rate ?? '',
  ])]
  const csv = lines.map(row => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `class-report-${ymd(new Date())}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// `embedded` renders it inside the Schedule page's Reports tab: no heading or width
// cap, since Schedule already provides both.
export default function ReportsPage({ embedded = false }) {
  const [searchParams] = useSearchParams()

  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])

  const [client, setClient] = useState(null)
  const [instructor, setInstructor] = useState(null)
  const [style, setStyle] = useState('')
  const [status, setStatus] = useState('')
  const [preset, setPreset] = useState('upcoming')
  const [range, setRange] = useState(presetRange('upcoming'))

  const [results, setResults] = useState(null)
  const [error, setError] = useState('')
  const [ran, setRan] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [showBulkEdit, setShowBulkEdit] = useState(false)

  useEffect(() => {
    Promise.all([api.getClients(), api.getInstructors()])
      .then(([cs, is]) => {
        setClients(cs)
        setInstructors(is)
        // Deep-linked from a client's profile page ("View Report" button)
        const cid = searchParams.get('client_id')
        if (cid) {
          const c = cs.find(x => String(x.id) === String(cid))
          if (c) setClient(c)
        }
      })
      .catch(e => setError(e.message))
    // Only apply the deep-link once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const styleOptions = useMemo(() => {
    const set = new Set()
    instructors.forEach(i => String(i.styles_taught || '').split(',').map(s => s.trim()).filter(Boolean).forEach(s => set.add(s)))
    return [...set].sort()
  }, [instructors])

  function applyPreset(key) {
    setPreset(key)
    setRange(presetRange(key))
  }

  async function runReport(e) {
    e?.preventDefault()
    setError('')
    setRan(true)
    try {
      const params = {}
      if (client) params.client_id = client.id
      if (instructor) params.instructor_id = instructor.id
      const rows = await api.getClassSessions(range.start, range.end, params)
      const filtered = rows.filter(s =>
        (!style || (s.style || '').toLowerCase() === style.toLowerCase()) &&
        (!status || s.status === status)
      )
      filtered.sort((a, b) => a.session_date.localeCompare(b.session_date) || String(a.start_time || '').localeCompare(String(b.start_time || '')))
      setResults(filtered)
      setSelected(new Set())
    } catch (e2) {
      setError(e2.message)
      setResults(null)
    }
  }

  function toggleSelected(id) {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAllSelected() {
    setSelected(s => (s.size === results.length ? new Set() : new Set(results.map(r => r.id))))
  }

  function handleBulkSaved(updatedRows) {
    const byId = new Map(updatedRows.map(r => [r.id, r]))
    setResults(rs => rs.map(r => {
      const u = byId.get(r.id)
      if (!u) return r
      return { ...r, ...u, instructor_name: instructors.find(i => i.id === u.instructor_id)?.name || null }
    }))
    setSelected(new Set())
    setShowBulkEdit(false)
  }

  // Auto-run once the client list (and any deep-linked client) is loaded.
  useEffect(() => {
    if (clients.length && !ran) runReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients])

  return (
    <div className={embedded ? 'space-y-6' : 'max-w-4xl mx-auto space-y-6'}>
      {!embedded && (
        <div>
          <h1 className="text-xl font-bold text-gray-900">Class Reports</h1>
          <p className="text-sm text-gray-500">Look up classes by client, instructor, style, status, or date range.</p>
        </div>
      )}

      <form onSubmit={runReport} className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <SearchSelect label="Client" options={clients} value={client} onChange={setClient} placeholder="Any client…" />
          <SearchSelect label="Instructor" options={instructors} value={instructor} onChange={setInstructor} placeholder="Any instructor…" />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Style</label>
            <select value={style} onChange={e => setStyle(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300">
              <option value="">Any style</option>
              {styleOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300">
              <option value="">Any status</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no-show">No-show</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date range</label>
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            {[['upcoming', 'Upcoming'], ['past30', 'Past 30 days'], ['thisyear', 'This year'], ['all', 'Last 3 years']].map(([key, label]) => (
              <button type="button" key={key} onClick={() => applyPreset(key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  preset === key ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <DateInput value={range.start} onChange={v => { setPreset(null); setRange(r => ({ ...r, start: v })) }} />
            <span className="text-gray-400 text-sm">to</span>
            <DateInput value={range.end} onChange={v => { setPreset(null); setRange(r => ({ ...r, end: v })) }} />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button type="submit" className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors">
            Run Report
          </button>
          {results && results.length > 0 && (
            <button type="button" onClick={() => downloadCsv(results, clients, instructors)}
              className="text-xs text-gray-500 hover:text-gray-800 font-medium">
              Export CSV
            </button>
          )}
        </div>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {results && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              {results.length} class{results.length === 1 ? '' : 'es'}
            </p>
            {selected.size > 0 && (
              <div className="flex items-center gap-3">
                <p className="text-xs text-gray-500">{selected.size} selected</p>
                <button type="button" onClick={() => setShowBulkEdit(true)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700">
                  Edit Selected
                </button>
              </div>
            )}
          </div>
          {results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No classes match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-500">
                    <th className="px-4 py-2 w-8">
                      <input type="checkbox" className="rounded border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
                        checked={results.length > 0 && selected.size === results.length}
                        onChange={toggleAllSelected} />
                    </th>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Time</th>
                    <th className="px-4 py-2">Client</th>
                    <th className="px-4 py-2">Instructor</th>
                    <th className="px-4 py-2 hidden sm:table-cell">Style</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {results.map(s => (
                    <tr key={s.id} className={`hover:bg-gray-50 ${selected.has(s.id) ? 'bg-gray-50' : ''}`}>
                      <td className="px-4 py-2">
                        <input type="checkbox" className="rounded border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300"
                          checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} />
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{fmtDate(s.session_date)}</td>
                      <td className="px-4 py-2 text-gray-500">{s.start_time ? fmtTimeRange(s.start_time, s.duration_minutes) : '—'}</td>
                      <td className="px-4 py-2"><ClientLink id={s.client_id} name={s.client_name} /></td>
                      <td className="px-4 py-2 text-gray-600"><InstructorLink id={s.instructor_id} name={s.instructor_name || '—'} /></td>
                      <td className="px-4 py-2 text-gray-500 hidden sm:table-cell">{s.style || '—'}</td>
                      <td className="px-4 py-2">
                        {s.status && (
                          <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${STATUS_STYLE[s.status] || 'bg-gray-100 text-gray-500'}`}>
                            {s.status}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showBulkEdit && (
        <BulkEditSessionsModal
          sessionIds={[...selected]}
          onClose={() => setShowBulkEdit(false)}
          onSaved={handleBulkSaved}
        />
      )}
    </div>
  )
}
