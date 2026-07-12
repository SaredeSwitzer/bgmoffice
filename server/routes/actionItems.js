const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

async function getItem(id) {
  const { rows: [item] } = await pool.query(
    `SELECT ai.id, ai.case_id, ai.status, ai.initial_note,
            ai.created_at, ai.created_by, ai.resolved_at, ai.starred, ai.updated_at,
            d.id AS delegate_id, d.name AS delegate_name
     FROM action_items ai
     LEFT JOIN delegates d ON d.id = ai.delegate_id
     WHERE ai.id = $1`,
    [id]
  );
  if (!item) return null;

  const { rows: actionTypes } = await pool.query(
    `SELECT at.id, at.name, at.color, at.order_index
     FROM action_item_action_types aiat
     JOIN action_types at ON at.id = aiat.action_type_id
     WHERE aiat.action_item_id = $1
     ORDER BY at.order_index ASC`,
    [id]
  );
  item.action_types      = actionTypes;
  item.action_type_id    = actionTypes[0]?.id    ?? null;
  item.action_type_name  = actionTypes.map(a => a.name).join(', ');
  item.action_type_color = actionTypes[0]?.color ?? 'gray';

  const { rows: notes } = await pool.query(
    'SELECT * FROM follow_up_notes WHERE action_item_id = $1 ORDER BY created_at ASC',
    [id]
  );
  item.notes = notes;

  const { rows: reminders } = await pool.query(
    `SELECT id, title, remind_on, delegate_name, status, created_by, created_at
     FROM reminders WHERE action_item_id = $1 AND status = 'pending' ORDER BY remind_on ASC`,
    [id]
  );
  item.reminders = reminders;
  return item;
}

async function setActionTypes(itemId, actionTypeIds) {
  await pool.query('DELETE FROM action_item_action_types WHERE action_item_id = $1', [itemId]);
  if (actionTypeIds?.length) {
    await Promise.all(
      actionTypeIds.map(atId =>
        pool.query(
          'INSERT INTO action_item_action_types (action_item_id, action_type_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [itemId, atId]
        )
      )
    );
  }
}

router.post('/', async (req, res) => {
  const { case_id, action_type_ids, delegate_id, initial_note } = req.body;
  if (!case_id || !action_type_ids?.length) return res.status(400).json({ error: 'case_id and action_type_ids required' });

  const { rows: [item] } = await pool.query(
    'INSERT INTO action_items (case_id, action_type_id, delegate_id, initial_note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [case_id, action_type_ids[0] ?? null, delegate_id ?? null, initial_note ?? null, req.user.initials]
  );
  await setActionTypes(item.id, action_type_ids);
  res.status(201).json(await getItem(item.id));
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM action_items WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Action item not found' });

  const { action_type_ids, delegate_id, initial_note } = req.body;
  await pool.query(
    `UPDATE action_items SET action_type_id=$1, delegate_id=$2, initial_note=$3, updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$4`,
    [action_type_ids?.[0] ?? null, delegate_id ?? null, initial_note ?? null, req.params.id]
  );
  await setActionTypes(req.params.id, action_type_ids ?? []);
  res.json(await getItem(req.params.id));
});

router.patch('/:id/star', async (req, res) => {
  const result = await pool.query('UPDATE action_items SET starred=$1 WHERE id=$2', [req.body.starred ? 1 : 0, req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Action item not found' });
  res.json(await getItem(req.params.id));
});

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['open', 'resolved'].includes(status)) return res.status(400).json({ error: 'status must be open or resolved' });
  const resolved_at = status === 'resolved' ? new Date().toISOString() : null;
  const result = await pool.query('UPDATE action_items SET status=$1, resolved_at=$2 WHERE id=$3', [status, resolved_at, req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Action item not found' });
  res.json(await getItem(req.params.id));
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM action_items WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Action item not found' });
  res.json({ success: true });
});

router.put('/:id/notes/:noteId', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const { rows: [note] } = await pool.query(
    'SELECT * FROM follow_up_notes WHERE id = $1 AND action_item_id = $2',
    [req.params.noteId, req.params.id]
  );
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (note.author_initials !== req.user.initials && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Not authorized' });
  const { rows: [updated] } = await pool.query(
    `UPDATE follow_up_notes SET text=$1, updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$2 RETURNING *`,
    [text.trim(), req.params.noteId]
  );
  res.json(updated);
});

router.post('/:id/notes', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const { rows: [existing] } = await pool.query('SELECT id FROM action_items WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Action item not found' });
  const { rows: [note] } = await pool.query(
    'INSERT INTO follow_up_notes (action_item_id, text, author_initials) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, text.trim(), req.user.initials]
  );
  res.status(201).json(note);
});

router.delete('/:id/notes/:noteId', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM follow_up_notes WHERE id = $1 AND action_item_id = $2',
    [req.params.noteId, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
  res.json({ success: true });
});

module.exports = router;
