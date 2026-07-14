import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../api/client'
import { startAuthentication } from '@simplewebauthn/browser'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('bgm_token')
    if (!token) { setLoading(false); return }
    api.me()
      .then(setUser)
      .catch(() => localStorage.removeItem('bgm_token'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function onSessionExpired() { setUser(null) }
    window.addEventListener('bgm:session-expired', onSessionExpired)
    return () => window.removeEventListener('bgm:session-expired', onSessionExpired)
  }, [])

  // Both sign-in paths end in the same token — the code path just proves who you are
  // with an emailed code instead of a password.
  function accept(data) {
    localStorage.setItem('bgm_token', data.token)
    setUser(data.user)
    return data.user
  }

  async function login(email, password) {
    return accept(await api.login(email, password))
  }

  async function loginWithCode(email, code, accountId) {
    return accept(await api.verifyCode(email, code, accountId))
  }

  // Touch ID / Face ID. Two round trips: get a challenge, let the device sign it, send it back.
  // Ends in the same token as every other sign-in path.
  async function loginWithPasskey() {
    const options = await api.passkeyLoginOptions()
    const response = await startAuthentication({ optionsJSON: options })
    return accept(await api.passkeyLogin(response))
  }

  function logout() {
    localStorage.removeItem('bgm_token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithCode, loginWithPasskey, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
