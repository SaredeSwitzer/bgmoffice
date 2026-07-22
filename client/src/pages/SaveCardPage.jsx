import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { api } from '../api/client'

// Client-facing page to save a card on file (no charge). Backs the /save-card/:token
// link. Mirrors PaymentPage, but uses a SetupIntent instead of a PaymentIntent.

function SetupForm({ token, onSaved }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    setErrorMsg('')

    const { error, setupIntent } = await stripe.confirmSetup({ elements, redirect: 'if_required' })
    if (error) {
      setErrorMsg(error.message || 'Could not save card.')
      setSubmitting(false)
      return
    }
    if (setupIntent?.status === 'succeeded') {
      const r = await api.confirmSaveCard(token, setupIntent.id)
      if (r.error) { setErrorMsg(r.error); setSubmitting(false); return }
      onSaved(r)
    } else {
      setErrorMsg('Card setup did not complete. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{errorMsg}</div>
      )}
      <button type="submit" disabled={!stripe || submitting}
        className="w-full bg-gray-900 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-gray-700 transition-colors">
        {submitting ? 'Saving…' : 'Save Card'}
      </button>
    </form>
  )
}

export default function SaveCardPage() {
  const { token } = useParams()
  const [info, setInfo] = useState(null)
  const [stripePromise, setStripePromise] = useState(null)
  const [clientSecret, setClientSecret] = useState(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      try {
        const data = await api.getSaveCard(token)
        if (data.error) { setError(data.error); return }
        setInfo(data)
        const intent = await api.createSaveCardIntent(token)
        if (intent.error) { setError(intent.error); return }
        if (!intent.publishable_key) { setError('Card processing is not configured.'); return }
        setClientSecret(intent.clientSecret)
        setStripePromise(loadStripe(intent.publishable_key))
      } catch {
        setError('Unable to load this page. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [token])

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-gray-400 text-sm">Loading…</div></div>

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Unable to Load</h2>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    </div>
  )

  if (saved) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Card Saved</h2>
        <p className="text-sm text-gray-500">Thank you! Your card is securely on file for your weekly classes.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <img src="/logo.jpg" alt="Bring the Gym to Me" className="h-20 mx-auto mb-3 object-contain" />
          <p className="text-xs text-gray-400">Bring the Gym to Me, LLC</p>
          <p className="text-xs text-gray-300 mt-2">Secure Card on File</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Save your card on file</h2>
          {info?.client_name && <p className="text-sm text-gray-600 mb-1">{info.client_name}</p>}
          <p className="text-xs text-gray-500 mb-4">
            {info?.has_card
              ? `A card ending in ${info.card_last4} is already on file. Add a new one below to replace it.`
              : 'Your card will be securely saved and charged weekly for the classes you have. Our 24-hour cancellation policy applies — classes cancelled with less than 24 hours notice are still charged.'}
          </p>
          {clientSecret && stripePromise && (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe', variables: { fontFamily: 'system-ui, sans-serif' } } }}>
              <SetupForm token={token} onSaved={() => setSaved(true)} />
            </Elements>
          )}
        </div>

        <p className="text-center text-xs text-gray-400">
          Cards are processed and stored securely by Stripe. BGM Office never sees your full card number.
        </p>
      </div>
    </div>
  )
}
