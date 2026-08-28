import { Link } from 'react-router-dom'
import { findPersonInText } from './directory'

// "waiting to hear back", however it's punctuated. Staff write this constantly in notes
// (see any open case), and it's the exact thing the Waiting to Hear Back From tab
// tracks — so the phrase becomes a link to whoever it's about.
const WAITING_RE = /waiting to hear back/gi

// How far past the phrase to look for a name. One clause, roughly — far enough to catch
// "waiting to hear back from Stephanie", short enough that the next sentence about a
// different person doesn't get picked up.
const LOOKAHEAD = 60

// Splits a plain (non-mention) run of text, turning each "waiting to hear back" into a
// link. Target order: a person actually named after the phrase, else the client or
// instructor whose screen we're on, else the Clients waiting tab.
function linkWaitingPhrases(chunk, keyBase, context) {
  if (!chunk) return [chunk]
  const parts = []
  let last = 0
  let m
  WAITING_RE.lastIndex = 0
  while ((m = WAITING_RE.exec(chunk))) {
    if (m.index > last) parts.push(chunk.slice(last, m.index))

    const after = chunk.slice(m.index + m[0].length, m.index + m[0].length + LOOKAHEAD)
    const person = findPersonInText(after)
    const href = person
      ? (person.kind === 'client' ? `/clients/${person.id}` : `/instructors/${person.id}`)
      : context?.clientId ? `/clients/${context.clientId}`
      : context?.instructorId ? `/instructors/${context.instructorId}`
      : '/clients?tab=waiting'

    parts.push(
      <Link
        key={`w-${keyBase}-${m.index}`}
        to={href}
        title={person ? `Waiting on ${person.name}` : 'Waiting to Hear Back From'}
        className="text-purple-700 underline decoration-dotted underline-offset-2 hover:text-purple-900"
      >
        {m[0]}
      </Link>
    )
    last = m.index + m[0].length
  }
  if (last < chunk.length) parts.push(chunk.slice(last))
  return parts
}

// Highlights "@Full Name" substrings in saved note text, matched against the same
// active-users list the composer autocompletes against. Mirrors the matching rules
// in server/lib/mentions.js (longest name first, case-sensitive substring).
//
// Also links any "waiting to hear back" phrase — done here rather than at each of the
// nine call sites so every note gets it without them each needing a people list.
// `context` is optional: pass { clientId, instructorId } for a better fallback target.
export function renderWithMentions(text, users, context) {
  if (!text) return text
  const names = [...(users || [])]
    .map(u => u.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (!names.length) return linkWaitingPhrases(text, 0, context)

  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'g')

  const parts = []
  let lastIndex = 0
  let m
  while ((m = pattern.exec(text))) {
    // Only the text *between* mentions gets waiting-links, so a name inside an
    // "@Someone" tag is never swallowed by one.
    if (m.index > lastIndex) parts.push(...linkWaitingPhrases(text.slice(lastIndex, m.index), lastIndex, context))
    parts.push(
      <span key={m.index} className="font-semibold text-blue-700 bg-blue-50 rounded px-0.5">
        @{m[1]}
      </span>
    )
    lastIndex = m.index + m[0].length
  }
  parts.push(...linkWaitingPhrases(text.slice(lastIndex), lastIndex, context))
  return parts
}

// Removes "@Full Name" tags entirely — for text that's about to leave the app in a
// form the client sees (an invoice PDF), where the mention already did its job
// notifying a teammate and has no business showing up as literal text. Server has its
// own copy in server/lib/mentions.js for the same reason on the public API side.
export function stripMentions(text, users) {
  if (!text) return text
  const names = [...(users || [])]
    .map(u => u.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (!names.length) return text

  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'g')
  return text.replace(pattern, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
}
