const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const CASE_SELECT = `
  SELECT c.id, c.title, c.status, c.created_at, c.resolved_at,
    cl.id AS client_id, cl.name AS client_name,
    i.id  AS instructor_id, i.name AS instructor_name
  FROM cases c
  LEFT JOIN clients     cl ON cl.id = c.client_id
  LEFT JOIN instructors i  ON i.id  = c.instructor_id
`;

async function enrichCase(row) {
  if (!row) return null;

  const { rows: actionItems } = await pool.query(
    `SELECT ai.id, ai.status, ai.initial_note, ai.created_at, ai.created_by, ai.resolved_at,
            ai.starred, ai.updated_at,
            d.id AS delegate_id, d.name AS delegate_name
     FROM action_items ai
     LEFT JOIN delegates d ON d.id = ai.delegate_id
     WHERE ai.case_id = $1
     ORDER BY ai.created_at ASC`,
    [row.id]
  );

  for (const item of actionItems) {
    const { rows: actionTypes } = await pool.query(
      `SELECT at.id, at.name, at.color, at.order_index
       FROM action_item_action_types aiat
       JOIN action_types at ON at.id = aiat.action_type_id
       WHERE aiat.action_item_id = $1
       ORDER BY at.order_index ASC`,
      [item.id]
    );
    item.action_types      = actionTypes;
    item.action_type_id    = actionTypes[0]?.id    ?? null;
    item.action_type_name  = actionTypes.map(a => a.name).join(', ');
    item.action_type_color = actionTypes[0]?.color ?? 'gray';

    const { rows: notes } = await pool.query(
      'SELECT * FROM follow_up_notes WHERE action_item_id = $1 ORDER BY created_at ASC',
      [item.id]
    );
    item.notes = notes;

    const { rows: reminders } = await pool.query(
      `SELECT id, title, remind_on, delegate_name, status, created_by, created_at
       FROM reminders WHERE action_item_id = $1 AND status = 'pending' ORDER BY remind_on ASC`,
      [item.id]
    );
    item.reminders = reminders;
  }

  return { ...row, action_items: actionItems };
}

router.get('/', async (req, res) => {
  const { client_id, instructor_id, status } = req.query;
  const conditions = ['1=1'];
  const params = [];
  if (client_id)    { conditions.push(`c.client_id = $${params.push(client_id)}`); }
  if (instructor_id){ conditions.push(`c.instructor_id = $${params.push(instructor_id)}`); }
  if (status)       { conditions.push(`c.status = $${params.push(status)}`); }

  const { rows } = await pool.query(
    `${CASE_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY c.created_at DESC`,
    params
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows: [row] } = await pool.query(`${CASE_SELECT} WHERE c.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  res.json(await enrichCase(row));
});

router.post('/', async (req, res) => {
  const { client_id, instructor_id, title } = req.body;
  const { rows: [caseRow] } = await pool.query(
    'INSERT INTO cases (client_id, instructor_id, title) VALUES ($1,$2,$3) RETURNING id',
    [client_id || null, instructor_id || null, title || null]
  );
  const { rows: [row] } = await pool.query(`${CASE_SELECT} WHERE c.id = $1`, [caseRow.id]);
  res.status(201).json(await enrichCase(row));
});

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['open', 'resolved'].includes(status)) return res.status(400).json({ error: 'status must be open or resolved' });
  const resolved_at = status === 'resolved' ? new Date().toISOString() : null;
  await pool.query('UPDATE cases SET status=$1, resolved_at=$2 WHERE id=$3', [status, resolved_at, req.params.id]);
  const { rows: [row] } = await pool.query(`${CASE_SELECT} WHERE c.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  res.json(await enrichCase(row));
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM cases WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Case not found' });
  const { client_id, instructor_id, title } = req.body;
  await pool.query(
    'UPDATE cases SET client_id=$1, instructor_id=$2, title=$3 WHERE id=$4',
    [client_id || null, instructor_id || null, title || null, req.params.id]
  );
  const { rows: [row] } = await pool.query(`${CASE_SELECT} WHERE c.id = $1`, [req.params.id]);
  res.json(await enrichCase(row));
});

module.exports = router;
