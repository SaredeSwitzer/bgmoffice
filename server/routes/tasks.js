const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// List tasks (optionally filter by status)
router.get('/', (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM standalone_tasks';
  const params = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY starred DESC, priority DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Create task
router.post('/', (req, res) => {
  const { title, description, assigned_to, due_date, priority, notes, task_type } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const result = db.prepare(
    `INSERT INTO standalone_tasks (title, description, assigned_to, due_date, priority, notes, created_by, task_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    title.trim(),
    description || null,
    assigned_to || null,
    due_date || null,
    priority || 'normal',
    notes || null,
    req.user.initials,
    task_type || 'task'
  );
  res.status(201).json(db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(result.lastInsertRowid));
});

// Update task
router.put('/:id', (req, res) => {
  const task = db.prepare('SELECT id FROM standalone_tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { title, description, assigned_to, due_date, priority, notes, status, starred, task_type } = req.body;
  const completed_at = status === 'done' ? (db.prepare('SELECT completed_at FROM standalone_tasks WHERE id=?').get(req.params.id).completed_at || new Date().toISOString()) : null;
  db.prepare(
    `UPDATE standalone_tasks SET
       title=?, description=?, assigned_to=?, due_date=?, priority=?, notes=?, status=?, starred=?, completed_at=?, task_type=?
     WHERE id=?`
  ).run(
    title, description || null, assigned_to || null, due_date || null,
    priority || 'normal', notes || null, status || 'open',
    starred ? 1 : 0, completed_at, task_type || 'task', req.params.id
  );
  res.json(db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(req.params.id));
});

// Add reply to task
router.post('/:id/replies', (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
  const task = db.prepare('SELECT id, replies FROM standalone_tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const existing = task.replies ? JSON.parse(task.replies) : [];
  const reply = { id: Date.now(), text: text.trim(), author: req.user.initials, created_at: new Date().toISOString() };
  db.prepare('UPDATE standalone_tasks SET replies = ? WHERE id = ?')
    .run(JSON.stringify([...existing, reply]), task.id);
  res.status(201).json(reply);
});

// Delete a reply
router.delete('/:id/replies/:replyId', (req, res) => {
  const task = db.prepare('SELECT id, replies FROM standalone_tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const existing = task.replies ? JSON.parse(task.replies) : [];
  db.prepare('UPDATE standalone_tasks SET replies = ? WHERE id = ?')
    .run(JSON.stringify(existing.filter(r => String(r.id) !== String(req.params.replyId))), task.id);
  res.json({ success: true });
});

// Star/unstar task
router.patch('/:id/star', (req, res) => {
  const { starred } = req.body;
  db.prepare('UPDATE standalone_tasks SET starred = ? WHERE id = ?').run(starred ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(req.params.id));
});

// Delete task
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM standalone_tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
