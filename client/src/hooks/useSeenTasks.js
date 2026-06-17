import { useState } from 'react'

export function useSeenTasks(userKey) {
  const storageKey = userKey ? `bgm_seen_tasks_${userKey}` : null

  const [seen, setSeen] = useState(() => {
    if (!storageKey) return new Set()
    try { return new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')) }
    catch { return new Set() }
  })

  function markSeen(id) {
    if (!storageKey) return
    setSeen(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem(storageKey, JSON.stringify([...next]))
      return next
    })
  }

  return { seen, markSeen }
}
