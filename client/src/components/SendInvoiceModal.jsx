import { useEffect, useState } from 'react'
import { api } from '../api/client'
import DateInput from './DateInput'

// Preview + send an invoice email with the PDF attached — same preview-then-send pattern
// as every other email in the app. The due date shown here is only a *default* (today +
// 7 days) when the invoice doesn't already have one set; staff can still override it
// before sending, and whatever's here when they hit Send is what gets saved.
export default function SendInvoiceModal({ invoice, onClose, onSent }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.getInvoiceSendPreview(invoice.id)
      .then(p => {
        if (cancelled) return
        setTo(p.to); setSubject(p.subject); setBody(p.body); setDueDate(p.due_date)
      })
      .catch(e => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [invoice.id])

  const validCount = (to.match(/[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+/g) || []).length

  async function send() {
    if (validCount === 0) { setError('Add at least one email address.'); return }
    setSending(true); setError('')
    try {
      const updated = await api.sendInvoiceEmail(invoice.id, { subject, body, due_date: dueDate, recipients: to })
      onSent?.(updated)
      onClose()
    } catch (e) {
      setError(e.message); setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">Send Invoice · {invoice.invoice_number}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-3">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                {/* Editable, and takes several addresses — one invoice often has to reach
                    a parent and a bookkeeper, or two contacts at an organisation. */}
                <input value={to} onChange={e => setTo(e.target.value)}
                  placeholder="name@example.com, bookkeeper@example.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                <p className="text-[11px] text-gray-400 mt-1">
                  Separate several with commas. {validCount > 0 && `Sending to ${validCount} recipient${validCount === 1 ? '' : 's'}. `}
                  Cc: sarede@bringthegymtome.com
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Due Date</label>
                <DateInput value={dueDate} onChange={setDueDate} />
                {!invoice.due_date && (
                  <p className="text-[11px] text-gray-400 mt-1">Defaulted to 7 days from today since none was set — adjust if needed.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={9}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed" />
              </div>
              <p className="text-[11px] text-gray-400">The invoice PDF is attached automatically — nothing to attach by hand.</p>
            </>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg">Cancel</button>
          {!loading && !error.includes('no invoice email') && (
            <button onClick={send} disabled={sending || !to}
              className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {sending ? 'Sending…' : 'Send Invoice'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
