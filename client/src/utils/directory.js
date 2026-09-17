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

// Everyone the directory recognises in a piece of text — for the Waiting On prompt, which
// SHOWS what it found and lets you correct it before anything is saved.
//
// Deliberately looser than findPersonInText above, which links a name in saved note text
// and so must never be wrong. Here a wrong guess costs one untick, while a missed name
// costs the thing this exists for: "asked whitney and waiting to hear back" is the real
// note that started this, and the strict version found nobody in it — no "from", and no
// surname to match on.
//
// The guard against nonsense is a length floor plus a stop list. An early scan matched
// "the" in "waiting to hear back on the exact date" to a client called "The Gateway
// School"; these are the words that cause that.
const NOT_A_NAME = new Set([
  'the', 'and', 'for', 'with', 'from', 'her', 'his', 'them', 'they', 'she', 'him',
  'class', 'client', 'mom', 'dad', 'kids', 'new', 'next', 'week', 'back', 'call',
  'text', 'email', 'time', 'date', 'this', 'that', 'will', 'can', 'not', 'yes', 'sub',
]);

export function findPeopleInText(text, { exclude = [] } = {}) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const hay = raw.toLowerCase();
  const skip = new Set(exclude.map(e => `${e.kind}-${e.id}`));
  const words = new Set(hay.split(/[^a-z'-]+/).filter(Boolean));
  const found = [];
  const seen = new Set();

  for (const p of directory) {
    const key = `${p.kind}-${p.id}`;
    if (skip.has(key) || seen.has(key)) continue;
    const name = String(p.name || '').trim().toLowerCase();
    if (!name) continue;

    // The whole name written out is unambiguous however it is punctuated around.
    let hit = name.length >= 4 && hay.includes(name);

    // Otherwise their first name as a word of its own.
    if (!hit) {
      const first = name.split(/\s+/)[0];
      hit = first.length >= 4 && !NOT_A_NAME.has(first) && words.has(first);
    }
    if (hit) { seen.add(key); found.push(p); }
  }
  return found;
}
