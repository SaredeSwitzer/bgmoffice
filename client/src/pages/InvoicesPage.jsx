import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../api/client'
import SearchSelect from '../components/SearchSelect'
import DateInput from '../components/DateInput'

const STATUS_COLORS = {
  draft:   'bg-gray-100 text-gray-600',
  sent:    'bg-blue-100 text-blue-700',
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

const EMPTY_LINE = { description: '', class_date: '', quantity: 1, unit_price: '' }

function NewInvoiceModal({ onClose, onCreated }) {
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [form, setForm] = useState({
    client: null,
    instructor: null,
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: '',
    tax_rate: '',
    notes: '',
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

  const subtotal = form.line_items.reduce((s, li) => s + (Number(li.quantity || 0) * Number(li.unit_price || 0)), 0)
  const taxRate = Number(form.tax_rate || 0)
  const taxAmt = subtotal * taxRate / 100
  const total = subtotal + taxAmt

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.client) { setError('Please select a client.'); return }
    if (!form.line_items.some(li => li.description.trim())) { setError('Add at least one line item.'); return }
    setSaving(true); setError('')
    try {
      const inv = await api.createInvoice({
        client_id: form.client.id,
        instructor_id: form.instructor?.id || null,
        invoice_date: form.invoice_date,
        due_date: form.due_date || null,
        tax_rate: taxRate,
        notes: form.notes || null,
        line_items: form.line_items.filter(li => li.description.trim()).map(li => ({
          description: li.description.trim(),
          class_date: li.class_date || null,
          quantity: Number(li.quantity) || 1,
          unit_price: Number(li.unit_price) || 0,
        })),
      })
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
                <DateInput value={form.invoice_date} onChange={v => setField('invoice_date', v)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Due Date</label>
                <DateInput value={form.due_date} onChange={v => setField('due_date', v)} className="w-full" />
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
                              quantity: 1,
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
                                    quantity: 1,
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
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-400 px-1">
                  <span className="col-span-4">Description</span>
                  <span className="col-span-2">Class Date</span>
                  <span className="col-span-1 text-right">Qty</span>
                  <span className="col-span-2 text-right">Unit Price</span>
                  <span className="col-span-3 text-right">Total</span>
                </div>
                {form.line_items.map((li, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      value={li.description}
                      onChange={e => setLine(idx, 'description', e.target.value)}
                      placeholder="Description…"
                      className="col-span-4 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <DateInput
                      value={li.class_date || ''}
                      onChange={v => setLine(idx, 'class_date', v)}
                      className="col-span-2"
                    />
                    <input
                      type="number" min="0" step="0.01"
                      value={li.quantity}
                      onChange={e => setLine(idx, 'quantity', e.target.value)}
                      className="col-span-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right"
                    />
                    <input
                      type="number" min="0" step="0.01"
                      value={li.unit_price}
                      onChange={e => setLine(idx, 'unit_price', e.target.value)}
                      placeholder="0.00"
                      className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right"
                    />
                    <div className="col-span-3 flex items-center justify-end gap-1">
                      <span className="text-sm text-gray-700">
                        {fmtMoney(Number(li.quantity || 0) * Number(li.unit_price || 0))}
                      </span>
                      {form.line_items.length > 1 && (
                        <button type="button" onClick={() => removeLine(idx)} className="text-gray-300 hover:text-red-500 text-xs ml-1">✕</button>
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

export default function InvoicesPage() {
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [showNew, setShowNew] = useState(false)

  function load() {
    const params = {}
    if (statusFilter) params.status = statusFilter
    return api.getInvoices(params).then(setInvoices).finally(() => setLoading(false))
  }

  useEffect(() => { setLoading(true); load() }, [statusFilter])

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
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Due</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.map(inv => (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-700 font-semibold">{inv.invoice_number}</td>
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
