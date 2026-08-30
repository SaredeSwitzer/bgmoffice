// Folds one instructor record into another and deletes the loser.
//
// Duplicates happen because the same person reaches us twice — staff typed them in months
// ago, then they filled out /join themselves with a slightly different email. The old record
// owns the history (classes, payments, a signed contract); the new one owns the fresh details
// (current phone, city, which neighborhoods they'll travel to). A merge has to keep BOTH,
// which is why this fills blanks rather than picking a winning row wholesale.
//
// Used by the "Merge into…" button on a pending sign-up (instructorSignup.js) and by the
// staff merge endpoint on the instructor list (instructors.js).

const pool = require('./../db/pg');

// Every table with an instructor_id FK. Verified against pg_constraint on 2026-08-29 — if a
// new table starts referencing instructors, add it here or the merge will fail loudly on the
// foreign key rather than silently orphaning rows (which is the behaviour we want).
const FK_TABLES = [
  'users', 'instructor_documents', 'instructor_notes', 'instructor_availability',
  'client_instructor_prefs', 'cases', 'reminders', 'invoices', 'client_packages',
  'standalone_tasks', 'recruiting_entries', 'class_schedules', 'class_sessions',
  'instructor_payments', 'payout_requests', 'instructor_contract_signatures',
  'availability_confirmations', 'instructor_signups', 'waiting_on_items',
];

// Three tables are UNIQUE (instructor_id, week_start), so a blind repoint would collide if
// both records have a row for the same week. A confirmation is just "yes I'm around this
// week" — dropping the loser's copy costs nothing. Money is different: if both records were
// paid for the same week, that's a real bookkeeping question and the merge stops rather than
// quietly discarding one. In practice a fresh duplicate has neither.
const WEEKLY_UNIQUE = {
  availability_confirmations: 'drop',
  payout_requests: 'refuse',
  instructor_payments: 'refuse',
};

// Filled in on the keeper only where the keeper is blank — never overwrites something
// already there. Ordering doesn't matter; these are independent.
const FILL_IF_BLANK = [
  'phone', 'email', 'specialties', 'style', 'pay_rate', 'mailing_address',
  'contract_signed_date', 'photo_url', 'neighborhood', 'styles_taught',
  'payout_method', 'payout_handle', 'state', 'city',
];

const blank = v => v === null || v === undefined || String(v).trim() === '';

/**
 * Merge `loseId` into `keepId`: carry over any detail the keeper is missing, repoint every
 * row that pointed at the loser, then delete the loser. Runs in one transaction — either the
 * whole merge lands or nothing does.
 *
 * @returns {Promise<{kept: object, removed: {id, name}, filled: string[], moved: object}>}
 */
async function mergeInstructors(keepId, loseId) {
  if (String(keepId) === String(loseId)) {
    throw new Error("Can't merge a record into itself.");
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [keep] } = await client.query('SELECT * FROM instructors WHERE id = $1 FOR UPDATE', [keepId]);
    const { rows: [lose] } = await client.query('SELECT * FROM instructors WHERE id = $1 FOR UPDATE', [loseId]);
    if (!keep) throw new Error(`Instructor ${keepId} not found.`);
    if (!lose) throw new Error(`Instructor ${loseId} not found.`);

    // ── Carry over detail the keeper doesn't have ──
    const sets = [];
    const params = [];
    const filled = [];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); filled.push(col); };

    for (const col of FILL_IF_BLANK) {
      if (blank(keep[col]) && !blank(lose[col])) set(col, lose[col]);
    }

    // Notes get appended, not replaced — both sides are things someone deliberately wrote
    // down. Skip if the keeper's notes already contain the loser's (re-running a merge, or
    // the same text typed twice).
    if (!blank(lose.notes) && !String(keep.notes || '').includes(String(lose.notes).trim())) {
      set('notes', [keep.notes, lose.notes].filter(v => !blank(v)).join('\n\n'));
    }

    // A signed contract is never un-signed by a merge.
    if (!keep.contract_signed && lose.contract_signed) set('contract_signed', lose.contract_signed);

    // SSN moves as a unit — the ciphertext, its last4 and which kind of tax id it is have to
    // agree, so a half-carried SSN would render as a last4 nothing can decrypt.
    if (blank(keep.ssn_encrypted) && !blank(lose.ssn_encrypted)) {
      set('ssn_encrypted', lose.ssn_encrypted);
      set('ssn_last4', lose.ssn_last4);
      set('tax_id_type', lose.tax_id_type || 'ssn');
    }
    if (blank(keep.ssn) && !blank(lose.ssn)) set('ssn', lose.ssn);

    if (sets.length) {
      params.push(keepId);
      await client.query(`UPDATE instructors SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }

    // ── Repoint everything that pointed at the loser ──
    const moved = {};

    // users is UNIQUE on instructor_id, so an instructor can only ever have one login. If the
    // keeper already has one, the duplicate's login row goes; the keeper's stays, because its
    // address is the one the merged instructor record now carries.
    const { rows: [keeperLogin] } = await client.query(
      `SELECT id FROM users WHERE instructor_id = $1`, [keepId]
    );
    if (keeperLogin) {
      const { rowCount } = await client.query('DELETE FROM users WHERE instructor_id = $1', [loseId]);
      if (rowCount) moved.logins_removed = rowCount;
    }

    for (const table of FK_TABLES) {
      if (table === 'users' && keeperLogin) continue;

      if (WEEKLY_UNIQUE[table]) {
        const { rows: clashes } = await client.query(
          `SELECT l.week_start FROM ${table} l
            WHERE l.instructor_id = $1
              AND EXISTS (SELECT 1 FROM ${table} k WHERE k.instructor_id = $2 AND k.week_start = l.week_start)`,
          [loseId, keepId]
        );
        if (clashes.length) {
          if (WEEKLY_UNIQUE[table] === 'refuse') {
            throw new Error(
              `Both records have ${table.replace(/_/g, ' ')} for the same week ` +
              `(${clashes.map(c => c.week_start).join(', ')}). Sort that out first, then merge.`
            );
          }
          await client.query(
            `DELETE FROM ${table} WHERE instructor_id = $1 AND week_start = ANY($2)`,
            [loseId, clashes.map(c => c.week_start)]
          );
        }
      }

      const { rowCount } = await client.query(
        `UPDATE ${table} SET instructor_id = $1 WHERE instructor_id = $2`, [keepId, loseId]
      );
      if (rowCount) moved[table] = rowCount;
    }

    await client.query('DELETE FROM instructors WHERE id = $1', [loseId]);
    await client.query('COMMIT');

    const { rows: [kept] } = await pool.query('SELECT * FROM instructors WHERE id = $1', [keepId]);
    return { kept, removed: { id: lose.id, name: lose.name }, filled, moved };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { mergeInstructors, FK_TABLES };
