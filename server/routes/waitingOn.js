const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');
const { syncMentions, deleteMentions } = require('../lib/mentions');

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

router.get('/', async (req, res) => {
  const { kind, client_id, instructor_id } = req.query;
  const conditions = [];
  const params = [];
  if (kind)          conditions.push(`w.kind = $${params.push(kind)}`);
  if (client_id)     conditions.push(`w.client_id = $${params.push(client_id)}`);
  if (instructor_id) conditions.push(`w.instructor_id = $${params.push(instructor_id)}`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `${ITEM_JOIN} ${where} ORDER BY w.status ASC, w.created_at DESC`,
    params
  );
  res.json({
    open:     rows.filter(r => r.status === 'open'),
    resolved: rows.filter(r => r.status === 'resolved'),
  });
});

router.post('/', async (req, res) => {
  const { kind, name, client_id, instructor_id, what } = req.body;
  if (!kind || !['client', 'instructor'].includes(kind)) return res.status(400).json({ error: 'kind must be client or instructor' });
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!what?.trim()) return res.status(400).json({ error: 'what required' });

  const { rows: [item] } = await pool.query(
    `INSERT INTO waiting_on_items (kind, name, client_id, instructor_id, what, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [kind, name.trim(), client_id || null, instructor_id || null, what.trim(), req.user.initials]
  );
  const { rows: [row] } = await pool.query(`${ITEM_JOIN} WHERE w.id = $1`, [item.id]);
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM waiting_on_items WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, what, client_id, instructor_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!what?.trim()) return res.status(400).json({ error: 'what required' });
  await pool.query(
    'UPDATE waiting_on_items SET name = $1, what = $2, client_id = $3, instructor_id = $4 WHERE id = $5',
    [name.trim(), what.trim(), client_id || null, instructor_id || null, req.params.id]
  );
  const { rows: [row] } = await pool.query(`${ITEM_JOIN} WHERE w.id = $1`, [req.params.id]);
  res.json(row);
});

router.patch('/:id/resolve', async (req, res) => {
  const result = await pool.query(
    `UPDATE waiting_on_items SET status = 'resolved', resolved_by = $1, resolved_at = now() WHERE id = $2`,
    [req.user.initials, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
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
