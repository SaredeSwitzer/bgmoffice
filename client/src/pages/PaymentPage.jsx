import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { api } from '../api/client'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
}
function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Stripe checkout form ──────────────────────────────────────────────────────

function CheckoutForm({ invoice, onPaid }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    setErrorMsg('')

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    })

    if (error) {
      setErrorMsg(error.message || 'Payment failed.')
      setSubmitting(false)
      return
    }

    if (paymentIntent?.status === 'succeeded') {
      onPaid()
    } else {
      setErrorMsg('Payment is processing. Please check back later.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full bg-gray-900 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-gray-700 transition-colors"
      >
        {submitting ? 'Processing…' : `Pay ${fmtMoney(invoice.total)}`}
      </button>
    </form>
  )
}

// ── Main payment page ─────────────────────────────────────────────────────────

export default function PaymentPage() {
  const { id } = useParams()
  const [invoice, setInvoice] = useState(null)
  const [stripePromise, setStripePromise] = useState(null)
  const [clientSecret, setClientSecret] = useState(null)
  const [paid, setPaid] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      try {
        // Load public invoice data
        const inv = await api.getPublicInvoice(id)
        if (inv.error) { setError(inv.error); return }
        setInvoice(inv)

        if (inv.status === 'paid') { setPaid(true); return }

        // Get Stripe publishable key from server (stored in app_settings or env var)
        const pkRes = await fetch(`${BASE}/api/settings/stripe-public`)
        const pkData = await pkRes.json()
        const pk = pkData.publishable_key

        if (!pk) {
          // No Stripe key — still show the invoice + check payment option
          return
        }

        // Create / retrieve payment intent
        const piRes = await api.createPaymentIntent(id)
        if (piRes.error) { setError(piRes.error); return }
        setClientSecret(piRes.clientSecret)
        setStripePromise(loadStripe(pk))
      } catch (err) {
        setError('Unable to load payment page. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [id])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">Loading…</div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Unable to Load Invoice</h2>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    </div>
  )

  if (paid) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Received!</h2>
        <p className="text-sm text-gray-500 mb-1">Thank you for your payment.</p>
        <p className="text-sm text-gray-400">Invoice {invoice?.invoice_number}</p>
        {invoice?.paid_at && (
          <p className="text-xs text-gray-400 mt-1">
            Paid {new Date(invoice.paid_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        )}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <img src="/logo.jpg" alt="Bring the Gym to Me" className="h-20 mx-auto mb-3 object-contain" />
          <p className="text-xs text-gray-400">Bring the Gym to Me, LLC</p>
          <p className="text-xs text-gray-400">346 New York Ave #5A, Brooklyn, NY 11213</p>
          <p className="text-xs text-gray-300 mt-2">Secure Payment</p>
        </div>

        {/* Invoice summary */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-0.5">Invoice</p>
              <h2 className="text-lg font-bold text-gray-900 font-mono">{invoice.invoice_number}</h2>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 mb-0.5">Amount Due</p>
              <p className="text-2xl font-bold text-gray-900">{fmtMoney(invoice.total)}</p>
            </div>
          </div>

          {invoice.client_name && (
            <p className="text-sm text-gray-600 mb-3">
              <span className="text-gray-400">Billed to:</span> {invoice.client_name}
            </p>
          )}

          {invoice.due_date && (
            <p className="text-xs text-gray-400">Due {fmtDate(invoice.due_date)}</p>
          )}

          {/* Line items */}
          <div className="mt-4 border-t border-gray-100 pt-4 space-y-2">
            {invoice.line_items.map((li, i) => (
              <div key={i} className="flex justify-between text-sm gap-3">
                <div>
                  <span className="text-gray-700">{li.description}</span>
                  {li.class_date && (
                    <div className="text-xs text-gray-400 mt-0.5">{fmtDate(li.class_date)}</div>
                  )}
                </div>
                <span className="text-gray-900 font-medium flex-shrink-0">{fmtMoney(li.unit_price)}</span>
              </div>
            ))}
            <div className="border-t border-gray-100 pt-2 space-y-1 text-sm">
              {invoice.tax_rate > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Tax ({invoice.tax_rate}%)</span>
                  <span>{fmtMoney(invoice.tax_amount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900">
                <span>Total</span>
                <span>{fmtMoney(invoice.total)}</span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <p className="mt-3 text-xs text-gray-500 italic border-t border-gray-100 pt-3">{invoice.notes}</p>
          )}
        </div>

        {/* Stripe payment form */}
        {clientSecret && stripePromise && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Pay with Card or Bank Transfer</h3>
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: { theme: 'stripe', variables: { fontFamily: 'system-ui, sans-serif' } },
              }}
            >
              <CheckoutForm invoice={invoice} onPaid={() => setPaid(true)} />
            </Elements>
          </div>
        )}

        {/* Pay by check */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Pay by Check</h3>
          <p className="text-sm text-gray-600 mb-1">
            Make check payable to: <span className="font-semibold text-gray-900">Bring the Gym to Me, LLC</span>
          </p>
          <p className="text-sm text-gray-600">
            Mail to: <span className="font-semibold text-gray-900">346 New York Ave #5A, Brooklyn, NY 11213</span>
          </p>
          <p className="text-xs text-gray-400 mt-2">Please include invoice #{invoice?.invoice_number} in the memo line.</p>
        </div>

        <p className="text-center text-xs text-gray-400">
          Card payments are processed securely by Stripe. BGM Office never stores your card details.
        </p>
      </div>
    </div>
  )
}
