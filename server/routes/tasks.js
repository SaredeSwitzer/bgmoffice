const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');
const { syncMentions, deleteMentions } = require('../lib/mentions');

const router = express.Router();
router.use(requireAuth);

const TASK_JOIN = `
  SELECT st.*, cl.name AS client_name, i.name AS instructor_name
  FROM standalone_tasks st
  LEFT JOIN clients     cl ON cl.id = st.client_id
  LEFT JOIN instructors i  ON i.id  = st.instructor_id
`;

router.get('/', async (req, res) => {
  const { status } = req.query;
  const params = [];
  let sql = TASK_JOIN;
  if (status) { sql += ` WHERE st.status = $${params.push(status)}`; }
  sql += ' ORDER BY st.starred DESC, st.priority DESC, st.created_at DESC';
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { title, description, assigned_to, due_date, priority, notes, task_type, client_id, instructor_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const { rows: [{ id }] } = await pool.query(
    `INSERT INTO standalone_tasks (title, description, assigned_to, due_date, priority, notes, created_by, task_type, client_id, instructor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [title.trim(), description || null, assigned_to || null, due_date || null, priority || 'normal', notes || null,
     req.user.initials, task_type || 'task', client_id || null, instructor_id || null]
  );
  const { rows: [task] } = await pool.query(`${TASK_JOIN} WHERE st.id = $1`, [id]);
  await syncMentions({
    sourceTable: 'standalone_tasks', sourceId: id,
    text: `${description || ''} ${notes || ''}`,
    authorInitials: req.user.initials, linkPath: `/tasks?id=${id}`,
  });
  res.status(201).json(task);
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT * FROM standalone_tasks WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  const { title, description, assigned_to, due_date, priority, notes, status, starred, task_type, client_id, instructor_id } = req.body;
  const completed_at = status === 'done' ? (existing.completed_at || new Date().toISOString()) : null;
  await pool.query(
    `UPDATE standalone_tasks SET
       title=$1, description=$2, assigned_to=$3, due_date=$4, priority=$5, notes=$6,
       status=$7, starred=$8, completed_at=$9, task_type=$10, client_id=$11, instructor_id=$12
     WHERE id=$13`,
    [title, description || null, assigned_to || null, due_date || null, priority || 'normal', notes || null,
     status || 'open', starred ? 1 : 0, completed_at, task_type || 'task',
     client_id !== undefined ? (client_id || null) : existing.client_id,
     instructor_id !== undefined ? (instructor_id || null) : existing.instructor_id,
     req.params.id]
  );
  const { rows: [task] } = await pool.query(`${TASK_JOIN} WHERE st.id = $1`, [req.params.id]);
  await syncMentions({
    sourceTable: 'standalone_tasks', sourceId: req.params.id,
    text: `${description || ''} ${notes || ''}`,
    authorInitials: req.user.initials, linkPath: `/tasks?id=${req.params.id}`,
  });
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

  // Each reply gets its own mentions row keyed by the reply's own id (not the task's)
  // since replies are append-only — reusing the task's id here would wipe out every
  // earlier reply's mentions the next time someone tags a person.
  await syncMentions({
    sourceTable: 'task_replies', sourceId: reply.id, text: reply.text,
    authorInitials: req.user.initials, linkPath: `/tasks?id=${task.id}`,
  });

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
  await deleteMentions('task_replies', req.params.replyId);
  res.json({ success: true });
});

router.patch('/:id/star', async (req, res) => {
  await pool.query('UPDATE standalone_tasks SET starred = $1 WHERE id = $2', [req.body.starred ? 1 : 0, req.params.id]);
  const { rows: [task] } = await pool.query('SELECT * FROM standalone_tasks WHERE id = $1', [req.params.id]);
  res.json(task);
});

router.delete('/:id', async (req, res) => {
  const { rows: [task] } = await pool.query('SELECT replies FROM standalone_tasks WHERE id = $1', [req.params.id]);
  await pool.query('DELETE FROM standalone_tasks WHERE id = $1', [req.params.id]);
  await deleteMentions('standalone_tasks', req.params.id);
  const replies = task?.replies ? JSON.parse(task.replies) : [];
  await Promise.all(replies.map(r => deleteMentions('task_replies', r.id)));
  res.json({ success: true });
});

module.exports = router;
