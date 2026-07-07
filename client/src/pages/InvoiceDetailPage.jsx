import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { navClick } from '../utils/nav'
import SearchSelect from '../components/SearchSelect'
import GmailComposeLink from '../components/GmailComposeLink'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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

const EMPTY_LINE = { description: '', class_date: '', unit_price: '' }

export default function InvoiceDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [invoice, setInvoice] = useState(null)
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    Promise.all([
      api.getInvoice(id),
      api.getClients(),
      api.getInstructors(),
    ]).then(([inv, c, i]) => {
      setInvoice(inv)
      setClients(c)
      setInstructors(i)
    }).catch(e => setError(e.message))
  }, [id])

  function startEdit() {
    setEditForm({
      title: invoice.title || '',
      client: invoice.client_id ? { id: invoice.client_id, name: invoice.client_name } : null,
      instructor: invoice.instructor_id ? { id: invoice.instructor_id, name: invoice.instructor_name } : null,
      invoice_date: invoice.invoice_date || '',
      due_date: invoice.due_date || '',
      tax_rate: invoice.tax_rate || '',
      notes: invoice.notes || '',
      line_items: invoice.line_items.length ? invoice.line_items.map(li => ({ ...li })) : [{ ...EMPTY_LINE }],
      status: invoice.status,
    })
    setEditing(true)
  }

  function setLine(idx, k, v) {
    setEditForm(f => {
      const li = [...f.line_items]
      li[idx] = { ...li[idx], [k]: v }
      return { ...f, line_items: li }
    })
  }

  const subtotal = editing
    ? (editForm?.line_items || []).reduce((s, li) => s + Number(li.unit_price || 0), 0)
    : invoice?.subtotal || 0
  const taxRate = editing ? Number(editForm?.tax_rate || 0) : invoice?.tax_rate || 0
  const taxAmt = subtotal * taxRate / 100
  const total = subtotal + taxAmt

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const updated = await api.updateInvoice(id, {
        title: editForm.title || null,
        client_id: editForm.client?.id || null,
        instructor_id: editForm.instructor?.id || null,
        invoice_date: editForm.invoice_date || null,
        due_date: editForm.due_date || null,
        tax_rate: Number(editForm.tax_rate || 0),
        notes: editForm.notes || null,
        status: editForm.status,
        line_items: editForm.line_items.filter(li => li.description.trim()).map(li => ({
          description: li.description.trim(),
          class_date: li.class_date || null,
          unit_price: Number(li.unit_price) || 0,
        })),
      })
      setInvoice(updated)
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(newStatus) {
    const updated = await api.setInvoiceStatus(id, newStatus)
    setInvoice(updated)
  }

  async function handleDelete() {
    if (!confirm('Delete this invoice? This cannot be undone.')) return
    await api.deleteInvoice(id)
    navigate('/invoices')
  }

  function getPaymentLink() {
    return `${window.location.origin}/pay/${id}`
  }

  function copyLink() {
    navigator.clipboard.writeText(getPaymentLink())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function emailSubject() {
    return `Invoice ${invoice.invoice_number} from BGM Office`
  }

  function emailBody() {
    return `Hi ${invoice.client_name || ''},\n\nPlease find your invoice below.\n\nInvoice: ${invoice.invoice_number}\nAmount Due: ${fmtMoney(invoice.total)}\nDue Date: ${fmtDate(invoice.due_date)}\n\nPay online here: ${getPaymentLink()}\n\nThank you!`
  }

  async function downloadPDF() {
    const doc = new jsPDF()
    const pageW = doc.internal.pageSize.getWidth()

    // Load logo
    let logoY = 14
    try {
      const logoResp = await fetch('/logo.jpg')
      const blob = await logoResp.blob()
      const b64 = await new Promise(res => {
        const reader = new FileReader()
        reader.onloadend = () => res(reader.result)
        reader.readAsDataURL(blob)
      })
      doc.addImage(b64, 'JPEG', 14, 10, 36, 18)
      logoY = 30
    } catch {
      // fall back to text if logo fails
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text('Bring the Gym to Me, LLC', 14, 20)
      logoY = 28
    }

    // Company address under logo
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120)
    doc.text('Bring the Gym to Me, LLC', 14, logoY)
    doc.text('346 New York Ave #5A, Brooklyn, NY 11213', 14, logoY + 5)
    doc.setTextColor(0)

    // Invoice title + number (top right)
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text('INVOICE', pageW - 14, 20, { align: 'right' })
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80)
    doc.text(invoice.invoice_number, pageW - 14, 27, { align: 'right' })
    doc.setTextColor(0)

    const dividerY = logoY + 12

    // Divider
    doc.setDrawColor(220)
    doc.line(14, dividerY, pageW - 14, dividerY)

    const billY = dividerY + 8

    // Bill To + Dates
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text('BILL TO', 14, billY)
    doc.setTextColor(0)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(invoice.client_name || '—', 14, billY + 7)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)

    doc.setTextColor(120)
    doc.text('INVOICE DATE', pageW - 14 - 50, billY, { align: 'left' })
    doc.text('DUE DATE', pageW - 14 - 50, billY + 8, { align: 'left' })
    doc.setTextColor(0)
    doc.setFont('helvetica', 'bold')
    doc.text(fmtDate(invoice.invoice_date), pageW - 14, billY, { align: 'right' })
    doc.text(fmtDate(invoice.due_date), pageW - 14, billY + 8, { align: 'right' })
    doc.setFont('helvetica', 'normal')

    // Line items table
    autoTable(doc, {
      startY: billY + 18,
      head: [['Description', 'Class Date', 'Price']],
      body: invoice.line_items.map(li => [
        li.description,
        li.class_date ? fmtDate(li.class_date) : '—',
        fmtMoney(li.unit_price),
      ]),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 32 },
        2: { halign: 'right', cellWidth: 30 },
      },
      margin: { left: 14, right: 14 },
    })

    const finalY = doc.lastAutoTable.finalY + 6

    // Totals
    doc.setFontSize(10)
    const colX = pageW - 14 - 80
    doc.setTextColor(100)
    doc.text('Subtotal:', colX, finalY)
    doc.text(`Tax (${invoice.tax_rate}%):`, colX, finalY + 7)
    doc.setTextColor(0)
    doc.setFont('helvetica', 'bold')
    doc.text('Total Due:', colX, finalY + 16)
    doc.setFont('helvetica', 'normal')

    doc.setTextColor(100)
    doc.text(fmtMoney(invoice.subtotal), pageW - 14, finalY, { align: 'right' })
    doc.text(fmtMoney(invoice.tax_amount), pageW - 14, finalY + 7, { align: 'right' })
    doc.setTextColor(0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(fmtMoney(invoice.total), pageW - 14, finalY + 16, { align: 'right' })
    doc.setFont('helvetica', 'normal')

    // Notes
    if (invoice.notes) {
      doc.setFontSize(9)
      doc.setTextColor(120)
      doc.text('Notes:', 14, finalY + 6)
      doc.setTextColor(60)
      doc.text(invoice.notes, 14, finalY + 13, { maxWidth: pageW / 2 - 20 })
    }

    // Payment instructions
    const payY = finalY + (invoice.notes ? 28 : 26)
    doc.setDrawColor(220)
    doc.line(14, payY, pageW - 14, payY)
    doc.setFontSize(9)
    doc.setTextColor(100)
    doc.text('PAYMENT OPTIONS', 14, payY + 7)
    doc.setFontSize(8.5)
    doc.setTextColor(60)
    doc.text('Credit card: Pay online at the link sent with this invoice.', 14, payY + 14)
    doc.text('Check: Make payable to Bring the Gym to Me, LLC', 14, payY + 21)
    doc.text('        Mail to: 346 New York Ave #5A, Brooklyn, NY 11213', 14, payY + 28)
    doc.setTextColor(120)
    doc.text(`(include invoice ${invoice.invoice_number} in the memo)`, 14, payY + 35)

    doc.save(`${invoice.invoice_number}.pdf`)
  }

  if (error) return <p className="text-red-600 text-sm">{error}</p>
  if (!invoice) return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        {invoice.client_id && (
          <button onClick={e => navClick(e, `/clients/${invoice.client_id}`, navigate)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {invoice.client_name}
          </button>
        )}
      </div>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
        {editing ? (
          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title (optional)</label>
              <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. June Sessions — Smith Family"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
                <SearchSelect options={clients} value={editForm.client}
                  onChange={v => setEditForm(f => ({ ...f, client: v }))} placeholder="Search client…" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Instructor</label>
                <SearchSelect options={instructors} value={editForm.instructor}
                  onChange={v => setEditForm(f => ({ ...f, instructor: v }))} placeholder="Search instructor…" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Invoice Date</label>
                <input type="date" value={editForm.invoice_date}
                  onChange={e => setEditForm(f => ({ ...f, invoice_date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Due Date</label>
                <input type="date" value={editForm.due_date}
                  onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-600">Line Items</label>
                <button type="button"
                  onClick={() => setEditForm(f => ({ ...f, line_items: [...f.line_items, { ...EMPTY_LINE }] }))}
                  className="text-xs text-gray-500 hover:text-gray-800 border border-dashed border-gray-300 rounded px-2 py-0.5">
                  + Add Line
                </button>
              </div>
              {/* Column headers */}
              <div className="hidden sm:flex gap-2 text-xs font-semibold text-gray-400 px-1 mb-1">
                <span className="flex-1 min-w-0">Description</span>
                <span className="w-36 shrink-0">Class Date</span>
                <span className="w-24 shrink-0 text-right">Price</span>
                <span className="w-4 shrink-0" />
              </div>

              <div className="space-y-3">
                {editForm.line_items.map((li, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input value={li.description} onChange={e => setLine(idx, 'description', e.target.value)}
                      placeholder="Description…"
                      className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                    <div className="flex gap-2 items-center">
                      <input type="date" value={li.class_date || ''}
                        onChange={e => setLine(idx, 'class_date', e.target.value)}
                        className="w-36 shrink-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                      <input type="number" step="0.01" value={li.unit_price}
                        onChange={e => setLine(idx, 'unit_price', e.target.value)}
                        placeholder="0.00"
                        className="w-24 shrink-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
                      {editForm.line_items.length > 1 && (
                        <button type="button"
                          onClick={() => setEditForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }))}
                          className="text-gray-300 hover:text-red-500 text-xs">✕</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-gray-100 pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{fmtMoney(subtotal)}</span></div>
                <div className="flex items-center justify-between text-gray-600">
                  <div className="flex items-center gap-2">
                    <span>Tax</span>
                    <input type="number" min="0" max="100" step="0.1" value={editForm.tax_rate}
                      onChange={e => setEditForm(f => ({ ...f, tax_rate: e.target.value }))}
                      className="w-16 border border-gray-300 rounded px-2 py-0.5 text-sm text-right" />
                    <span className="text-gray-400">%</span>
                  </div>
                  <span>{fmtMoney(taxAmt)}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-900 text-base">
                  <span>Total</span><span>{fmtMoney(total)}</span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={saving}
                className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditing(false)}
                className="px-4 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* View mode */}
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-xl font-bold text-gray-900 font-mono">{invoice.invoice_number}</h1>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[invoice.status]}`}>
                    {invoice.status}
                  </span>
                </div>
                {invoice.title && (
                  <p className="text-base font-semibold text-gray-800 mb-1">{invoice.title}</p>
                )}
                <p className="text-sm text-gray-600">
                  {invoice.client_name || 'No client'}
                  {invoice.instructor_name && ` · ${invoice.instructor_name}`}
                </p>
                <div className="flex gap-4 mt-1 text-xs text-gray-400">
                  <span>Issued {fmtDate(invoice.invoice_date)}</span>
                  {invoice.due_date && <span>Due {fmtDate(invoice.due_date)}</span>}
                  {invoice.paid_at && <span className="text-green-600 font-medium">Paid ✓</span>}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                <button onClick={startEdit}
                  className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">
                  Edit
                </button>
                <button onClick={handleDelete}
                  className="px-3 py-1.5 border border-red-200 text-red-600 text-xs rounded-lg hover:bg-red-50">
                  Delete
                </button>
              </div>
            </div>

            {/* Line items */}
            <div className="border border-gray-100 rounded-xl overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Description</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Class Date</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {invoice.line_items.map((li, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2.5 text-gray-800">{li.description}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{li.class_date ? fmtDate(li.class_date) : <span className="text-gray-300">—</span>}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${li.unit_price < 0 ? 'text-red-600' : 'text-gray-900'}`}>{fmtMoney(li.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-64 space-y-1 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>Subtotal</span><span>{fmtMoney(invoice.subtotal)}</span>
                </div>
                {invoice.tax_rate > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Tax ({invoice.tax_rate}%)</span><span>{fmtMoney(invoice.tax_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-100 pt-1">
                  <span>Total Due</span><span>{fmtMoney(invoice.total)}</span>
                </div>
              </div>
            </div>

            {invoice.notes && (
              <div className="mt-4 bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-600 border border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</p>
                {invoice.notes}
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      {!editing && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
          <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-4 border-l-4 border-gray-300 pl-2">
            Actions
          </h2>
          <div className="flex flex-wrap gap-3">
            {/* Status updates */}
            {invoice.status === 'draft' && (
              <button onClick={() => handleStatusChange('sent')}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
                Mark as Sent
              </button>
            )}
            {invoice.status !== 'paid' && (
              <button onClick={() => handleStatusChange('paid')}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
                Mark as Paid
              </button>
            )}
            {invoice.status === 'sent' && (
              <button onClick={() => handleStatusChange('overdue')}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700">
                Mark Overdue
              </button>
            )}
            {invoice.status !== 'draft' && (
              <button onClick={() => handleStatusChange('draft')}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
                Revert to Draft
              </button>
            )}

            {/* Send options */}
            <button onClick={copyLink}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
              {copied ? '✓ Copied!' : '🔗 Copy Payment Link'}
            </button>
            <GmailComposeLink
              to={invoice.client_email || ''}
              subject={emailSubject()}
              body={emailBody()}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
            >
              ✉️ Send by Email
            </GmailComposeLink>
            <button onClick={downloadPDF}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
              📄 Download PDF
            </button>
            <a href={`/pay/${id}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
              👁 Preview Payment Page
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
