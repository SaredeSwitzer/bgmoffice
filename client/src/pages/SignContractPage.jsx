import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'

// Public, no-login page backing /sign-contract/:token — an instructor candidate reads the
// contract and signs it by typing their name. Mirrors SaveCardPage's shape/style.
export default function SignContractPage() {
  const { token } = useParams()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [signedName, setSignedName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState('')
  const [justSigned, setJustSigned] = useState(null)

  useEffect(() => {
    api.getContractSigningInfo(token)
      .then(data => { if (data.error) setError(data.error); else setInfo(data) })
      .catch(() => setError('Unable to load this page. Please try again.'))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSign(e) {
    e.preventDefault()
    if (!signedName.trim()) { setSignError('Please type your full name.'); return }
    if (!agreed) { setSignError('Please check the box confirming you\'ve read and agree to the contract.'); return }
    setSigning(true)
    setSignError('')
    try {
      const r = await api.signContract(token, { signed_name: signedName.trim() })
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
          <p className="text-xs text-gray-300 mt-2">Independent Contractor Agreement</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
          <h2 className="text-lg font-bold text-gray-900 mb-1">
            {info?.name ? `Hi ${info.name}, please review and sign below.` : 'Please review and sign below.'}
          </h2>
          <div className="mt-4 max-h-96 overflow-y-auto border border-gray-100 rounded-lg px-4 py-3 bg-gray-50 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {info?.contract_text}
          </div>

          <form onSubmit={handleSign} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type your full name to sign</label>
              <input value={signedName} onChange={e => setSignedName(e.target.value)}
                placeholder="Jane Doe"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
                className="mt-0.5" />
              I have read and agree to the terms above.
            </label>
            {signError && <p className="text-xs text-red-600">{signError}</p>}
            <button type="submit" disabled={signing}
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
