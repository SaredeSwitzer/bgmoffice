// Finds instructor records that look like they might already be the same person.
//
// Built after a real merge (2026-08-27) where "David Ostrevsky" and "David Outevsky"
// sat side by side for months: an exact-name check finds nothing, because the whole
// reason a duplicate gets created is that somebody typed the name differently. So this
// matches on the things people DON'T retype — email and phone — plus a deliberately
// loose name comparison.
//
// Used at the two points a new instructor can enter the system: the public /join
// sign-up (instructorSignup.js) and staff's Add Instructor (instructors.js).

const pool = require('../db/pg');

const normName = s => String(s || '')
  .toLowerCase()
  .replace(/[^a-z\s]/g, '')   // drop punctuation, quotes, nicknames' quote marks
  .replace(/\s+/g, ' ')
  .trim();

// Last 10 digits — ignores a leading 1 and any formatting, so "(201) 724-8656" and
// "+1 2017248656" compare equal.
const normPhone = s => {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

// Standard iterative Levenshtein. Names are short, so the O(n*m) cost is irrelevant.
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

// How close two names have to be to be worth flagging. Scaled to length so short names
// aren't matched on a coincidence — "Coco Lee" vs "Cody Lee" is 2 edits but a big share
// of an 8-character name, while "Ostrevsky" vs "Outevsky" is 2 edits out of 9.
function namesLookAlike(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;

  const dist = levenshtein(a, b);
  if (dist <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 5))) return true;

  const pa = a.split(' ');
  const pb = b.split(' ');
  if (pa.length >= 2 && pb.length >= 2) {
    const lastA = pa[pa.length - 1];
    const lastB = pb[pb.length - 1];
    // Same-ish surname plus the same first initial — catches "Sarah Garcia" vs
    // "Sarah Garcea" and married/maiden-style variations on the same first name.
    if (pa[0][0] === pb[0][0] && levenshtein(lastA, lastB) <= 2) return true;
  }

  // One record is just a first name ("Vanessa") and the other starts with it.
  if (pa.length === 1 && pb[0] === pa[0]) return true;
  if (pb.length === 1 && pa[0] === pb[0]) return true;

  return false;
}

/**
 * @param {{name?: string, email?: string, phone?: string, excludeId?: number|string}} candidate
 * @returns {Promise<Array<{id, name, email, phone, reason}>>} strongest match reason first
 */
async function findDuplicateInstructors({ name, email, phone, excludeId } = {}) {
  const n = normName(name);
  const e = String(email || '').trim().toLowerCase();
  const p = normPhone(phone);
  if (!n && !e && !p) return [];

  const { rows } = await pool.query('SELECT id, name, email, phone FROM instructors');

  const hits = [];
  for (const row of rows) {
    // Postgres bigint arrives as a string — compare as strings, not with ===.
    if (excludeId != null && String(row.id) === String(excludeId)) continue;

    let reason = null;
    if (e && String(row.email || '').trim().toLowerCase() === e) reason = 'same email';
    else if (p && normPhone(row.phone) === p) reason = 'same phone number';
    else if (n && namesLookAlike(n, normName(row.name))) {
      reason = normName(row.name) === n ? 'same name' : 'similar name';
    }

    if (reason) hits.push({ id: row.id, name: row.name, email: row.email, phone: row.phone, reason });
  }

  const rank = { 'same email': 0, 'same phone number': 1, 'same name': 2, 'similar name': 3 };
  hits.sort((a, b) => rank[a.reason] - rank[b.reason]);
  return hits;
}

// One-line summary for a Telegram alert or a UI banner.
function describeDuplicates(hits) {
  return hits.map(h => `${h.name} (${h.reason})`).join(', ');
}

module.exports = { findDuplicateInstructors, describeDuplicates };
