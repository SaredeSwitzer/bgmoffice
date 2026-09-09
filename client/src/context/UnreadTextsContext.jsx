import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from '../api/client'

// How many texts are waiting, known everywhere in the app.
//
// A reply used to arrive silently: unless you happened to be on the Texts screen you had
// no way of knowing somebody had written back. The count lives behind the whole signed-in
// app so the bell in the top bar can show it from any page.
//
// Polled rather than pushed — this is a small count, once a minute, and a real-time
// connection is a lot of machinery for "somebody texted". It also refreshes the moment
// you come back to the tab, which is when you'd actually look.
const POLL_MS = 60_000

const UnreadTextsContext = createContext({ unread: 0, threads: 0, refresh: () => {} })

export function UnreadTextsProvider({ children }) {
  const [state, setState] = useState({ unread: 0, threads: 0 })

  const refresh = useCallback(() => {
    api.smsUnreadCount()
      .then(r => setState({ unread: r?.unread || 0, threads: r?.threads || 0 }))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [refresh])

  return (
    <UnreadTextsContext.Provider value={{ ...state, refresh }}>
      {children}
    </UnreadTextsContext.Provider>
  )
}

export const useUnreadTexts = () => useContext(UnreadTextsContext)
