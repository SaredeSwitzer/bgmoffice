import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Modal from './Modal'

// Sending money back to a client, from either a weekly card charge or a paid invoice.
//
// Two things shape this. It cannot be undone from here — Stripe is the only place a
// refund can sometimes be reversed — so nothing happens until the amount and the client
// are read back and confirmed. And a payment can be refunded more than once in parts, so
// the figure that matters is not what was charged but what is *left*: the server works
// that out from the refunds already recorded, and the same number is shown here rather
// than recomputed, so the screen can't disagree with what the server will allow.

export default function RefundModal({ chargeId = null, invoiceId = null, onClose, onDone }) {
  const [info,    setInfo]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [amount,  setAmount]  = useState('')
  const [reason,  setReason]  = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')
  const [done,    setDone]    = useState(null)

  useEffect(() => {
    const params = chargeId ? { charge_id: chargeId } : { invoice_id: invoiceId }
    api.getRefundAvailable(params)
      .then(d => { setInfo(d); setAmount(String(d.refundable ?? '')) })
      .catch(e => setError(e.message || 'Could not load that payment.'))
      .finally(() => setLoading(false))
  }, [chargeId, invoiceId])

  const asked = Number(amount)
  const tooMuch = info && Number.isFinite(asked) && asked > Number(info.refundable) + 1e-9
  const invalid = !Number.isFinite(asked) || asked <= 0

  async function send() {
    setBusy(true); setError('')
    try {
      const res = await api.createRefund({
        charge_id: chargeId, invoice_id: invoiceId,
        amount: asked, reason: reason.trim() || null,
      })
      setDone(res)
      onDone?.(res)
    } catch (e) {
      setError(e.message || 'That did not go through.')
      setConfirm(false)
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} labelledBy="refund-title">
      <div className="rounded-2xl bg-white shadow-xl px-5 py-4 max-w-md">
        <h2 id="refund-title" className="text-base font-bold text-gray-900 mb-1">Refund a payment</h2>

        {loading ? (
          <p className="text-xs text-gray-400 italic">Loading the payment…</p>
        ) : done ? (
          <>
            <p className="text-sm text-green-700 font-semibold mt-2">
              ✓ ${Number(done.amount).toFixed(2)} refunded to {info?.client_name}.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              It goes back to the card they paid with — usually 5–10 days, decided by their bank.
              {Number(done.refundable_left) > 0 &&
                ` $${Number(done.refundable_left).toFixed(2)} of this payment is still refundable.`}
            </p>
            <button onClick={onClose}
              className="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-700">
              Done
            </button>
          </>
        ) : error && !info ? (
          <>
            <p className="text-sm text-red-600 mt-2">{error}</p>
            <button onClick={onClose}
              className="mt-3 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
              Close
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-3">
              {info.client_name} · {info.label}
            </p>

            <dl className="text-xs rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 mb-3 space-y-0.5">
              <div className="flex justify-between">
                <dt className="text-gray-500">They paid</dt>
                <dd className="font-semibold text-gray-800">${Number(info.paid).toFixed(2)}</dd>
              </div>
              {Number(info.already_refunded) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Already refunded</dt>
                  <dd className="font-semibold text-gray-800">−${Number(info.already_refunded).toFixed(2)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-200 pt-0.5 mt-0.5">
                <dt className="text-gray-600 font-medium">Can still be refunded</dt>
                <dd className="font-bold text-gray-900">${Number(info.refundable).toFixed(2)}</dd>
              </div>
            </dl>

            {Number(info.refundable) <= 0 ? (
              <>
                <p className="text-sm text-gray-700">This payment has already been refunded in full.</p>
                <button onClick={onClose}
                  className="mt-3 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                  Close
                </button>
              </>
            ) : confirm ? (
              <>
                {/* Read back, in words, before it goes. The amount and the person are the
                    two things worth being certain of, so both are repeated here. */}
                <p className="text-sm text-gray-900 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                  Send <b>${asked.toFixed(2)}</b> back to <b>{info.client_name}</b>?
                  <span className="block text-xs text-gray-600 mt-1">
                    This can’t be undone from the app.
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button onClick={send} disabled={busy}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                    {busy ? 'Refunding…' : `Yes — refund $${asked.toFixed(2)}`}
                  </button>
                  <button onClick={() => setConfirm(false)} disabled={busy}
                    className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                    Back
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="block text-xs font-medium text-gray-600 mb-1">How much?</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">$</span>
                  <input type="number" step="0.01" min="0" value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="w-32 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  <button type="button" onClick={() => setAmount(String(info.refundable))}
                    className="text-[11px] text-blue-600 hover:underline">
                    the whole ${Number(info.refundable).toFixed(2)}
                  </button>
                </div>
                {tooMuch && (
                  <p className="text-[11px] text-red-600 mt-1">
                    That’s more than is left — the most you can send back is ${Number(info.refundable).toFixed(2)}.
                  </p>
                )}

                <label className="block text-xs font-medium text-gray-600 mt-3 mb-1">
                  Why? <span className="font-normal text-gray-400">(kept on the record)</span>
                </label>
                <input value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. class cancelled, charged twice"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button onClick={() => setConfirm(true)} disabled={invalid || tooMuch}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">
                    Refund…
                  </button>
                  <button onClick={onClose}
                    className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              </>
            )}
            {error && <p className="text-[11px] text-red-600 mt-2">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
