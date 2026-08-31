const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');
const { syncMentions, deleteMentions } = require('../lib/mentions');
const { maybeScanInBackground } = require('../lib/detectWaitingOn');

const router = express.Router();
router.use(requireAuth);

// "Waiting to Hear Back From" — staff-wide tracker for clients/instructors (or people not
// yet in the system) that someone is waiting on a reply from: a contract/waiver that needs
// signing, a callback, anything with a "we're waiting on them" shape. Each item has a quick
// "what" summary plus its own note thread for follow-ups, same @mention pattern as sales
// leads and reminders.

const ITEM_JOIN = `
  SELECT w.*, c.name AS client_name, i.name AS instructor_name,
    (SELECT COUNT(*) FROM waiting_on_notes n WHERE n.waiting_on_id = w.id)::int AS note_count
  FROM waiting_on_items w
  LEFT JOIN clients     c ON c.id = w.client_id
  LEFT JOIN instructors i ON i.id = w.instructor_id
`;

// Pending (unsigned, not dismissed) contract signatures fold into this list as
// read-only entries — they're exactly the "waiting to hear back" shape, and Sarede
// asked for them to show up here rather than only in the separate signatures panel.
// Unlike waiting_on_items they have no note thread and can't be resolved/deleted here;
// they naturally disappear once signed or dismissed via the existing contract-invite flow.
async function loadPendingContractSignatures({ kind, client_id, instructor_id }) {
  const out = [];
  if (!kind || kind === 'client') {
    const conditions = [`s.signed_at IS NULL`, `s.dismissed_at IS NULL`];
    const params = [];
    if (client_id) conditions.push(`s.client_id = $${params.push(client_id)}`);
    const { rows } = await pool.query(
      `SELECT s.id, s.client_id, s.org_name, s.contact_name, s.email, s.phone, s.sent_at, c.name AS client_name
       FROM client_contract_signatures s
       LEFT JOIN clients c ON c.id = s.client_id
       WHERE ${conditions.join(' AND ')}`,
      params
    );
    out.push(...rows.map(s => ({
      id: `cc-${s.id}`, kind: 'client', synthetic: true,
      name: s.client_name || s.org_name || s.contact_name || s.email || s.phone || 'Unknown',
      client_id: s.client_id, instructor_id: null,
      client_name: s.client_name || null, instructor_name: null,
      what: 'Contract sent — awaiting signature',
      status: 'open', created_at: s.sent_at, created_by: null, note_count: 0,
    })));
  }
  if (!kind || kind === 'instructor') {
    const conditions = [`s.signed_at IS NULL`, `s.dismissed_at IS NULL`];
    const params = [];
    if (instructor_id) conditions.push(`s.instructor_id = $${params.push(instructor_id)}`);
    const { rows } = await pool.query(
      `SELECT s.id, s.instructor_id, s.name, s.email, s.sent_at, i.name AS instructor_name
       FROM instructor_contract_signatures s
       LEFT JOIN instructors i ON i.id = s.instructor_id
       WHERE ${conditions.join(' AND ')}`,
      params
    );
    out.push(...rows.map(s => ({
      id: `ic-${s.id}`, kind: 'instructor', synthetic: true,
      name: s.instructor_name || s.name || s.email || 'Unknown',
      client_id: null, instructor_id: s.instructor_id,
      client_name: null, instructor_name: s.instructor_name || null,
      what: 'Contract sent — awaiting signature',
      status: 'open', created_at: s.sent_at, created_by: null, note_count: 0,
    })));
  }
  return out;
}

router.get('/', async (req, res) => {
  const { kind, client_id, instructor_id } = req.query;
  const conditions = [];
  const params = [];
  if (kind)          conditions.push(`w.kind = $${params.push(kind)}`);
  if (client_id)     conditions.push(`w.client_id = $${params.push(client_id)}`);
  if (instructor_id) conditions.push(`w.instructor_id = $${params.push(instructor_id)}`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [{ rows }, pendingSignatures] = await Promise.all([
    pool.query(`${ITEM_JOIN} ${where} ORDER BY w.status ASC, w.urgent DESC, w.created_at DESC`, params),
    loadPendingContractSignatures({ kind, client_id, instructor_id }),
  ]);
  const open = [...rows.filter(r => r.status === 'open'), ...pendingSignatures]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({
    open,
    resolved: rows.filter(r => r.status === 'resolved'),
  });
});

// ── Suggestions ────────────────────────────────────────────────────────────────────────
// Read out of the notes staff write as they work (server/lib/detectWaitingOn.js). These
// are proposals only — nothing reaches the real list until someone accepts one here.
// Registered above the `/:id` routes so "suggestions" is never read as an item id.

router.get('/suggestions', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, c.name AS client_name, i.name AS instructor_name,
            w.name AS waiting_on_name, w.what AS waiting_on_what
       FROM waiting_on_suggestions s
       LEFT JOIN clients          c ON c.id = s.client_id
       LEFT JOIN instructors      i ON i.id = s.instructor_id
       LEFT JOIN waiting_on_items w ON w.id = s.waiting_on_id
      WHERE s.status = 'pending'
        -- A "they got back to us" suggestion is pointless once the item is off the list
        -- some other way; drop it rather than ask about something already handled.
        AND (s.suggestion_type = 'add' OR w.status = 'open')
      ORDER BY s.created_at DESC`
  );
  res.json(rows);

  // After the response, never before it: look for notes written since the last scan, so
  // the next time someone opens this the strip is up to date. Rate-limited to one scan
  // every 20 minutes across the whole team — see maybeScanInBackground.
  maybeScanInBackground().catch(() => {});
});

router.post('/suggestions/:id/accept', async (req, res) => {
  const { rows: [s] } = await pool.query(
    `SELECT * FROM waiting_on_suggestions WHERE id = $1 AND status = 'pending'`, [req.params.id]
  );
  if (!s) return res.status(404).json({ error: 'Suggestion not found or already reviewed' });

  let item = null;
  if (s.suggestion_type === 'resolve') {
    await pool.query(
      `UPDATE waiting_on_items SET status = 'resolved', resolved_by = $1, resolved_at = now()
        WHERE id = $2 AND status = 'open'`,
      [req.user.initials, s.waiting_on_id]
    );
    await pool.query(
      `UPDATE reminders SET status = 'done' WHERE waiting_on_id = $1 AND status = 'pending'`,
      [s.waiting_on_id]
    );
    ({ rows: [item] } = await pool.query(`${ITEM_JOIN} WHERE w.id = $1`, [s.waiting_on_id]));
  } else {
    // `kind` steers which sub-tab the item shows under, so the card lets staff say which
    // when the name couldn't be tied to a record. Falls back to client, the commoner case.
    const kind = ['client', 'instructor'].includes(req.body.kind) ? req.body.kind
      : ['client', 'instructor'].includes(s.kind) ? s.kind : 'client';
    const { rows: [created] } = await pool.query(
      `INSERT INTO waiting_on_items (kind, name, client_id, instructor_id, what, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [kind, s.name || 'Unknown', s.client_id, s.instructor_id,
       s.what || 'Waiting to hear back', req.user.initials]
    );
    // Keep the sentence it was read out of as the first entry in the item's own thread —
    // otherwise "why is this on my list?" has no answer once the card is gone. Written
    // before the row is read back, so the returned note_count includes it.
    if (s.evidence) {
      await pool.query(
        `INSERT INTO waiting_on_notes (waiting_on_id, text, author_initials) VALUES ($1,$2,'auto')`,
        [created.id, `Picked up from a note: "${s.evidence.trim()}"`]
      );
    }
    ({ rows: [item] } = await pool.query(`${ITEM_JOIN} WHERE w.id = $1`, [created.id]));
    await pool.query('UPDATE waiting_on_suggestions SET waiting_on_id = $1 WHERE id = $2', [created.id, s.id]);
  }

  await pool.query(
    `UPDATE waiting_on_suggestions SET status = 'accepted', reviewed_by = $1, reviewed_at = now() WHERE id = $2`,
    [req.user.initials, s.id]
  );
  res.json({ item, suggestion_type: s.suggestion_type });
});

router.post('/suggestions/:id/dismiss', async (req, res) => {
  const result = await pool.query(
    `UPDATE waiting_on_suggestions SET status = 'dismissed', reviewed_by = $1, reviewed_at = now()
      WHERE id = $2 AND status = 'pending'`,
    [req.user.initials, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Suggestion not found or already reviewed' });
  res.json({ success: true });
});

router.post('/', async (req, res) => {
  const { kind, name, client_id, instructor_id, what, need_by } = req.body;
  if (!kind || !['client', 'instructor'].includes(kind)) return res.status(400).json({ error: 'kind must be client or instructor' });
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!what?.trim()) return res.status(400).json({ error: 'what required' });

  const { rows: [item] } = await pool.query(
    `INSERT INTO waiting_on_items (kind, name, client_id, instructor_id, what, need_by, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [kind, name.trim(), client_id || null, instructor_id || null, what.trim(), need_by || null, req.user.initials]
  );
  const { rows: [row] } = await pool.query(`${ITEM_JOIN} WHERE w.id = $1`, [item.id]);
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id, need_by::text AS need_by FROM waiting_on_items WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, what, client_id, instructor_id, need_by } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!what?.trim()) return res.status(400).json({ error: 'what required' });
  await pool.query(
    'UPDATE waiting_on_items SET name = $1, what = $2, client_id = $3, instructor_id = $4, need_by = $5 WHERE id = $6',
    [name.trim(), what.trim(), client_id || null, instructor_id || null, need_by || null, req.params.id]
  );
  // The date changed away from what it was — if that date is the reason an auto reminder
  // exists (it's no longer overdue, or was cleared entirely), that reminder is stale.
  // Only touches the one this feature created; a reminder someone made by hand stays put.
  if (existing.need_by !== (need_by || null)) {
    await pool.query(
      `DELETE FROM reminders WHERE waiting_on_id = $1 AND created_by = 'daily-sync' AND status = 'pending'`,
      [req.params.id]
    );
  }
  const { rows: [row] } = await pool.query(`${ITEM_JOIN} WHERE w.id = $1`, [req.params.id]);
  res.json(row);
});

// Urgent is deliberately its own endpoint rather than a field on PUT /:id — that route
// writes the whole record, so a star toggle sent through it would blank whatever the
// caller didn't include (need_by has been lost that way before).
router.patch('/:id/urgent', async (req, res) => {
  const urgent = !!req.body.urgent;
  const { rows: [row] } = await pool.query(
    'UPDATE waiting_on_items SET urgent = $1 WHERE id = $2 RETURNING id',
    [urgent, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { rows: [full] } = await pool.query(`${ITEM_JOIN} WHERE w.id = $1`, [req.params.id]);
  res.json(full);
});

router.patch('/:id/resolve', async (req, res) => {
  const result = await pool.query(
    `UPDATE waiting_on_items SET status = 'resolved', resolved_by = $1, resolved_at = now() WHERE id = $2`,
    [req.user.initials, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  await pool.query(
    `UPDATE reminders SET status = 'done' WHERE waiting_on_id = $1 AND status = 'pending'`,
    [req.params.id]
  );
  const { rows: [row] } = await pool.query(`${ITEM_JOIN} WHERE w.id = $1`, [req.params.id]);
  res.json(row);
});

router.patch('/:id/reopen', async (req, res) => {
  const result = await pool.query(
    `UPDATE waiting_on_items SET status = 'open', resolved_by = NULL, resolved_at = NULL WHERE id = $1`,
    [req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  const { rows: [row] } = await pool.query(`${ITEM_JOIN} WHERE w.id = $1`, [req.params.id]);
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const { rows: notes } = await pool.query('SELECT id FROM waiting_on_notes WHERE waiting_on_id = $1', [req.params.id]);
  const result = await pool.query('DELETE FROM waiting_on_items WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  await Promise.all(notes.map(n => deleteMentions('waiting_on_notes', n.id)));
  res.json({ success: true });
});

// ── Notes (follow-up log per item — "tried calling again, left voicemail" — @mention a
// teammate the same way it works on tasks/action items/reminders/sales leads) ──────────

router.get('/:id/notes', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM waiting_on_notes WHERE waiting_on_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/notes', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const { rows: [item] } = await pool.query(
    'SELECT id, kind, client_id, instructor_id FROM waiting_on_items WHERE id = $1', [req.params.id]
  );
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { rows: [note] } = await pool.query(
    'INSERT INTO waiting_on_notes (waiting_on_id, text, author_initials) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, text.trim(), req.user.initials]
  );
  // Land on the linked profile if there is one (where the item already shows), else the
  // sub-tab list on Clients/Instructors — either way `?waiting=<id>` tells the page which
  // item's follow-up thread to auto-expand before scrolling to the note itself.
  const linkPath = item.client_id ? `/clients/${item.client_id}?waiting=${item.id}`
    : item.instructor_id ? `/instructors/${item.instructor_id}?waiting=${item.id}`
    : `/${item.kind}s?waiting=${item.id}`;
  await syncMentions({
    sourceTable: 'waiting_on_notes', sourceId: note.id, text: text.trim(),
    authorInitials: req.user.initials, linkPath,
  });
  res.status(201).json(note);
});

router.delete('/:id/notes/:noteId', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM waiting_on_notes WHERE id = $1 AND waiting_on_id = $2',
    [req.params.noteId, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
  await deleteMentions('waiting_on_notes', req.params.noteId);
  res.json({ success: true });
});

module.exports = router;
