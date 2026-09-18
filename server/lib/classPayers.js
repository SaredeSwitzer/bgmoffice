const pool = require('../db/pg');

// Who shares the cost of a class.
//
// A class belongs to one client everywhere else in this app, and for almost every class
// that is the truth. But Baila Gutman's Tuesday is $105 split between Baila, Chaya Rosner
// and a third woman, and there was nowhere to say so — the payment method said
// "CC-divide", which is a note to a human, not something the app could act on.
//
// Reading the list is deliberately a *fallback chain*, not a stored field:
//
//   this week's override  →  the standing list on the recurring class  →  just the client
//
// so a class nobody shares needs no rows at all and behaves exactly as it always has, and
// a person joining late or missing a week is one week's override rather than an edit that
// has to be pushed out to every future session. Nothing is copied onto sessions, so
// nothing can drift out of step with them — which is the bug that has bitten the schedule
// three times already.
//
// The even split itself lives in the `session_payer_shares` view (migration 033) because
// the weekly charge run sums it in SQL. This module is the read/write side for the UI.

// The standing list for a recurring class, or the override for one session.
async function listPayers({ schedule_id, session_id }) {
  const col = schedule_id ? 'schedule_id' : 'session_id';
  const id  = schedule_id || session_id;
  if (!id) return [];
  const { rows } = await pool.query(
    `SELECT p.id, p.client_id, c.name AS client_name,
            c.card_brand, c.card_last4,
            (c.card_last4 IS NOT NULL) AS has_card,
            p.created_by, p.created_at
       FROM class_payers p
       JOIN clients c ON c.id = p.client_id
      WHERE p.${col} = $1
      ORDER BY p.id`, [id]);
  return rows;
}

// What a session actually resolves to, override and all — the same answer the billing
// run will get, so the class screen can show the real split rather than a guess.
async function resolveForSession(sessionId) {
  const { rows } = await pool.query(
    `SELECT s.client_id, c.name AS client_name, s.amount, s.payer_count,
            s.session_amount, c.card_brand, c.card_last4,
            (c.card_last4 IS NOT NULL) AS has_card
       FROM session_payer_shares s
       JOIN clients c ON c.id = s.client_id
      WHERE s.session_id = $1
      ORDER BY s.client_id`, [sessionId]);
  return rows;
}

// Replace the whole list in one go. The UI hands over the finished list rather than
// add/remove deltas: a half-applied split charges the wrong people, so it is one
// transaction or none.
//
// An empty list is meaningful and allowed — it means "stop sharing this class", and the
// fallback chain puts it straight back to the client paying for their own class.
async function setPayers({ schedule_id, session_id, client_ids, initials }) {
  if (!schedule_id && !session_id) {
    throw Object.assign(new Error('Which class?'), { status: 400 });
  }
  if (schedule_id && session_id) {
    throw Object.assign(new Error('A list belongs to the class or to one week, not both.'), { status: 400 });
  }

  // De-duplicate but keep the order given: the first person on the list gets the odd
  // penny, so the order is not cosmetic.
  const seen = new Set();
  const ids = (client_ids || [])
    .map(n => Number(n))
    .filter(n => Number.isInteger(n) && n > 0 && !seen.has(n) && seen.add(n));

  if (ids.length === 1) {
    // One payer is not a split. Storing it as one would work, but it would put a
    // "shared" badge on a class nobody shares and invite the question "shared with whom?".
    throw Object.assign(
      new Error('A shared class needs at least two people. To stop sharing, remove everyone.'),
      { status: 400 });
  }

  const col = schedule_id ? 'schedule_id' : 'session_id';
  const id  = schedule_id || session_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (ids.length) {
      const { rows: found } = await client.query(
        'SELECT id FROM clients WHERE id = ANY($1::bigint[])', [ids]);
      if (found.length !== ids.length) {
        throw Object.assign(new Error('One of those people is no longer on file.'), { status: 400 });
      }
    }

    await client.query(`DELETE FROM class_payers WHERE ${col} = $1`, [id]);
    for (const clientId of ids) {
      await client.query(
        `INSERT INTO class_payers (${col}, client_id, created_by) VALUES ($1, $2, $3)`,
        [id, clientId, initials || null]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return listPayers({ schedule_id, session_id });
}

// Payer counts for a set of schedules, so a list of classes can show "split 3 ways"
// without a query each.
async function countsForSchedules(scheduleIds) {
  if (!scheduleIds?.length) return {};
  const { rows } = await pool.query(
    `SELECT schedule_id, COUNT(*)::int AS n
       FROM class_payers WHERE schedule_id = ANY($1::bigint[])
      GROUP BY schedule_id`, [scheduleIds]);
  return Object.fromEntries(rows.map(r => [r.schedule_id, r.n]));
}

module.exports = { listPayers, setPayers, resolveForSession, countsForSchedules };
