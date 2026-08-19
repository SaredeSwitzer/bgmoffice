import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { api, API_ROOT } from '../api/client'

function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
}

// Stripe deposit-payment form — only rendered when the contract has a deposit_amount.
function DepositForm({ amount, onPaid }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    setErrorMsg('')
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' })
    if (error) {
      setErrorMsg(error.message || 'Payment failed.')
      setSubmitting(false)
      return
    }
    if (paymentIntent?.status === 'succeeded') {
      onPaid()
    } else {
      setErrorMsg('Payment is processing. Please check back in a moment.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {errorMsg && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{errorMsg}</div>}
      <button type="submit" disabled={!stripe || submitting}
        className="w-full bg-gray-900 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-gray-700 transition-colors">
        {submitting ? 'Processing…' : `Pay Deposit — ${fmtMoney(amount)}`}
      </button>
    </form>
  )
}

// Public, no-login page backing /sign-org-contract/:token.
export default function OrgContractSignPage() {
  const { token } = useParams()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const [orgName, setOrgName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [zip, setZip] = useState('')

  const [stripePromise, setStripePromise] = useState(null)
  const [clientSecret, setClientSecret] = useState(null)
  const [depositPaid, setDepositPaid] = useState(false)

  const [signedName, setSignedName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState('')
  const [justSigned, setJustSigned] = useState(null)

  useEffect(() => {
    async function init() {
      try {
        const data = await api.getClientContractSigningInfo(token)
        if (data.error) { setError(data.error); return }
        setInfo(data)
        setOrgName(data.org_name || ''); setContactName(data.contact_name || '')
        setEmail(data.email || ''); setPhone(data.phone || '')
        setStreet(data.street || ''); setCity(data.city || ''); setZip(data.zip || '')
        setDepositPaid(!!data.deposit_paid)

        if (data.already_signed || !data.deposit_amount || data.deposit_paid) return

        const pkRes = await fetch(`${API_ROOT}/api/settings/stripe-public`)
        const pkData = await pkRes.json()
        if (!pkData.publishable_key) return
        const piRes = await api.createClientContractPaymentIntent(token)
        if (piRes.error) { setError(piRes.error); return }
        setClientSecret(piRes.clientSecret)
        setStripePromise(loadStripe(pkData.publishable_key))
      } catch {
        setError('Unable to load this page. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [token])

  async function handleSign(e) {
    e.preventDefault()
    if (!signedName.trim()) { setSignError('Please type your full name.'); return }
    if (!email.trim()) { setSignError('Please enter your email.'); return }
    if (!agreed) { setSignError('Please check the box confirming you\'ve read and agree to the contract.'); return }
    if (info?.deposit_amount && !depositPaid) { setSignError('Please complete the deposit payment above first.'); return }
    setSigning(true)
    setSignError('')
    try {
      const r = await api.signClientContract(token, {
        signed_name: signedName.trim(), org_name: orgName.trim(), contact_name: contactName.trim(),
        email: email.trim(), phone: phone.trim(), street: street.trim(), city: city.trim(), zip: zip.trim(),
      })
      if (r.error) { setSignError(r.error); return }
      setJustSigned(r.signed_at)
    } catch (err) {
      setSignError(err.message || 'Failed to sign. Please try again.')
    } finally {
      setSigning(false)
    }
  }

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

  const alreadySigned = info?.already_signed || justSigned

  if (alreadySigned) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Contract Signed</h2>
        <p className="text-sm text-gray-500">
          Thanks{info?.signed_name ? `, ${info.signed_name}` : ''}! This is confirmed on our end — no further action needed.
        </p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <img src="/logo.jpg" alt="Bring the Gym to Me" className="h-20 mx-auto mb-3 object-contain" />
          <p className="text-xs text-gray-400">Bring the Gym to Me, LLC</p>
          <p className="text-xs text-gray-300 mt-2">Client Waiver &amp; General Contract for Services</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
          <h2 className="text-lg font-bold text-gray-900 mb-3">
            {info?.org_name ? info.org_name : 'Please review and sign below.'}
          </h2>
          <div className="max-h-72 overflow-y-auto border border-gray-100 rounded-lg px-4 py-3 bg-gray-50 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {info?.contract_text}
          </div>

          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Organization Name</label>
              <input value={orgName} onChange={e => setOrgName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Your Name</label>
              <input value={contactName} onChange={e => setContactName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Address of Organization</label>
              <input value={street} onChange={e => setStreet(e.target.value)} placeholder="Street"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <div className="grid grid-cols-2 gap-2">
                <input value={city} onChange={e => setCity(e.target.value)} placeholder="City"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <input value={zip} onChange={e => setZip(e.target.value)} placeholder="Zip"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
            </div>
          </div>
        </div>

        {info?.payment_terms_text && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Payment Agreement</h3>
            <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{info.payment_terms_text}</div>
          </div>
        )}

        {info?.deposit_amount > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">
              {depositPaid ? '✓ Deposit paid' : `Deposit Due — ${fmtMoney(info.deposit_amount)}`}
            </h3>
            {!depositPaid && clientSecret && stripePromise && (
              <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe', variables: { fontFamily: 'system-ui, sans-serif' } } }}>
                <DepositForm amount={info.deposit_amount} onPaid={() => setDepositPaid(true)} />
              </Elements>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
          <form onSubmit={handleSign} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type your full name to sign</label>
              <input value={signedName} onChange={e => setSignedName(e.target.value)}
                placeholder="Jane Doe"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" />
              I have read and agree to the terms above.
            </label>
            {signError && <p className="text-xs text-red-600">{signError}</p>}
            <button type="submit" disabled={signing || (info?.deposit_amount > 0 && !depositPaid)}
              className="w-full bg-gray-900 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-gray-700 transition-colors">
              {signing ? 'Signing…' : 'Sign Contract'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400">
          Questions? Call or text (347) 915-5496.
        </p>
      </div>
    </div>
  )
}
