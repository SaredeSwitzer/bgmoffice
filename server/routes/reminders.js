const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const REMINDER_JOIN = `
  SELECT r.*,
    c.name   AS client_name,
    i.name   AS instructor_name,
    COALESCE(r.case_id, ai.case_id) AS resolved_case_id,
    cl2.name AS case_client_name,
    i2.name  AS case_instructor_name
  FROM reminders r
  LEFT JOIN clients      c   ON c.id   = r.client_id
  LEFT JOIN instructors  i   ON i.id   = r.instructor_id
  LEFT JOIN action_items ai  ON ai.id  = r.action_item_id
  LEFT JOIN cases        cas ON cas.id = COALESCE(r.case_id, ai.case_id)
  LEFT JOIN clients      cl2 ON cl2.id = cas.client_id
  LEFT JOIN instructors  i2  ON i2.id  = cas.instructor_id
`;

function today() { return new Date().toISOString().slice(0, 10); }

router.get('/', async (req, res) => {
  const { client_id, instructor_id } = req.query;
  const conditions = [`r.status = 'pending'`];
  const params = [];
  if (client_id)     { conditions.push(`r.client_id = $${params.push(client_id)}`); }
  if (instructor_id) { conditions.push(`r.instructor_id = $${params.push(instructor_id)}`); }

  const { rows } = await pool.query(
    `${REMINDER_JOIN} WHERE ${conditions.join(' AND ')} ORDER BY r.remind_on ASC`,
    params
  );

  const t = today();
  const hydrate = r => ({ ...r, case_id: r.resolved_case_id });
  res.json({
    overdue:  rows.filter(r => r.remind_on <  t).map(hydrate),
    upcoming: rows.filter(r => r.remind_on >= t).map(hydrate),
  });
});

router.post('/', async (req, res) => {
  const { title, notes, remind_on, client_id, instructor_id, case_id, action_item_id, delegate_name } = req.body;
  if (!title || !remind_on) return res.status(400).json({ error: 'title and remind_on are required' });

  const { rows: [reminder] } = await pool.query(
    `INSERT INTO reminders
       (title, notes, remind_on, client_id, instructor_id, case_id, action_item_id, delegate_name, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      title, notes || null, remind_on,
      client_id || null, instructor_id || null, case_id || null,
      action_item_id || null, delegate_name || null, req.user.initials,
    ]
  );
  res.status(201).json(reminder);
});

router.put('/:id', async (req, res) => {
  const { rows: [reminder] } = await pool.query('SELECT * FROM reminders WHERE id = $1', [req.params.id]);
  if (!reminder) return res.status(404).json({ error: 'Not found' });
  if (reminder.created_by !== req.user.initials && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Not authorized' });

  const { title, notes, remind_on, delegate_name, client_id, instructor_id } = req.body;
  if (!title?.trim() || !remind_on) return res.status(400).json({ error: 'title and remind_on required' });

  await pool.query(
    `UPDATE reminders
     SET title=$1, notes=$2, remind_on=$3, delegate_name=$4, client_id=$5, instructor_id=$6,
         updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS')
     WHERE id=$7`,
    [title.trim(), notes || null, remind_on, delegate_name || null, client_id || null, instructor_id || null, req.params.id]
  );

  const { rows: [updated] } = await pool.query(`${REMINDER_JOIN} WHERE r.id = $1`, [req.params.id]);
  res.json({ ...updated, case_id: updated.resolved_case_id });
});

router.patch('/:id/done', async (req, res) => {
  await pool.query(`UPDATE reminders SET status = 'done' WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM reminders WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
