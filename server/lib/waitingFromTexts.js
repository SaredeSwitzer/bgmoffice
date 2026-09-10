const pool = require('../db/pg');

// When somebody you're waiting on texts back, the Waiting On sheet should say so.
//
// The sheet's job is "who owes us a reply", and until now the answer only changed when a
// person typed it in — so a reply that arrived by text sat in the inbox while the line
// still said we were waiting. The two halves already share the fact that matters: a text
// resolves to a client or an instructor by phone, and a line lists its people by the same
// ids.
//
// What this deliberately does NOT do is clear the hourglass. "Let me check and get back to
// you" is a reply, and a line that quietly marks itself handled on the strength of it is
// worse than one that never updated at all. The reply is shown; the judgement stays hers.

// Their message, kept short enough to read on the line itself.
function preview(text, max = 140) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Called from the Telnyx inbound webhook once the sender is known. Never throws — a text
// arriving is not allowed to fail because of anything here.
async function noteReplyOnWaitingRows({ person, text, receivedAt = new Date() }) {
  if (!person?.id || !person?.kind) return [];
  try {
    const { rows } = await pool.query(
      `SELECT r.id
         FROM waiting_sheet_rows r
         JOIN waiting_sheet_people p ON p.row_id = r.id
        WHERE r.status = 'open' AND p.kind = $1 AND p.person_id = $2`,
      [person.kind, person.id]
    );
    if (!rows.length) return [];

    for (const row of rows) {
      // The text itself becomes a note, so the thread of a line reads in one place rather
      // than half here and half in the inbox.
      await pool.query(
        `INSERT INTO waiting_sheet_notes (row_id, text, author) VALUES ($1, $2, $3)`,
        [row.id, preview(text, 1000), 'Text']
      );
      // And the line carries a marker until somebody has looked at it.
      await pool.query(
        `UPDATE waiting_sheet_rows
            SET reply_at = $1, reply_from = $2, reply_text = $3, updated_at = now()
          WHERE id = $4`,
        [receivedAt, person.name || null, preview(text), row.id]
      );
    }
    return rows.map(r => r.id);
  } catch (e) {
    console.error('[waiting] could not record a text reply on the sheet:', e.message);
    return [];
  }
}

module.exports = { noteReplyOnWaitingRows, preview };
