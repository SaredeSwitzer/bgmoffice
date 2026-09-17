import { Link } from 'react-router-dom'
import { findPersonInText, getDirectory } from './directory'

// "waiting to hear back", however it's punctuated. Staff write this constantly in notes
// (see any open case), and it's the exact thing the Waiting to Hear Back From tab
// tracks — so the phrase becomes a link to whoever it's about.
const WAITING_RE = /waiting to hear back/gi

// How far past the phrase to look for a name. One clause, roughly — far enough to catch
// "waiting to hear back from Stephanie", short enough that the next sentence about a
// different person doesn't get picked up.
const LOOKAHEAD = 60

// Turns a plain (non-mention) run of note text into links.
//
// Two kinds. "waiting to hear back" points at whoever it is about — a name written after
// the phrase, else the person whose screen this is, else the waiting tab. And any client
// or instructor NAMED in the note becomes a link to their profile, so reading a note and
// getting to the person in it is one click instead of a search.
//
// Names are matched conservatively, because a link that goes to the wrong person is worse
// than no link: someone reading "Leah cancelled" and landing on the wrong Leah will act on
// it. A full name written out is unambiguous and always links. A bare first name links
// ONLY when exactly one person in the book has it — of 186 people, 18 first names are
// shared, and "Leah" alone is seven different clients.
const NOT_A_NAME = new Set([
  'the', 'and', 'for', 'with', 'from', 'her', 'his', 'them', 'they', 'she', 'him',
  'class', 'client', 'mom', 'dad', 'kids', 'new', 'next', 'week', 'back', 'call',
  'text', 'email', 'time', 'date', 'this', 'that', 'will', 'can', 'not', 'yes', 'sub',
])

function hrefFor(p) {
  return p.kind === 'client' ? `/clients/${p.id}` : `/instructors/${p.id}`
}

// Every place a person is named in this chunk, longest name first so "Chaya Retek" wins
// over the "Chaya" inside it.
function nameMatches(chunk, people) {
  if (!people?.length) return []
  const hay = chunk.toLowerCase()
  const byFirst = new Map()
  for (const p of people) {
    const f = String(p.name || '').trim().split(/\s+/)[0].toLowerCase()
    if (!f) continue
    byFirst.set(f, (byFirst.get(f) || []).concat(p))
  }

  const found = []
  const push = (start, len, person) => found.push({ start, end: start + len, person })

  for (const p of people) {
    const name = String(p.name || '').trim().toLowerCase()
    if (name.length < 4) continue
    let i = hay.indexOf(name)
    while (i !== -1) {
      push(i, name.length, p)
      i = hay.indexOf(name, i + name.length)
    }
  }

  // Lone first names, only where they cannot be confused with anybody else.
  const WORD = /[A-Za-z][\w'-]*/g
  let w
  while ((w = WORD.exec(chunk))) {
    const word = w[0].toLowerCase()
    if (word.length < 4 || NOT_A_NAME.has(word)) continue
    const hits = byFirst.get(word)
    if (hits?.length === 1) push(w.index, w[0].length, hits[0])
  }

  // Longest first, then earliest, and drop anything overlapping one already kept.
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)
  const kept = []
  for (const f of found) {
    if (kept.some(k => f.start < k.end && k.start < f.end)) continue
    kept.push(f)
  }
  return kept.sort((a, b) => a.start - b.start)
}

function linkWaitingPhrases(chunk, keyBase, context, people) {
  if (!chunk) return [chunk]

  // Both kinds of match in one pass, so a name inside a "waiting to hear back" phrase
  // cannot be linked twice or cut the phrase in half.
  const spans = []
  WAITING_RE.lastIndex = 0
  let m
  while ((m = WAITING_RE.exec(chunk))) {
    const after = chunk.slice(m.index + m[0].length, m.index + m[0].length + LOOKAHEAD)
    const person = findPersonInText(after)
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'phrase',
      href: person ? hrefFor(person)
        : context?.clientId ? `/clients/${context.clientId}`
        : context?.instructorId ? `/instructors/${context.instructorId}`
        : '/clients?tab=waiting',
      title: person ? `Waiting on ${person.name}` : 'Waiting to Hear Back From',
    })
  }
  for (const n of nameMatches(chunk, people)) {
    if (spans.some(sp => n.start < sp.end && sp.start < n.end)) continue
    spans.push({
      start: n.start, end: n.end, kind: 'person',
      href: hrefFor(n.person), title: `Open ${n.person.name}`,
    })
  }
  spans.sort((a, b) => a.start - b.start)

  const parts = []
  let last = 0
  for (const sp of spans) {
    if (sp.start > last) parts.push(chunk.slice(last, sp.start))
    parts.push(
      <Link
        key={`${sp.kind}-${keyBase}-${sp.start}`}
        to={sp.href}
        title={sp.title}
        className={sp.kind === 'phrase'
          ? 'text-purple-700 underline decoration-dotted underline-offset-2 hover:text-purple-900'
          : 'text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900'}
      >
        {chunk.slice(sp.start, sp.end)}
      </Link>
    )
    last = sp.end
  }
  if (last < chunk.length) parts.push(chunk.slice(last))
  return parts
}

// Highlights "@Full Name" substrings in saved note text, matched against the same
// active-users list the composer autocompletes against. Mirrors the matching rules
// in server/lib/mentions.js (longest name first, case-sensitive substring).
//
// Also links any "waiting to hear back" phrase, and any client or instructor named in the
// note — done here rather than at each of the nine call sites so every note gets it
// without them each needing a people list. The people list comes from the shared
// directory, which every screen already loads for exactly this.
// `context` is optional: pass { clientId, instructorId } for a better fallback target.
export function renderWithMentions(text, users, context) {
  if (!text) return text
  const people = getDirectory()
  const names = [...(users || [])]
    .map(u => u.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (!names.length) return linkWaitingPhrases(text, 0, context, people)

  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'g')

  const parts = []
  let lastIndex = 0
  let m
  while ((m = pattern.exec(text))) {
    // Only the text *between* mentions gets waiting-links, so a name inside an
    // "@Someone" tag is never swallowed by one.
    if (m.index > lastIndex) parts.push(...linkWaitingPhrases(text.slice(lastIndex, m.index), lastIndex, context, people))
    parts.push(
      <span key={m.index} className="font-semibold text-blue-700 bg-blue-50 rounded px-0.5">
        @{m[1]}
      </span>
    )
    lastIndex = m.index + m[0].length
  }
  parts.push(...linkWaitingPhrases(text.slice(lastIndex), lastIndex, context, people))
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
