import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../api/client'

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

  async function login(email, password) {
    const data = await api.login(email, password)
    localStorage.setItem('bgm_token', data.token)
    setUser(data.user)
    return data.user
  }

  function logout() {
    localStorage.removeItem('bgm_token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
