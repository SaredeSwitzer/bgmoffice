import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'

// Sign-in has two paths. The everyday one is a 6-digit code emailed to you — nothing to
// remember, nothing to leak. The password path stays as a backup for when email is down;
// it expects a long random password out of a password manager, not one you type from memory.
//
// Steps: 'email' → 'code' (the code path), or 'password' (the backup path).

export default function LoginPage() {
  const { login, loginWithCode } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState('email')
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

  const requestCode = (e) => {
    e.preventDefault()
    run(async () => {
      const res = await api.requestCode(email)
      setSentTo(res.sent_to)
      setCode('')
      setStep('code')
    })
  }

  const submitCode = (e) => {
    e.preventDefault()
    run(async () => {
      await loginWithCode(email, code)
      navigate('/')
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
