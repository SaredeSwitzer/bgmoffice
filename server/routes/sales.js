const express = require('express');
const pool    = require('../db/pg');
const { requireAuth, requireSaredeOnly } = require('../middleware/auth');
const { syncMentions, deleteMentions } = require('../lib/mentions');

const router = express.Router();
router.use(requireAuth, requireSaredeOnly);

// Sarede's private sales-call tracker — clients (or people not yet in the app) she
// intends to reach out to about buying more/new classes. Deliberately hers alone, not a
// staff-wide feature (see requireSaredeOnly).

const LEAD_JOIN = `
  SELECT sl.*, c.name AS linked_client_name,
    (SELECT COUNT(*) FROM sales_lead_notes n WHERE n.sales_lead_id = sl.id)::int AS note_count
  FROM sales_leads sl
  LEFT JOIN clients c ON c.id = sl.client_id
`;

router.get('/', async (req, res) => {
  const { rows } = await pool.query(`${LEAD_JOIN} ORDER BY sl.created_at DESC`);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name, client_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const { rows: [lead] } = await pool.query(
    'INSERT INTO sales_leads (name, client_id, created_by) VALUES ($1,$2,$3) RETURNING id',
    [name.trim(), client_id || null, req.user.initials]
  );
  const { rows: [row] } = await pool.query(`${LEAD_JOIN} WHERE sl.id = $1`, [lead.id]);
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM sales_leads WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Lead not found' });
  const { name, client_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  await pool.query(
    'UPDATE sales_leads SET name = $1, client_id = $2 WHERE id = $3',
    [name.trim(), client_id || null, req.params.id]
  );
  const { rows: [row] } = await pool.query(`${LEAD_JOIN} WHERE sl.id = $1`, [req.params.id]);
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const { rows: notes } = await pool.query('SELECT id FROM sales_lead_notes WHERE sales_lead_id = $1', [req.params.id]);
  const result = await pool.query('DELETE FROM sales_leads WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Lead not found' });
  await Promise.all(notes.map(n => deleteMentions('sales_lead_notes', n.id)));
  res.json({ success: true });
});

// ── Notes (a running log per lead — call attempts, outcomes, etc; @mention a teammate
// the same way it works on tasks/action items/reminders) ───────────────────────────

router.get('/:id/notes', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM sales_lead_notes WHERE sales_lead_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/notes', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const { rows: [lead] } = await pool.query('SELECT id FROM sales_leads WHERE id = $1', [req.params.id]);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const { rows: [note] } = await pool.query(
    'INSERT INTO sales_lead_notes (sales_lead_id, text, author_initials) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, text.trim(), req.user.initials]
  );
  await syncMentions({
    sourceTable: 'sales_lead_notes', sourceId: note.id, text: text.trim(),
    authorInitials: req.user.initials, linkPath: `/sales?lead=${req.params.id}`,
  });
  res.status(201).json(note);
});

router.patch('/:id/notes/:noteId', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const { rows: [note] } = await pool.query(
    'UPDATE sales_lead_notes SET text = $1, edited_at = now() WHERE id = $2 AND sales_lead_id = $3 RETURNING *',
    [text.trim(), req.params.noteId, req.params.id]
  );
  if (!note) return res.status(404).json({ error: 'Note not found' });
  await syncMentions({
    sourceTable: 'sales_lead_notes', sourceId: note.id, text: text.trim(),
    authorInitials: req.user.initials, linkPath: `/sales?lead=${req.params.id}`,
  });
  res.json(note);
});

router.delete('/:id/notes/:noteId', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM sales_lead_notes WHERE id = $1 AND sales_lead_id = $2',
    [req.params.noteId, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
  await deleteMentions('sales_lead_notes', req.params.noteId);
  res.json({ success: true });
});

module.exports = router;
