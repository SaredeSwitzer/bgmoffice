import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from '../api/client'

const RemindersContext = createContext({ overdueCount: 0, refresh: () => {} })

export function RemindersProvider({ children }) {
  const [overdueCount, setOverdueCount] = useState(0)

  const refresh = useCallback(() => {
    api.getReminders()
      .then(({ overdue }) => setOverdueCount(overdue.length))
      .catch(() => {})
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <RemindersContext.Provider value={{ overdueCount, refresh }}>
      {children}
    </RemindersContext.Provider>
  )
}

export const useRemindersContext = () => useContext(RemindersContext)
