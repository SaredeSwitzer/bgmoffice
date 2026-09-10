const pool = require('../db/pg');

// Who is this text about?
//
// A Waiting On line is one thread of work, and most threads have two people in them:
// "Aneya covering Leah's Thursday" is one line with the instructor and the client on it.
// When a line is started from the Texts screen we know one of them — the person being
// texted — and the other is usually named in the message itself.
//
// So the message is read for names we already know. What comes back is a *suggestion*,
// offered with the name showing and changeable. It is never added silently: a wrong name
// attached to a line by itself is worse than no name, because nobody would think to check
// it.

// "Etty" on its own is worth matching; "Le" is not, and a name shared by two clients tells
// us nothing about which one.
const MIN_NAME = 3;

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word, case-insensitive. Apostrophes and possessives are common in these texts
// ("Etty's class"), so a trailing 's is allowed to follow the name.
function mentions(text, name) {
  if (!name || name.length < MIN_NAME) return false;
  return new RegExp(`(^|[^\\p{L}])${escape(name)}(’s|'s)?($|[^\\p{L}])`, 'iu').test(text);
}

// A first name is only worth matching on when the record is a person. Half these clients
// are places — "The Gateway School" was matching the word "the" in any message.
const ORG_WORDS = /\b(school|center|centre|circle|camp|academy|jcc|senior|shala|society|club|council|program|programme)\b/i;

function looksLikePersonName(name) {
  const words = name.trim().split(/\s+/);
  return words.length >= 2 && words.length <= 4 && !ORG_WORDS.test(name);
}

// A client filed as "HaMaspik - Charny Schonfeld" should match on either half, and one
// called "Gitty Lax for mom Toby Kain" on the names inside it — but the whole string is
// what gets put on the line.
function candidateNames(fullName) {
  const name = String(fullName || '').trim();
  if (!name) return [];
  const parts = new Set([name]);
  for (const chunk of name.split(/\s*[-–—]{1,2}\s*|\s*\(/)) {
    const c = chunk.replace(/\)$/, '').trim();
    if (c.length >= MIN_NAME) parts.add(c);
  }
  // A bare first name, but only for people, and only one long enough to mean something.
  const first = name.split(/\s+/)[0];
  if (first && first.length >= 4 && looksLikePersonName(name)) parts.add(first);
  return [...parts];
}

// Returns [{ id, kind, name, matched }] — most specific match first. `kind` is filtered by
// the caller: texting an instructor looks for clients, and the other way round.
async function findPeopleInText(text, { kinds = ['client', 'instructor'] } = {}) {
  const body = String(text || '');
  if (!body.trim()) return [];

  const { rows: people } = await pool.query(`
    SELECT id, name, 'client' AS kind FROM clients WHERE coalesce(name,'') <> ''
    UNION ALL
    SELECT id, name, 'instructor' AS kind FROM instructors WHERE coalesce(name,'') <> ''
  `);

  // A name that several people share can't identify anybody, so it's dropped rather than
  // guessed at — "Leah" is three different clients.
  const seen = new Map();
  for (const p of people) {
    for (const candidate of candidateNames(p.name)) {
      const key = candidate.toLowerCase();
      seen.set(key, seen.has(key) ? null : p);   // null marks it as ambiguous
    }
  }

  const hits = new Map();
  for (const [key, person] of seen) {
    if (!person || !kinds.includes(person.kind)) continue;
    if (!mentions(body, key)) continue;
    const existing = hits.get(`${person.kind}-${person.id}`);
    // Prefer the longest matched form — "Charny Schonfeld" beats "Charny".
    if (!existing || key.length > existing.matched.length) {
      hits.set(`${person.kind}-${person.id}`, { ...person, matched: key });
    }
  }

  return [...hits.values()].sort((a, b) => b.matched.length - a.matched.length);
}

module.exports = { findPeopleInText, candidateNames, mentions };
