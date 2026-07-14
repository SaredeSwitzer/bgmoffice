import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { browserSupportsWebAuthn } from '@simplewebauthn/browser'

// Sign-in has two paths. The everyday one is a 6-digit code emailed to you — nothing to
// remember, nothing to leak. The password path stays as a backup for when email is down;
// it expects a long random password out of a password manager, not one you type from memory.
//
// Steps: 'email' → 'code' (the code path), or 'password' (the backup path).

export default function LoginPage() {
  const { login, loginWithCode, loginWithPasskey } = useAuth()
  const navigate = useNavigate()
  // Only offer the passkey button where it can actually work — showing a Touch ID button that
  // does nothing is worse than not showing one.
  const [canPasskey] = useState(() => browserSupportsWebAuthn())

  const [step, setStep] = useState('email')
  // When one email maps to several accounts (Sarede is both Admin and a staff user), we ask which
  // one she means BEFORE sending a code — so the code belongs to that account.
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function run(fn) {
    setError('')
    setLoading(true)
    try {
      await fn()
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const requestCode = (e, forAccountId = accountId) => {
    e?.preventDefault?.()
    run(async () => {
      const res = await api.requestCode(email, forAccountId)
      if (res.choose) {
        setAccounts(res.choose)
        setStep('account')
        return
      }
      setSentTo(res.sent_to)
      setCode('')
      setStep('code')
    })
  }

  const pickAccount = (id) => {
    setAccountId(id)
    requestCode(null, id)
  }

  const submitCode = (e) => {
    e.preventDefault()
    run(async () => {
      await loginWithCode(email, code, accountId)
      navigate('/')
    })
  }

  const signInWithPasskey = () => {
    run(async () => {
      try {
        await loginWithPasskey()
        navigate('/')
      } catch (err) {
        // The user cancelling the Touch ID prompt is not an error worth shouting about.
        if (err?.name === 'NotAllowedError' || /abort/i.test(err?.message || '')) return
        throw err
      }
    })
  }

  const submitPassword = (e) => {
    e.preventDefault()
    run(async () => {
      await login(email, password)
      navigate('/')
    })
  }

  function switchTo(next) {
    setError('')
    setCode('')
    setPassword('')
    setAccountId(null)
    setStep(next)
  }

  const inputClass =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400'
  const buttonClass =
    'w-full bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50'
  const linkClass = 'text-xs text-gray-500 hover:text-gray-800 underline'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">BGM Office</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to your account</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded mb-4">
              {error}
            </div>
          )}

          {step === 'email' && canPasskey && (
            <div className="mb-4">
              <button
                type="button"
                onClick={signInWithPasskey}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-900 text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3z" />
                  <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
                </svg>
                Sign in with Touch ID
              </button>
              <div className="flex items-center gap-3 my-4">
                <div className="h-px bg-gray-200 flex-1" />
                <span className="text-xs text-gray-400">or</span>
                <div className="h-px bg-gray-200 flex-1" />
              </div>
            </div>
          )}

          {step === 'email' && (
            <form onSubmit={requestCode} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@bgmoffice.com"
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <button type="submit" disabled={loading} className={buttonClass}>
                {loading ? 'Sending…' : 'Email me a code'}
              </button>
              <p className="text-xs text-gray-400 text-center">
                We'll send you a 6-digit code. No password needed.
              </p>
              <div className="text-center pt-1">
                <button type="button" onClick={() => switchTo('password')} className={linkClass}>
                  Use my password instead
                </button>
              </div>
            </form>
          )}

          {step === 'account' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">Which account?</p>
              <p className="text-xs text-gray-500 -mt-2">
                That email is used by more than one account.
              </p>
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pickAccount(a.id)}
                  disabled={loading}
                  className="w-full text-left border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
                >
                  <div className="text-sm font-medium text-gray-900">{a.name}</div>
                  <div className="text-xs text-gray-500">
                    {a.role === 'admin' ? 'Admin — full access' : 'Staff'}
                  </div>
                </button>
              ))}
              <div className="text-center pt-1">
                <button type="button" onClick={() => switchTo('email')} className={linkClass}>
                  Use a different email
                </button>
              </div>
            </div>
          )}

          {step === 'code' && (
            <form onSubmit={submitCode} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Enter the code
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Sent to <span className="font-medium text-gray-700">{sentTo}</span>. It expires in
                  10 minutes.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  className={`${inputClass} text-center text-2xl tracking-[0.4em] font-semibold`}
                  placeholder="000000"
                  autoComplete="one-time-code"
                  autoFocus
                />
              </div>
              <button type="submit" disabled={loading || code.length < 6} className={buttonClass}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={() => switchTo('email')} className={linkClass}>
                  Use a different email
                </button>
                <button type="button" onClick={requestCode} disabled={loading} className={linkClass}>
                  Send a new code
                </button>
              </div>
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={submitPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@bgmoffice.com"
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
              <button type="submit" disabled={loading} className={buttonClass}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
              <div className="text-center pt-1">
                <button type="button" onClick={() => switchTo('email')} className={linkClass}>
                  Email me a code instead
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
