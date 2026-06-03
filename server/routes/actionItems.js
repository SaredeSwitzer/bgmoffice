const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTION_TYPES_SQL = `
  SELECT at.id, at.name, at.color, at.order_index
  FROM action_item_action_types aiat
  JOIN action_types at ON at.id = aiat.action_type_id
  WHERE aiat.action_item_id = ?
  ORDER BY at.order_index ASC
`;

function getItem(id) {
  const item = db.prepare(`
    SELECT ai.id, ai.case_id, ai.status, ai.initial_note,
           ai.created_at, ai.created_by, ai.resolved_at, ai.starred, ai.updated_at,
           d.id AS delegate_id, d.name AS delegate_name
    FROM action_items ai
    LEFT JOIN delegates d ON d.id = ai.delegate_id
    WHERE ai.id = ?
  `).get(id);
  if (!item) return null;

  item.action_types = db.prepare(ACTION_TYPES_SQL).all(id);
  // Legacy single-value fields kept for any code still reading them
  item.action_type_id    = item.action_types[0]?.id    ?? null;
  item.action_type_name  = item.action_types.map(a => a.name).join(', ');
  item.action_type_color = item.action_types[0]?.color ?? 'gray';

  item.notes = db.prepare(
    'SELECT * FROM follow_up_notes WHERE action_item_id = ? ORDER BY created_at ASC'
  ).all(id);
  item.reminders = db.prepare(
    `SELECT id, title, remind_on, delegate_name, status, created_by, created_at
     FROM reminders WHERE action_item_id = ? AND status = 'pending' ORDER BY remind_on ASC`
  ).all(id);
  return item;
}

function setActionTypes(itemId, actionTypeIds) {
  db.prepare('DELETE FROM action_item_action_types WHERE action_item_id = ?').run(itemId);
  if (actionTypeIds?.length) {
    const ins = db.prepare(
      'INSERT OR IGNORE INTO action_item_action_types (action_item_id, action_type_id) VALUES (?, ?)'
    );
    db.transaction(() => actionTypeIds.forEach(atId => ins.run(itemId, atId)))();
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Create action item
router.post('/', (req, res) => {
  const { case_id, action_type_ids, delegate_id, initial_note } = req.body;
  if (!case_id || !action_type_ids?.length) {
    return res.status(400).json({ error: 'case_id and action_type_ids required' });
  }
  const result = db.prepare(
    'INSERT INTO action_items (case_id, action_type_id, delegate_id, initial_note, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(case_id, action_type_ids[0] ?? null, delegate_id ?? null, initial_note ?? null, req.user.initials);

  setActionTypes(result.lastInsertRowid, action_type_ids);
  res.status(201).json(getItem(result.lastInsertRowid));
});

// Update action item
router.put('/:id', (req, res) => {
  const item = db.prepare('SELECT id FROM action_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Action item not found' });

  const { action_type_ids, delegate_id, initial_note } = req.body;
  db.prepare(
    `UPDATE action_items SET action_type_id=?, delegate_id=?, initial_note=?, updated_at=datetime('now') WHERE id=?`
  ).run(action_type_ids?.[0] ?? null, delegate_id ?? null, initial_note ?? null, req.params.id);

  setActionTypes(req.params.id, action_type_ids ?? []);
  res.json(getItem(req.params.id));
});

// Toggle starred
router.patch('/:id/star', (req, res) => {
  const { starred } = req.body;
  const result = db.prepare('UPDATE action_items SET starred=? WHERE id=?').run(starred ? 1 : 0, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Action item not found' });
  res.json(getItem(req.params.id));
});

// Toggle status open/resolved
router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['open', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'status must be open or resolved' });
  }
  const resolved_at = status === 'resolved' ? new Date().toISOString() : null;
  const result = db.prepare(
    'UPDATE action_items SET status=?, resolved_at=? WHERE id=?'
  ).run(status, resolved_at, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Action item not found' });
  res.json(getItem(req.params.id));
});

// Delete action item
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM action_items WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Action item not found' });
  res.json({ success: true });
});

// Edit a follow-up note (own note or admin)
router.put('/:id/notes/:noteId', (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const note = db.prepare(
    'SELECT * FROM follow_up_notes WHERE id = ? AND action_item_id = ?'
  ).get(req.params.noteId, req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (note.author_initials !== req.user.initials && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Not authorized' });
  db.prepare(
    `UPDATE follow_up_notes SET text=?, updated_at=datetime('now') WHERE id=?`
  ).run(text.trim(), req.params.noteId);
  res.json(db.prepare('SELECT * FROM follow_up_notes WHERE id = ?').get(req.params.noteId));
});

// Add follow-up note — author always taken from JWT, never trusted from body
router.post('/:id/notes', (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const item = db.prepare('SELECT id FROM action_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Action item not found' });
  const result = db.prepare(
    'INSERT INTO follow_up_notes (action_item_id, text, author_initials) VALUES (?, ?, ?)'
  ).run(req.params.id, text.trim(), req.user.initials);
  res.status(201).json(db.prepare('SELECT * FROM follow_up_notes WHERE id = ?').get(result.lastInsertRowid));
});

// Delete follow-up note
router.delete('/:id/notes/:noteId', (req, res) => {
  const result = db.prepare(
    'DELETE FROM follow_up_notes WHERE id = ? AND action_item_id = ?'
  ).run(req.params.noteId, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Note not found' });
  res.json({ success: true });
});

module.exports = router;
