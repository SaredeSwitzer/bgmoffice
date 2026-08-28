import { api } from '../api/client'

// A single cached client+instructor name list, fetched once per session.
//
// It exists so note text can be rendered with links (see utils/mentions.jsx) without
// every screen that shows a note having to fetch and thread a people list through props
// — there are nine such places, and most don't otherwise need one.
let directory = []
let inflight = null

export function getDirectory() {
  return directory
}

export function loadDirectory() {
  if (directory.length) return Promise.resolve(directory)
  if (!inflight) {
    inflight = api.getDirectory()
      .then(rows => { directory = rows || []; return directory })
      .catch(() => [])          // a missing directory just means no auto-links
      .finally(() => { inflight = null })
  }
  return inflight
}

export function clearDirectory() {
  directory = []
}

// Finds whoever a phrase like "waiting to hear back from Stephanie" is about, by looking
// at the text that follows the phrase.
//
// Order matters, and it is deliberately conservative — a wrong link is worse than none:
//   1. A full name appearing verbatim ("...from Chaya Retek about the address").
//   2. A first name directly after "from", and only when exactly one person has it.
// A bare scan for any word matching someone's first name was tried and dropped: it
// matched "the" in "waiting to hear back on the exact date" to a client called
// "The Gateway School".
const FROM_RE = /\bfrom\s+([A-Za-z][\w'-]*)/i

export function findPersonInText(text) {
  if (!text) return null
  const hay = text.toLowerCase()

  const full = directory.find(p => {
    const name = (p.name || '').trim().toLowerCase()
    return name.length >= 4 && hay.includes(name)
  })
  if (full) return full

  const m = hay.match(FROM_RE)
  if (m) {
    const word = m[1].toLowerCase()
    const hits = directory.filter(p => (p.name || '').trim().toLowerCase().split(/\s+/)[0] === word)
    if (hits.length === 1) return hits[0]
  }
  return null
}
