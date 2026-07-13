import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'

// Offers Touch ID setup to whoever is signed in, once, and then never nags again.
//
// It lives in NavShell rather than Settings because Settings is admin-only and Sarede's own
// account is `staff` — she could never have reached it. Staff who never turn it on simply keep
// using the emailed code; nothing breaks.
const DISMISS_KEY = 'bgm_passkey_prompt_dismissed'

export default function PasskeyPrompt() {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!browserSupportsWebAuthn()) return
    if (localStorage.getItem(DISMISS_KEY)) return
    // Only offer it to people who don't already have one on this account.
    api.getPasskeys()
      .then((list) => setShow(list.length === 0))
      .catch(() => {})
  }, [])

  async function enable() {
    setBusy(true)
    setError('')
    try {
      const options = await api.passkeyRegisterOptions()
      const response = await startRegistration({ optionsJSON: options })
      await api.passkeyRegister(response, deviceLabel())
      setDone(true)
      setTimeout(() => setShow(false), 2500)
    } catch (err) {
      // Cancelling the system prompt isn't an error — just let her be.
      if (err?.name === 'NotAllowedError' || /abort/i.test(err?.message || '')) {
        setBusy(false)
        return
      }
      setError(err.message || 'Could not set that up.')
    } finally {
      setBusy(false)
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="bg-gray-900 text-white px-4 py-2.5 flex items-center justify-center gap-3 text-sm">
      {done ? (
        <span>✓ Done — next time, just tap to sign in.</span>
      ) : (
        <>
          <span className="text-gray-200">
            {error || 'Skip the email code — sign in with Touch ID next time.'}
          </span>
          <button
            onClick={enable}
            disabled={busy}
            className="bg-white text-gray-900 font-medium px-3 py-1 rounded-md hover:bg-gray-100 disabled:opacity-50"
          >
            {busy ? 'Setting up…' : 'Turn on Touch ID'}
          </button>
          <button onClick={dismiss} className="text-gray-400 hover:text-white text-xs underline">
            Not now
          </button>
        </>
      )}
    </div>
  )
}

// So she can tell her devices apart later ("MacBook" vs "iPhone").
function deviceLabel() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Windows/.test(ua)) return 'Windows PC'
  return 'This device'
}
