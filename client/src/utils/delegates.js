import { useEffect, useState } from 'react'
import { api } from '../api/client'

// Everyone a task, an action item or a check-in can be handed to.
//
// This used to be four names typed out at the top of three different files. When Erica was
// hired she got admin rights, a login, an email and a desk — and still appeared in no
// "assign to" box anywhere in the app, because nobody remembered there were three copies
// of the list. A new colleague should need no code change at all, so it's read from the
// same office-people list the @mentions use.
//
// Cached for the session: it's four rows that change once a year, and three components ask
// for it on nearly every page.
const FALLBACK = ['Sarede', 'Maria', 'Claire']
let cache = null

export function useDelegates() {
  const [names, setNames] = useState(cache)

  useEffect(() => {
    if (cache) return
    let live = true
    api.getMentionableUsers()
      .then(us => {
        cache = us.map(u => u.name)
        if (live) setNames(cache)
      })
      // A failed fetch falls back to the names below rather than an empty dropdown —
      // being unable to assign anything at all is worse than a stale list.
      .catch(() => {})
    return () => { live = false }
  }, [])

  return [...(names || FALLBACK), 'Anyone']
}
