const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const BASE_SQL = `
  SELECT
    r.*,
    cl.name AS client_name,
    i.name  AS instructor_name,
    c.id    AS case_id_ref
  FROM reminders r
  LEFT JOIN clients     cl ON cl.id = r.client_id
  LEFT JOIN instructors i  ON i.id  = r.instructor_id
  LEFT JOIN cases       c  ON c.id  = r.case_id
`;

const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// GET / — { overdue: [...], upcoming: [...] }
router.get('/', (req, res) => {
  const t = today();
  const overdue  = db.prepare(BASE_SQL + ` WHERE r.status = 'pending' AND r.remind_on <  ? ORDER BY r.remind_on ASC`).all(t);
  const upcoming = db.prepare(BASE_SQL + ` WHERE r.status = 'pending' AND r.remind_on >= ? ORDER BY r.remind_on ASC`).all(t);
  res.json({ overdue, upcoming });
});

// POST / — create a reminder
router.post('/', (req, res) => {
  const { title, notes, remind_on, client_id, instructor_id, case_id } = req.body;
  if (!title || !remind_on) return res.status(400).json({ error: 'title and remind_on are required' });

  const result = db.prepare(`
    INSERT INTO reminders (title, notes, remind_on, client_id, instructor_id, case_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    title,
    notes || null,
    remind_on,
    client_id || null,
    instructor_id || null,
    case_id || null,
    req.user.name,
  );

  const created = db.prepare(BASE_SQL + ' WHERE r.id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// PATCH /:id/done — mark a reminder as done
router.patch('/:id/done', (req, res) => {
  const { id } = req.params;
  db.prepare(`UPDATE reminders SET status = 'done' WHERE id = ?`).run(id);
  const updated = db.prepare(BASE_SQL + ' WHERE r.id = ?').get(id);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

// DELETE /:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
