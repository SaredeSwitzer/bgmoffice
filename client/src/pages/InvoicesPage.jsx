import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../api/client'
import SearchSelect from '../components/SearchSelect'
import { navClick, auxNavClick } from '../utils/nav'

const STATUS_COLORS = {
  draft:   'bg-gray-100 text-gray-600',
  sent:    'bg-blue-100 text-blue-700',
  partial: 'bg-amber-100 text-amber-700',
  paid:    'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
}

function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
}

function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const EMPTY_LINE = { description: '', class_date: '', unit_price: '' }

export function NewInvoiceModal({ onClose, onCreated, initialClient = null }) {
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [form, setForm] = useState({
    title: '',
    client: initialClient,
    instructor: null,
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: '',
    tax_rate: '',
    notes: '',
    send_to_email: '',
    line_items: [{ ...EMPTY_LINE }],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [clientPackages, setClientPackages] = useState([])
  const [showImport, setShowImport] = useState(false)

  useEffect(() => {
    Promise.all([api.getClients(), api.getInstructors()])
      .then(([c, i]) => { setClients(c); setInstructors(i) })
  }, [])

  // Load packages when client changes
  useEffect(() => {
    if (form.client?.id) {
      api.getClientPackages(form.client.id).then(setClientPackages)
    } else {
      setClientPackages([])
      setShowImport(false)
    }
  }, [form.client?.id])

  // Auto-populate send_to_email from client's saved email when client changes
  useEffect(() => {
    if (form.client?.id && clients.length) {
      const c = clients.find(cl => cl.id === form.client.id)
      if (c) setForm(f => ({ ...f, send_to_email: c.invoice_email || c.email || '' }))
    } else if (!form.client?.id) {
      setForm(f => ({ ...f, send_to_email: '' }))
    }
  }, [form.client?.id, clients])

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function setLine(idx, k, v) {
    setForm(f => {
      const li = [...f.line_items]
      li[idx] = { ...li[idx], [k]: v }
      return { ...f, line_items: li }
    })
  }

  function addLine() { setForm(f => ({ ...f, line_items: [...f.line_items, { ...EMPTY_LINE }] })) }
  function removeLine(idx) {
    setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }))
  }

  const subtotal = form.line_items.reduce((s, li) => s + Number(li.unit_price || 0), 0)
  const taxRate = Number(form.tax_rate || 0)
  const taxAmt = subtotal * taxRate / 100
  const total = subtotal + taxAmt

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.client) { setError('Please select a client.'); return }
    if (!form.line_items.some(li => li.description.trim())) { setError('Add at least one line item.'); return }
    setSaving(true); setError('')
    try {
      const emailToSave = form.send_to_email.trim()
      const clientForEmail = clients.find(c => c.id === form.client.id)
      const existingEmail = clientForEmail?.invoice_email || clientForEmail?.email || ''

      const [inv] = await Promise.all([
        api.createInvoice({
          title: form.title || null,
          client_id: form.client.id,
          instructor_id: form.instructor?.id || null,
          invoice_date: form.invoice_date,
          due_date: form.due_date || null,
          tax_rate: taxRate,
          notes: form.notes || null,
          line_items: form.line_items.filter(li => li.description.trim()).map(li => ({
            description: li.description.trim(),
            class_date: li.class_date || null,
            unit_price: Number(li.unit_price) || 0,
          })),
        }),
        ...(emailToSave && emailToSave !== existingEmail
          ? [api.setClientInvoiceEmail(form.client.id, emailToSave)]
          : []),
      ])
      onCreated(inv)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 px-4 py-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-auto">
        <div className="px-6 pt-6 pb-2 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-lg">New Invoice</h3>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title (optional)</label>
              <input value={form.title} onChange={e => setField('title', e.target.value)}
                placeholder="e.g. June Sessions — Smith Family"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            {/* Client + Instructor */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Client <span className="text-red-500">*</span></label>
                <SearchSelect options={clients} value={form.client} onChange={v => setField('client', v)} placeholder="Search client…" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Instructor (optional)</label>
                <SearchSelect options={instructors} value={form.instructor} onChange={v => setField('instructor', v)} placeholder="Search instructor…" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Invoice Date</label>
                <input type="date" value={form.invoice_date} onChange={e => setField('invoice_date', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Due Date</label>
                <input type="date" value={form.due_date} onChange={e => setField('due_date', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Send invoice to (email)</label>
                <input
                  type="email"
                  value={form.send_to_email}
                  onChange={e => setField('send_to_email', e.target.value)}
                  placeholder="client@example.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                />
                <p className="text-[10px] text-gray-400 mt-0.5">Saved to client's invoice email. Used when sending this invoice.</p>
              </div>
            </div>

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-600">Line Items</label>
                <div className="flex gap-2">
                  {clientPackages.length > 0 && (
                    <button type="button" onClick={() => setShowImport(v => !v)}
                      className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 rounded px-2 py-0.5 bg-purple-50">
                      📦 Import from Package
                    </button>
                  )}
                  <button type="button" onClick={addLine}
                    className="text-xs text-gray-500 hover:text-gray-800 border border-dashed border-gray-300 rounded px-2 py-0.5">
                    + Add Line
                  </button>
                </div>
              </div>

              {/* Package session importer */}
              {showImport && (
                <div className="mb-3 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 space-y-2">
                  <p className="text-xs font-semibold text-purple-800">Import sessions as line items</p>
                  {clientPackages.map(pkg => (
                    <div key={pkg.id} className="bg-white border border-purple-100 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-gray-700">
                          {pkg.total_classes}-class package
                          {pkg.instructor_name && <span className="font-normal text-gray-400"> · {pkg.instructor_name}</span>}
                          <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${pkg.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                            {pkg.status}
                          </span>
                        </span>
                        <button type="button"
                          onClick={() => {
                            const newLines = (pkg.sessions || []).map(s => ({
                              description: `Class${pkg.instructor_name ? ` w/ ${pkg.instructor_name}` : ''}`,
                              class_date: s.session_date,
                              unit_price: '',
                            }))
                            setForm(f => ({
                              ...f,
                              line_items: [
                                ...f.line_items.filter(li => li.description.trim()),
                                ...newLines,
                              ],
                            }))
                            setShowImport(false)
                          }}
                          className="text-xs text-purple-700 font-semibold hover:underline">
                          Import all ({pkg.sessions?.length || 0} sessions)
                        </button>
                      </div>
                      {(pkg.sessions || []).length === 0 && (
                        <p className="text-xs text-gray-400 italic">No sessions logged</p>
                      )}
                      {(pkg.sessions || []).map(s => (
                        <div key={s.id} className="flex items-center justify-between text-xs text-gray-600 py-0.5">
                          <span>{fmtDate(s.session_date)}{s.notes && <span className="text-gray-400 italic ml-1">— {s.notes}</span>}</span>
                          <button type="button"
                            onClick={() => {
                              setForm(f => ({
                                ...f,
                                line_items: [
                                  ...f.line_items.filter(li => li.description.trim()),
                                  {
                                    description: `Class${pkg.instructor_name ? ` w/ ${pkg.instructor_name}` : ''}`,
                                    class_date: s.session_date,
                                    unit_price: '',
                                  },
                                ],
                              }))
                            }}
                            className="text-purple-600 hover:text-purple-800 font-semibold">+ Add</button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {/* Column headers */}
              <div className="hidden sm:flex gap-2 text-xs font-semibold text-gray-400 px-1 mb-1">
                <span className="flex-1 min-w-0">Description</span>
                <span className="w-36 shrink-0">Class Date</span>
                <span className="w-24 shrink-0 text-right">Price</span>
                <span className="w-4 shrink-0" />
              </div>

              <div className="space-y-3">
                {form.line_items.map((li, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input
                      value={li.description}
                      onChange={e => setLine(idx, 'description', e.target.value)}
                      placeholder="Description…"
                      className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <div className="flex gap-2 items-center">
                      <input
                        type="date"
                        value={li.class_date || ''}
                        onChange={e => setLine(idx, 'class_date', e.target.value)}
                        className="w-36 shrink-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                      />
                      <input
                        type="number" min="0" step="0.01"
                        value={li.unit_price}
                        onChange={e => setLine(idx, 'unit_price', e.target.value)}
                        placeholder="0.00"
                        className="w-24 shrink-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right"
                      />
                      {form.line_items.length > 1 && (
                        <button type="button" onClick={() => removeLine(idx)} className="text-gray-300 hover:text-red-500 text-xs">✕</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="mt-3 border-t border-gray-100 pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span><span>{fmtMoney(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-gray-600">
                  <div className="flex items-center gap-2">
                    <span>Tax</span>
                    <input
                      type="number" min="0" max="100" step="0.1"
                      value={form.tax_rate}
                      onChange={e => setField('tax_rate', e.target.value)}
                      placeholder="0"
                      className="w-16 border border-gray-300 rounded px-2 py-0.5 text-sm text-right"
                    />
                    <span className="text-gray-400">%</span>
                  </div>
                  <span>{fmtMoney(taxAmt)}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-900 text-base">
                  <span>Total</span><span>{fmtMoney(total)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes / Memo</label>
              <textarea
                value={form.notes}
                onChange={e => setField('notes', e.target.value)}
                rows={3}
                placeholder="Payment terms, thank-you note, etc."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
              />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
            <button type="submit" disabled={saving}
              className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700">
              {saving ? 'Creating…' : 'Create Invoice'}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const STATUS_ORDER = ['draft', 'sent', 'partial', 'overdue', 'paid']

function sortInvoices(invoices, col, dir) {
  return [...invoices].sort((a, b) => {
    let av, bv
    if (col === 'invoice_number') { av = a.invoice_number; bv = b.invoice_number }
    else if (col === 'client_name') { av = (a.client_name || '').toLowerCase(); bv = (b.client_name || '').toLowerCase() }
    else if (col === 'invoice_date') { av = a.invoice_date || ''; bv = b.invoice_date || '' }
    else if (col === 'due_date') { av = a.due_date || ''; bv = b.due_date || '' }
    else if (col === 'total') { av = a.total || 0; bv = b.total || 0 }
    else if (col === 'status') { av = STATUS_ORDER.indexOf(a.status); bv = STATUS_ORDER.indexOf(b.status) }
    if (av < bv) return dir === 'asc' ? -1 : 1
    if (av > bv) return dir === 'asc' ? 1 : -1
    return 0
  })
}

function SortTh({ col, label, sortCol, sortDir, onSort, className = '' }) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 whitespace-nowrap ${className}`}
    >
      {label}
      <span className="ml-1 inline-block w-3 text-gray-300">
        {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </th>
  )
}

export default function InvoicesPage() {
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [sortCol, setSortCol] = useState(() => localStorage.getItem('inv_sort_col') || 'invoice_number')
  const [sortDir, setSortDir] = useState(() => localStorage.getItem('inv_sort_dir') || 'desc')
  const [showNew, setShowNew] = useState(false)

  function load() {
    const params = {}
    if (statusFilter) params.status = statusFilter
    return api.getInvoices(params).then(setInvoices).finally(() => setLoading(false))
  }

  useEffect(() => { setLoading(true); load() }, [statusFilter])

  function handleSort(col) {
    if (sortCol === col) {
      const dir = sortDir === 'asc' ? 'desc' : 'asc'
      setSortDir(dir)
      localStorage.setItem('inv_sort_dir', dir)
    } else {
      setSortCol(col)
      setSortDir('asc')
      localStorage.setItem('inv_sort_col', col)
      localStorage.setItem('inv_sort_dir', 'asc')
    }
  }

  const sorted = sortInvoices(invoices, sortCol, sortDir)

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Invoices</h1>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
          <button
            onClick={() => setShowNew(true)}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            + New Invoice
          </button>
        </div>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-12 text-center">
          <p className="text-gray-400 text-sm italic">No invoices yet.</p>
          <button onClick={() => setShowNew(true)}
            className="mt-3 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700">
            Create your first invoice
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <SortTh col="invoice_number" label="Invoice #" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="client_name"    label="Client"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="invoice_date"   label="Date"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="hidden sm:table-cell" />
                <SortTh col="due_date"       label="Due"       sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="hidden sm:table-cell" />
                <th
                  onClick={() => handleSort('total')}
                  className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 whitespace-nowrap"
                >
                  Total
                  <span className="ml-1 inline-block w-3 text-gray-300">
                    {sortCol === 'total' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </th>
                <SortTh col="status" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map(inv => (
                <tr
                  key={inv.id}
                  onClick={e => navClick(e, `/invoices/${inv.id}`, navigate)}
                  onAuxClick={e => auxNavClick(e, `/invoices/${inv.id}`)}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-700 font-semibold">{inv.invoice_number}</span>
                    {inv.title && <p className="text-xs text-gray-500 mt-0.5">{inv.title}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-900">{inv.client_name || <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{fmtDate(inv.invoice_date)}</td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{fmtDate(inv.due_date)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmtMoney(inv.total)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[inv.status]}`}>
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewInvoiceModal
          onClose={() => setShowNew(false)}
          onCreated={inv => { setShowNew(false); navigate(`/invoices/${inv.id}`) }}
        />
      )}
    </div>
  )
}
