const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const CASE_SELECT = `
  SELECT
    c.id, c.status, c.created_at, c.resolved_at,
    cl.id   AS client_id,   cl.name AS client_name,
    i.id    AS instructor_id, i.name AS instructor_name
  FROM cases c
  LEFT JOIN clients     cl ON cl.id = c.client_id
  LEFT JOIN instructors i  ON i.id  = c.instructor_id
`;

const ACTION_TYPES_STMT = db.prepare(`
  SELECT at.id, at.name, at.color, at.order_index
  FROM action_item_action_types aiat
  JOIN action_types at ON at.id = aiat.action_type_id
  WHERE aiat.action_item_id = ?
  ORDER BY at.order_index ASC
`);

function enrichCase(row) {
  if (!row) return null;
  const actionItems = db.prepare(`
    SELECT ai.id, ai.status, ai.initial_note, ai.created_at, ai.resolved_at,
           ai.starred, ai.updated_at,
           d.id AS delegate_id, d.name AS delegate_name
    FROM action_items ai
    LEFT JOIN delegates d ON d.id = ai.delegate_id
    WHERE ai.case_id = ?
    ORDER BY ai.created_at ASC
  `).all(row.id);

  for (const item of actionItems) {
    item.action_types = ACTION_TYPES_STMT.all(item.id);
    // Legacy single-value shim
    item.action_type_id    = item.action_types[0]?.id    ?? null;
    item.action_type_name  = item.action_types.map(a => a.name).join(', ');
    item.action_type_color = item.action_types[0]?.color ?? 'gray';
    item.notes = db.prepare(
      'SELECT * FROM follow_up_notes WHERE action_item_id = ? ORDER BY created_at ASC'
    ).all(item.id);
  }

  return { ...row, action_items: actionItems };
}

// List cases (optionally filter by client or instructor)
router.get('/', (req, res) => {
  const { client_id, instructor_id, status } = req.query;
  let sql = CASE_SELECT + ' WHERE 1=1';
  const params = [];
  if (client_id)    { sql += ' AND c.client_id = ?';     params.push(client_id); }
  if (instructor_id){ sql += ' AND c.instructor_id = ?'; params.push(instructor_id); }
  if (status)       { sql += ' AND c.status = ?';        params.push(status); }
  sql += ' ORDER BY c.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Get single case with all action items + notes
router.get('/:id', (req, res) => {
  const row = db.prepare(CASE_SELECT + ' WHERE c.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  res.json(enrichCase(row));
});

// Create case
router.post('/', (req, res) => {
  const { client_id, instructor_id } = req.body;
  const result = db.prepare(
    'INSERT INTO cases (client_id, instructor_id) VALUES (?, ?)'
  ).run(client_id || null, instructor_id || null);
  const row = db.prepare(CASE_SELECT + ' WHERE c.id = ?').get(result.lastInsertRowid);
  res.status(201).json(enrichCase(row));
});

// Resolve / reopen case
router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['open', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'status must be open or resolved' });
  }
  const resolved_at = status === 'resolved' ? new Date().toISOString() : null;
  db.prepare('UPDATE cases SET status=?, resolved_at=? WHERE id=?')
    .run(status, resolved_at, req.params.id);
  const row = db.prepare(CASE_SELECT + ' WHERE c.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  res.json(enrichCase(row));
});

// Update case (client/instructor links)
router.put('/:id', (req, res) => {
  const c = db.prepare('SELECT id FROM cases WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  const { client_id, instructor_id } = req.body;
  db.prepare('UPDATE cases SET client_id=?, instructor_id=? WHERE id=?')
    .run(client_id || null, instructor_id || null, req.params.id);
  const row = db.prepare(CASE_SELECT + ' WHERE c.id = ?').get(req.params.id);
  res.json(enrichCase(row));
});

module.exports = router;
