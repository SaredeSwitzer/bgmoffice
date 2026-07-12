const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { status } = req.query;
  const params = [];
  let sql = 'SELECT * FROM standalone_tasks';
  if (status) { sql += ` WHERE status = $${params.push(status)}`; }
  sql += ' ORDER BY starred DESC, priority DESC, created_at DESC';
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { title, description, assigned_to, due_date, priority, notes, task_type } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const { rows: [task] } = await pool.query(
    `INSERT INTO standalone_tasks (title, description, assigned_to, due_date, priority, notes, created_by, task_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [title.trim(), description || null, assigned_to || null, due_date || null, priority || 'normal', notes || null, req.user.initials, task_type || 'task']
  );
  res.status(201).json(task);
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT * FROM standalone_tasks WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  const { title, description, assigned_to, due_date, priority, notes, status, starred, task_type } = req.body;
  const completed_at = status === 'done' ? (existing.completed_at || new Date().toISOString()) : null;
  const { rows: [task] } = await pool.query(
    `UPDATE standalone_tasks SET
       title=$1, description=$2, assigned_to=$3, due_date=$4, priority=$5, notes=$6,
       status=$7, starred=$8, completed_at=$9, task_type=$10
     WHERE id=$11 RETURNING *`,
    [title, description || null, assigned_to || null, due_date || null, priority || 'normal', notes || null, status || 'open', starred ? 1 : 0, completed_at, task_type || 'task', req.params.id]
  );
  res.json(task);
});

router.post('/:id/replies', async (req, res) => {
  const { text, assigned_to, action_type_id } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
  const { rows: [task] } = await pool.query('SELECT id, replies FROM standalone_tasks WHERE id = $1', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Not found' });

  const reply = { id: Date.now(), text: text.trim(), author: req.user.initials, created_at: new Date().toISOString() };
  if (assigned_to) reply.assigned_to = assigned_to;

  if (action_type_id) {
    const { rows: [at] } = await pool.query('SELECT name, color FROM action_types WHERE id = $1', [Number(action_type_id)]);
    if (at) { reply.action_type_name = at.name; reply.action_type_color = at.color; }
  }

  const existing = task.replies ? JSON.parse(task.replies) : [];
  await pool.query('UPDATE standalone_tasks SET replies = $1 WHERE id = $2', [JSON.stringify([...existing, reply]), task.id]);

  const response = { reply };
  if (assigned_to !== undefined) {
    await pool.query('UPDATE standalone_tasks SET assigned_to = $1 WHERE id = $2', [assigned_to || null, task.id]);
    response.assigned_to = assigned_to || null;
  }

  res.status(201).json(response);
});

router.delete('/:id/replies/:replyId', async (req, res) => {
  const { rows: [task] } = await pool.query('SELECT id, replies FROM standalone_tasks WHERE id = $1', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const existing = task.replies ? JSON.parse(task.replies) : [];
  await pool.query('UPDATE standalone_tasks SET replies = $1 WHERE id = $2', [JSON.stringify(existing.filter(r => String(r.id) !== String(req.params.replyId))), task.id]);
  res.json({ success: true });
});

router.patch('/:id/star', async (req, res) => {
  await pool.query('UPDATE standalone_tasks SET starred = $1 WHERE id = $2', [req.body.starred ? 1 : 0, req.params.id]);
  const { rows: [task] } = await pool.query('SELECT * FROM standalone_tasks WHERE id = $1', [req.params.id]);
  res.json(task);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM standalone_tasks WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
