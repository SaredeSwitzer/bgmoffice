const pool = require('./../db/pg');

// What gets typed on a class is often the only place a rate, a payment method or an age
// range was ever written down. The client's own profile stays blank, so the next person
// to open it sees nothing and asks again — and the invoice, the confirmation email and
// the intake sheet all have a hole in them.
//
// So: whatever staff fill in on a class is copied up onto the client's and the
// instructor's profile, but ONLY into fields that are empty. An existing answer is never
// touched — the profile is the considered version and a single class is not allowed to
// overwrite it. Nothing here fails a class save either; a class being created matters
// more than the copy, so a problem is logged and swallowed.
//
// Everything filled is reported back so the person who typed it is told what else it
// changed, rather than finding out later.

// Only a real answer travels. Blank, and the placeholders staff type when they don't yet
// know ("tbd", "?", "n/a"), stay where they are.
const PLACEHOLDER = /^(tbd|tba|n\/?a|\?+|unknown|none)\.?$/i;

function meaningful(v) {
  const s = String(v ?? '').trim();
  return s && !PLACEHOLDER.test(s) ? s : null;
}

function blank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// A rate reads better as the words staff typed ("$35 per child, 4 minimum") than as the
// number the billing column needs, so the note wins when there is one.
function rateFrom(charge_amount, charge_note) {
  const note = meaningful(charge_note);
  if (note) return note;
  const n = Number(charge_amount);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

// class_schedules.participant_count is free text ("6", "6-8 kids"); the client's default
// is a plain integer, so only a clean number is worth copying.
function countFrom(participant_count) {
  const s = meaningful(participant_count);
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

// [column, value, label] — label is what the person who typed it is told.
function clientFills(cls) {
  return [
    ['rate_per_class',         rateFrom(cls.charge_amount, cls.charge_note), 'rate per class'],
    ['default_payment_method', meaningful(cls.payment_method),               'payment method'],
    ['default_style',          meaningful(cls.style),                        'class style'],
    ['default_participants',   countFrom(cls.participant_count),             'number of participants'],
    ['default_age',            meaningful(cls.participant_ages),             'age of participants'],
  ];
}

function instructorFills(cls) {
  const pay = Number(cls.instructor_pay);
  return [
    ['pay_rate',      Number.isFinite(pay) && pay > 0 ? String(pay) : null, 'pay rate'],
    ['styles_taught', meaningful(cls.style),                                'styles taught'],
  ];
}

async function fillRow(table, id, fills) {
  const { rows: [row] } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!row) return [];

  const sets = [];
  const args = [];
  const filled = [];
  for (const [column, value, label] of fills) {
    if (value === null || !blank(row[column])) continue;
    args.push(value);
    sets.push(`${column} = $${args.length}`);
    filled.push(label);
  }
  if (!sets.length) return [];

  args.push(id);
  await pool.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
  return filled;
}

// Returns [{ kind: 'client'|'instructor', id, name, filled: ['rate per class', …] }].
async function backfillProfilesFromClass(cls = {}) {
  const updates = [];
  try {
    if (cls.client_id) {
      const filled = await fillRow('clients', cls.client_id, clientFills(cls));
      if (filled.length) {
        const { rows: [c] } = await pool.query('SELECT name FROM clients WHERE id = $1', [cls.client_id]);
        updates.push({ kind: 'client', id: String(cls.client_id), name: c?.name || 'this client', filled });
      }
    }
    if (cls.instructor_id) {
      const filled = await fillRow('instructors', cls.instructor_id, instructorFills(cls));
      if (filled.length) {
        const { rows: [i] } = await pool.query('SELECT name FROM instructors WHERE id = $1', [cls.instructor_id]);
        updates.push({ kind: 'instructor', id: String(cls.instructor_id), name: i?.name || 'this instructor', filled });
      }
    }
  } catch (e) {
    console.error('[profileBackfill] could not copy class details onto a profile:', e.message);
  }
  return updates;
}

module.exports = { backfillProfilesFromClass };
